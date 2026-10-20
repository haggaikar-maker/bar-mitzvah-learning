import json
import re
import unicodedata
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pytesseract
import whisper
from moviepy import AudioFileClip, VideoClip
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from proglog import ProgressBarLogger
from pytesseract import Output


HEBREW_LETTERS_RE = re.compile(r"[^\u0590-\u05FF]")
DEFAULT_TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\calibri.ttf",
]
ProgressCallback = Optional[Callable[[float, str], None]]


@dataclass
class OCRWord:
    word: str
    normalized: str
    x: int
    y: int
    w: int
    h: int
    slide_index: int = 0


@dataclass
class TimedWord:
    word: str
    normalized: str
    start: float
    end: float
    probability: Optional[float] = None


@dataclass
class SyncedWord:
    index: int
    word: str
    normalized: str
    start: float
    end: float
    x: int
    y: int
    w: int
    h: int
    whisper_word: Optional[str]
    confidence: float
    source: str
    slide_index: int = 0


@dataclass
class RenderStyle:
    highlight_mode: str = "box"
    box_color: Tuple[int, int, int, int] = (255, 235, 120, 110)
    text_color: Tuple[int, int, int, int] = (220, 40, 40, 255)
    outline_color: Tuple[int, int, int, int] = (255, 235, 120, 255)
    padding_x: int = 6
    padding_y: int = 3
    radius: int = 5
    font_path: str = ""
    font_size_delta: int = 10
    stroke_width: int = 2


def normalize_word(word: str) -> str:
    stripped = []
    for char in (word or "").strip():
        if unicodedata.category(char) == "Mn":
            continue
        stripped.append(char)
    return HEBREW_LETTERS_RE.sub("", "".join(stripped))


def parse_color(color: str, alpha: Optional[int] = None) -> Tuple[int, int, int, int]:
    cleaned = (color or "").strip().lstrip("#")
    if len(cleaned) not in {6, 8}:
        raise ValueError(f"Invalid color: {color}")

    if len(cleaned) == 6:
        r = int(cleaned[0:2], 16)
        g = int(cleaned[2:4], 16)
        b = int(cleaned[4:6], 16)
        a = 255 if alpha is None else alpha
        return (r, g, b, a)

    r = int(cleaned[0:2], 16)
    g = int(cleaned[2:4], 16)
    b = int(cleaned[4:6], 16)
    a = int(cleaned[6:8], 16)
    if alpha is not None:
        a = alpha
    return (r, g, b, a)


def resolve_font_path(font_path: str) -> Optional[str]:
    if font_path and Path(font_path).exists():
        return font_path

    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


def load_font(font_path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    chosen_path = resolve_font_path(font_path)
    if chosen_path:
        return ImageFont.truetype(chosen_path, size=max(size, 10))
    return ImageFont.load_default()


def get_leading_silence_seconds(audio_path: str, silence_thresh: int = -40, chunk_size: int = 10) -> float:
    try:
        from pydub import AudioSegment
        from pydub.silence import detect_leading_silence
    except ModuleNotFoundError:
        return 0.0

    audio = AudioSegment.from_file(audio_path)
    leading_silence_ms = detect_leading_silence(
        audio,
        silence_threshold=silence_thresh,
        chunk_size=chunk_size,
    )
    return leading_silence_ms / 1000.0


def transcribe_audio(
    audio_path: str,
    language: str = "he",
    model_name: str = "small",
    shift_leading_silence: bool = True,
    silence_thresh: int = -40,
    progress_callback: ProgressCallback = None,
) -> Dict[str, Any]:
    if progress_callback:
        progress_callback(0.05, "Loading audio and checking leading silence...")
    leading_silence = get_leading_silence_seconds(audio_path, silence_thresh=silence_thresh)
    applied_leading_silence = leading_silence if shift_leading_silence else 0.0
    if progress_callback:
        progress_callback(0.12, f"Loading Whisper model: {model_name}")
    model = whisper.load_model(model_name)
    if progress_callback:
        progress_callback(0.2, "Transcribing audio with Whisper...")
    result = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        verbose=False,
    )

    if applied_leading_silence:
        for segment in result.get("segments", []):
            if segment.get("start") is not None:
                segment["start"] += applied_leading_silence
            if segment.get("end") is not None:
                segment["end"] += applied_leading_silence
            for word in segment.get("words", []):
                if word.get("start") is not None:
                    word["start"] += applied_leading_silence
                if word.get("end") is not None:
                    word["end"] += applied_leading_silence

    result["leading_silence_seconds"] = leading_silence
    result["leading_silence_correction_applied"] = bool(applied_leading_silence)
    if progress_callback:
        progress_callback(0.5, "Whisper transcription completed")
    return result


def extract_timed_words(whisper_result: Dict[str, Any]) -> List[TimedWord]:
    timed_words: List[TimedWord] = []
    for segment in whisper_result.get("segments", []):
        for word in segment.get("words", []):
            normalized = normalize_word(word.get("word", ""))
            start = word.get("start")
            end = word.get("end")
            if not normalized or start is None or end is None:
                continue
            timed_words.append(
                TimedWord(
                    word=word.get("word", "").strip(),
                    normalized=normalized,
                    start=float(start),
                    end=float(end),
                    probability=word.get("probability"),
                )
            )
    return timed_words


def extract_ocr_words(image_path: str, tesseract_cmd: Optional[str] = None, language: str = "heb") -> List[OCRWord]:
    chosen_tesseract = tesseract_cmd or DEFAULT_TESSERACT_PATH
    if chosen_tesseract and Path(chosen_tesseract).exists():
        pytesseract.pytesseract.tesseract_cmd = chosen_tesseract

    base_image = Image.open(image_path)
    candidates = build_ocr_candidates(base_image)

    best_result: List[OCRWord] = []
    best_score = -1.0

    configs = ["", "--psm 6", "--psm 4", "--psm 11"]

    for candidate, scale in candidates:
        for config in configs:
            kwargs = {"lang": language, "output_type": Output.DICT}
            if config:
                kwargs["config"] = config
            data = pytesseract.image_to_data(candidate, **kwargs)
            result_words = build_ocr_word_list(data, scale=scale)
            score = score_ocr_result(result_words)
            if score > best_score:
                best_result = result_words
                best_score = score

    recovered = recover_missing_rows(base_image, best_result, language=language)
    merged_words = deduplicate_ocr_words(best_result + recovered)
    return order_ocr_words(merged_words)


def build_ocr_word_list(data: Dict[str, List[Any]], scale: float = 1.0) -> List[OCRWord]:
    results: List[OCRWord] = []
    for index in range(len(data["text"])):
        raw_word = data["text"][index].strip()
        if not raw_word:
            continue

        try:
            confidence = float(str(data["conf"][index]).strip())
        except Exception:
            confidence = -1
        if confidence < 0:
            continue

        normalized = normalize_word(raw_word)
        if not normalized:
            continue

        results.append(
            OCRWord(
                word=raw_word,
                normalized=normalized,
                x=int(int(data["left"][index]) / scale),
                y=int(int(data["top"][index]) / scale),
                w=max(1, int(int(data["width"][index]) / scale)),
                h=max(1, int(int(data["height"][index]) / scale)),
            )
        )
    return results


def build_ocr_candidates(image: Image.Image) -> List[Tuple[Image.Image, float]]:
    enlarged = image.convert("L").resize((image.width * 2, image.height * 2), Image.Resampling.LANCZOS)
    sharpened = enlarged.filter(ImageFilter.SHARPEN)
    binary = sharpened.point(lambda pixel: 255 if pixel > 190 else 0, mode="1").convert("L")
    cleaned = remove_small_dark_components(binary, area_threshold=18, height_threshold=9, width_threshold=9)
    softened = cleaned.filter(ImageFilter.MedianFilter(size=3))
    return [(image, 1.0), (enlarged, 2.0), (binary, 2.0), (cleaned, 2.0), (softened, 2.0)]


def remove_small_dark_components(
    image: Image.Image,
    area_threshold: int,
    height_threshold: int,
    width_threshold: int,
) -> Image.Image:
    arr = np.array(image)
    dark = arr < 128
    visited = np.zeros_like(dark, dtype=bool)
    height, width = dark.shape

    for y in range(height):
        for x in range(width):
            if not dark[y, x] or visited[y, x]:
                continue

            stack = [(y, x)]
            visited[y, x] = True
            component = []
            min_y = max_y = y
            min_x = max_x = x

            while stack:
                cy, cx = stack.pop()
                component.append((cy, cx))
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)

                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < height and 0 <= nx < width and dark[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))

            component_height = max_y - min_y + 1
            component_width = max_x - min_x + 1
            if (
                len(component) <= area_threshold
                and component_height <= height_threshold
                and component_width <= width_threshold
            ):
                for cy, cx in component:
                    arr[cy, cx] = 255

    return Image.fromarray(arr)


def score_ocr_result(words: Sequence[OCRWord]) -> float:
    if not words:
        return 0.0
    unique_rows = len({word.y // 20 for word in words})
    total_width = sum(word.w for word in words)
    return (len(words) * 100.0) + (unique_rows * 10.0) + (total_width / 1000.0)


def cluster_words_into_rows(words: Sequence[OCRWord], threshold: int = 22) -> List[List[OCRWord]]:
    if not words:
        return []
    sorted_words = sorted(words, key=lambda item: item.y)
    rows: List[List[OCRWord]] = [[sorted_words[0]]]

    for word in sorted_words[1:]:
        current_row = rows[-1]
        avg_y = sum(item.y for item in current_row) / len(current_row)
        if abs(word.y - avg_y) <= threshold:
            current_row.append(word)
        else:
            rows.append([word])

    for row in rows:
        row.sort(key=lambda item: item.x, reverse=True)
    return rows


def row_center(row: Sequence[OCRWord]) -> float:
    return sum(word.y + (word.h / 2) for word in row) / len(row)


def estimate_row_spacing(rows: Sequence[Sequence[OCRWord]]) -> Optional[float]:
    centers = [row_center(row) for row in rows if row]
    if len(centers) < 2:
        return None
    diffs = [centers[index + 1] - centers[index] for index in range(len(centers) - 1)]
    plausible = [diff for diff in diffs if 35 <= diff <= 100]
    if not plausible:
        plausible = diffs
    plausible.sort()
    return plausible[len(plausible) // 2] if plausible else None


def recover_missing_rows(image: Image.Image, words: Sequence[OCRWord], language: str = "heb") -> List[OCRWord]:
    rows = cluster_words_into_rows(words)
    if len(rows) < 3:
        return []

    spacing = estimate_row_spacing(rows)
    if not spacing:
        return []

    centers = [row_center(row) for row in rows]
    expected_centers = []
    current = centers[0]
    max_center = centers[-1]
    while current <= max_center + (spacing * 0.6):
        expected_centers.append(current)
        current += spacing

    recovered: List[OCRWord] = []
    tolerance = spacing * 0.3
    for center in expected_centers:
        nearest_index = min(range(len(centers)), key=lambda idx: abs(centers[idx] - center))
        nearest_distance = abs(centers[nearest_index] - center)
        existing_row = rows[nearest_index] if nearest_distance <= tolerance else []
        should_recover = nearest_distance > tolerance or len(existing_row) <= 3
        if not should_recover:
            continue

        band_words = recover_row_band(image, center, spacing, language=language)
        if band_words:
            recovered.extend(band_words)

    return recovered


def recover_row_band(image: Image.Image, center: float, spacing: float, language: str = "heb") -> List[OCRWord]:
    band_height = max(int(spacing * 1.1), 42)
    top = max(int(center - (band_height / 2)), 0)
    bottom = min(int(center + (band_height / 2)), image.height)
    if bottom <= top:
        return []

    crop = image.crop((0, top, image.width, bottom))
    enlarged = crop.convert("L").resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
    binary = enlarged.filter(ImageFilter.SHARPEN).point(lambda pixel: 255 if pixel > 190 else 0, mode="1").convert("L")

    best_words: List[OCRWord] = []
    best_score = 0.0
    for candidate, scale, config in [
        (crop, 1.0, "--psm 7"),
        (enlarged, 2.0, "--psm 7"),
        (binary, 2.0, "--psm 7"),
        (binary, 2.0, "--psm 13"),
    ]:
        data = pytesseract.image_to_data(candidate, lang=language, config=config, output_type=Output.DICT)
        words = build_ocr_word_list(data, scale=scale)
        for word in words:
            word.y += top
        score = score_ocr_result(words)
        if score > best_score:
            best_words = words
            best_score = score

    return best_words


def deduplicate_ocr_words(words: Sequence[OCRWord]) -> List[OCRWord]:
    chosen: List[OCRWord] = []
    candidates = sorted(words, key=ocr_word_quality, reverse=True)
    for word in candidates:
        duplicate_index = None
        for index, existing in enumerate(chosen):
            if is_duplicate_candidate(existing, word):
                duplicate_index = index
                break
        if duplicate_index is None:
            chosen.append(word)
        elif ocr_word_quality(word) > ocr_word_quality(chosen[duplicate_index]):
            chosen[duplicate_index] = word
    return chosen


def order_ocr_words(words: Sequence[OCRWord]) -> List[OCRWord]:
    rows = cluster_words_into_rows(words, threshold=18)
    rows.sort(key=row_center)

    ordered: List[OCRWord] = []
    for row in rows:
        compact_row = filter_row_overlaps(row)
        compact_row.sort(key=lambda item: item.x, reverse=True)
        ordered.extend(compact_row)
    return ordered


def filter_row_overlaps(row: Sequence[OCRWord]) -> List[OCRWord]:
    if not row:
        return []
    kept: List[OCRWord] = []
    for word in sorted(row, key=lambda item: item.x, reverse=True):
        overlapping = next((existing for existing in kept if horizontal_overlap_ratio(existing, word) > 0.55), None)
        if overlapping is None:
            kept.append(word)
            continue
        if ocr_word_quality(word) > ocr_word_quality(overlapping):
            kept.remove(overlapping)
            kept.append(word)
    return kept


def ocr_word_quality(word: OCRWord) -> float:
    area = word.w * word.h
    return (len(word.normalized) * 100.0) + area


def is_duplicate_candidate(left: OCRWord, right: OCRWord) -> bool:
    y_close = abs((left.y + left.h / 2) - (right.y + right.h / 2)) <= max(left.h, right.h, 18)
    x_overlap = horizontal_overlap_ratio(left, right) > 0.5
    iou = box_iou(left, right)
    x_close = abs((left.x + left.w / 2) - (right.x + right.w / 2)) <= max(left.w, right.w, 24)
    same_word = left.normalized == right.normalized
    text_similarity = similarity_score(left.normalized, right.normalized)

    if same_word:
        return y_close and (x_overlap or x_close or iou > 0.15)

    if text_similarity >= 0.82:
        return y_close and iou > 0.55

    return iou > 0.72 and y_close


def horizontal_overlap_ratio(left: OCRWord, right: OCRWord) -> float:
    left_start, left_end = left.x, left.x + left.w
    right_start, right_end = right.x, right.x + right.w
    overlap = max(0, min(left_end, right_end) - max(left_start, right_start))
    base = max(min(left.w, right.w), 1)
    return overlap / base


def box_iou(left: OCRWord, right: OCRWord) -> float:
    left_x2, left_y2 = left.x + left.w, left.y + left.h
    right_x2, right_y2 = right.x + right.w, right.y + right.h
    inter_w = max(0, min(left_x2, right_x2) - max(left.x, right.x))
    inter_h = max(0, min(left_y2, right_y2) - max(left.y, right.y))
    intersection = inter_w * inter_h
    if intersection <= 0:
        return 0.0
    left_area = left.w * left.h
    right_area = right.w * right.h
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


def similarity_score(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def align_words(ocr_words: Sequence[OCRWord], timed_words: Sequence[TimedWord]) -> List[Tuple[Optional[int], Optional[int], float]]:
    rows = len(ocr_words)
    cols = len(timed_words)
    gap_penalty = -0.75

    score_matrix = [[0.0] * (cols + 1) for _ in range(rows + 1)]
    trace_matrix = [[""] * (cols + 1) for _ in range(rows + 1)]

    for i in range(1, rows + 1):
        score_matrix[i][0] = i * gap_penalty
        trace_matrix[i][0] = "up"
    for j in range(1, cols + 1):
        score_matrix[0][j] = j * gap_penalty
        trace_matrix[0][j] = "left"

    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            score = similarity_score(ocr_words[i - 1].normalized, timed_words[j - 1].normalized)
            diag = score_matrix[i - 1][j - 1] + (2.5 * score - 1.0)
            up = score_matrix[i - 1][j] + gap_penalty
            left = score_matrix[i][j - 1] + gap_penalty

            best = max(diag, up, left)
            score_matrix[i][j] = best
            trace_matrix[i][j] = "diag" if best == diag else ("up" if best == up else "left")

    aligned: List[Tuple[Optional[int], Optional[int], float]] = []
    i = rows
    j = cols
    while i > 0 or j > 0:
        direction = trace_matrix[i][j]
        if i > 0 and j > 0 and direction == "diag":
            score = similarity_score(ocr_words[i - 1].normalized, timed_words[j - 1].normalized)
            aligned.append((i - 1, j - 1, score))
            i -= 1
            j -= 1
        elif i > 0 and (j == 0 or direction == "up"):
            aligned.append((i - 1, None, 0.0))
            i -= 1
        else:
            aligned.append((None, j - 1, 0.0))
            j -= 1

    aligned.reverse()
    return aligned


def estimate_word_times(index: int, paired_items: Sequence[SyncedWord], default_duration: float = 0.45) -> Tuple[float, float]:
    previous_item = None
    next_item = None

    for item in paired_items:
        if item.index < index and item.source == "aligned":
            previous_item = item
        if item.index > index and item.source == "aligned":
            next_item = item
            break

    if previous_item and next_item:
        gap = max(next_item.index - previous_item.index, 1)
        slot = index - previous_item.index
        start = previous_item.start + ((next_item.start - previous_item.start) * slot / gap)
        duration = max((next_item.start - previous_item.end) / gap, default_duration)
        end = min(start + duration, next_item.end)
        if end <= start:
            end = start + default_duration
        return (start, end)

    if previous_item:
        start = previous_item.end
        return (start, start + default_duration)

    if next_item:
        end = max(next_item.start, default_duration)
        start = max(0.0, end - default_duration)
        return (start, end)

    return (index * default_duration, (index + 1) * default_duration)


def sync_words(ocr_words: Sequence[OCRWord], timed_words: Sequence[TimedWord], min_similarity: float = 0.52) -> List[SyncedWord]:
    alignment = align_words(ocr_words, timed_words)
    synced: List[SyncedWord] = []

    timed_by_index = {index: word for index, word in enumerate(timed_words)}
    ocr_by_index = {index: word for index, word in enumerate(ocr_words)}

    for ocr_index, timed_index, score in alignment:
        if ocr_index is None:
            continue

        ocr_word = ocr_by_index[ocr_index]
        if timed_index is not None and score >= min_similarity:
            timed_word = timed_by_index[timed_index]
            synced.append(
                SyncedWord(
                    index=ocr_index,
                    word=ocr_word.word,
                    normalized=ocr_word.normalized,
                    start=timed_word.start,
                    end=timed_word.end,
                    x=ocr_word.x,
                    y=ocr_word.y,
                    w=ocr_word.w,
                    h=ocr_word.h,
                    whisper_word=timed_word.word,
                    confidence=score,
                    source="aligned",
                    slide_index=ocr_word.slide_index,
                )
            )
        else:
            synced.append(
                SyncedWord(
                    index=ocr_index,
                    word=ocr_word.word,
                    normalized=ocr_word.normalized,
                    start=0.0,
                    end=0.0,
                    x=ocr_word.x,
                    y=ocr_word.y,
                    w=ocr_word.w,
                    h=ocr_word.h,
                    whisper_word=timed_by_index[timed_index].word if timed_index is not None else None,
                    confidence=score,
                    source="estimated",
                    slide_index=ocr_word.slide_index,
                )
            )

    synced.sort(key=lambda item: item.index)
    for item in synced:
        if item.source == "estimated":
            item.start, item.end = estimate_word_times(item.index, synced)
            item.confidence = max(item.confidence, 0.15)
    return synced


def save_json(data: Any, output_path: str) -> None:
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def synced_words_to_json(words: Sequence[SyncedWord]) -> List[Dict[str, Any]]:
    return [asdict(word) for word in words]


def synced_words_from_json(items: Sequence[Dict[str, Any]]) -> List[SyncedWord]:
    return [SyncedWord(**item) for item in items]


def render_video(
    image_path: str,
    audio_path: str,
    synced_words: Sequence[SyncedWord],
    output_path: str,
    style: Optional[RenderStyle] = None,
    fps: int = 25,
    progress_callback: ProgressCallback = None,
    slide_image_paths: Optional[Sequence[str]] = None,
    transition_duration: float = 0.35,
) -> None:
    style = style or RenderStyle()
    output_target = Path(output_path)
    output_target.parent.mkdir(parents=True, exist_ok=True)
    temp_audio_path = output_target.with_name(f"{output_target.stem}_temp_audio.m4a")
    slide_sources = list(slide_image_paths or [image_path])
    base_images = [Image.open(path).convert("RGBA") for path in slide_sources]
    width, height = base_images[0].size
    audio = AudioFileClip(audio_path)
    transition_duration = max(0.0, float(transition_duration or 0.0))

    slide_start_times: Dict[int, float] = {}
    for word in synced_words:
        current = slide_start_times.get(word.slide_index)
        if current is None or word.start < current:
            slide_start_times[word.slide_index] = word.start

    max_slide_index = max([0, *(word.slide_index for word in synced_words)])
    for slide_index in range(min(len(base_images), max_slide_index + 1)):
        slide_start_times.setdefault(slide_index, 0.0)

    ordered_slide_indices = sorted(slide_start_times, key=lambda idx: (slide_start_times[idx], idx))

    class CallbackLogger(ProgressBarLogger):
        def bars_callback(self, bar, attr, value, old_value=None):
            if bar == "t" and attr == "index" and self.bars.get("t", {}).get("total"):
                total = self.bars["t"]["total"]
                progress = min(max(value / total, 0.0), 1.0) if total else 0.0
                if progress_callback:
                    progress_callback(progress, f"Rendering video... {progress * 100:.0f}%")

    if progress_callback:
        progress_callback(0.02, "Preparing video render...")

    def make_frame(t: float) -> np.ndarray:
        active_word = None
        for word in synced_words:
            if word.start <= t <= word.end:
                active_word = word
                break

        current_slide_index = 0
        for slide_index in ordered_slide_indices:
            if slide_start_times.get(slide_index, 0.0) <= t:
                current_slide_index = slide_index
            else:
                break

        current_slide_index = min(current_slide_index, len(base_images) - 1)
        frame = base_images[current_slide_index].copy()

        if transition_duration > 0:
            current_order_index = ordered_slide_indices.index(current_slide_index) if current_slide_index in ordered_slide_indices else 0
            if current_order_index > 0:
                transition_start = slide_start_times.get(current_slide_index, 0.0)
                if transition_start <= t < transition_start + transition_duration:
                    previous_slide_index = ordered_slide_indices[current_order_index - 1]
                    previous_slide_index = min(previous_slide_index, len(base_images) - 1)
                    blend = (t - transition_start) / transition_duration
                    frame = Image.blend(base_images[previous_slide_index], base_images[current_slide_index], min(max(blend, 0.0), 1.0))

        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        if active_word:
            x1 = active_word.x - style.padding_x
            y1 = active_word.y - style.padding_y
            x2 = active_word.x + active_word.w + style.padding_x
            y2 = active_word.y + active_word.h + style.padding_y

            if style.highlight_mode == "box":
                draw.rounded_rectangle([x1, y1, x2, y2], radius=style.radius, fill=style.box_color)
            elif style.highlight_mode == "outline":
                draw.rounded_rectangle(
                    [x1, y1, x2, y2],
                    radius=style.radius,
                    outline=style.outline_color,
                    width=max(style.stroke_width, 1),
                )
            elif style.highlight_mode in {"text", "text_box"}:
                if style.highlight_mode == "text_box":
                    draw.rounded_rectangle([x1, y1, x2, y2], radius=style.radius, fill=style.box_color)
                font_size = max(active_word.h + style.font_size_delta, 12)
                font = load_font(style.font_path, font_size)
                draw.text(
                    (active_word.x + (active_word.w / 2), active_word.y + (active_word.h / 2)),
                    active_word.word,
                    fill=style.text_color,
                    font=font,
                    anchor="mm",
                    stroke_width=max(style.stroke_width - 1, 0),
                )

        return np.array(Image.alpha_composite(frame, overlay).convert("RGB"))

    video = VideoClip(make_frame, duration=audio.duration).with_audio(audio)
    logger = CallbackLogger() if progress_callback else None
    video.write_videofile(
        output_path,
        fps=fps,
        codec="libx264",
        audio_codec="aac",
        temp_audiofile=str(temp_audio_path),
        ffmpeg_params=["-movflags", "+faststart"],
        pixel_format="yuv420p",
        logger=logger,
    )
    audio.close()
    video.close()
    if progress_callback:
        progress_callback(1.0, "Video rendering completed")


def default_output_paths(audio_path: str, image_path: str, output_dir: str) -> Dict[str, str]:
    stem = Path(audio_path).stem or Path(image_path).stem or "session"
    output_base = Path(output_dir).expanduser() if output_dir else Path(__file__).resolve().parent
    output_base.mkdir(parents=True, exist_ok=True)
    video_dir = output_base / "Output video"
    video_dir.mkdir(parents=True, exist_ok=True)
    return {
        "whisper": str(output_base / f"{stem}_whisper.json"),
        "ocr": str(output_base / f"{stem}_ocr.json"),
        "synced": str(output_base / f"{stem}_synced.json"),
        "video": str(video_dir / f"{stem}_highlighted.mp4"),
    }


def run_pipeline(
    audio_path: str,
    image_path: str,
    output_dir: str,
    model_name: str = "small",
    language: str = "he",
    tesseract_cmd: Optional[str] = None,
    min_similarity: float = 0.52,
    progress_callback: ProgressCallback = None,
    save_outputs: bool = True,
) -> Dict[str, Any]:
    paths = default_output_paths(audio_path, image_path, output_dir)
    if progress_callback:
        progress_callback(0.01, "Starting pipeline...")
    whisper_result = transcribe_audio(
        audio_path,
        language=language,
        model_name=model_name,
        progress_callback=progress_callback,
    )
    if progress_callback:
        progress_callback(0.58, "Running OCR on image...")
    ocr_words = extract_ocr_words(image_path, tesseract_cmd=tesseract_cmd)
    if progress_callback:
        progress_callback(0.72, "Extracting timed words...")
    timed_words = extract_timed_words(whisper_result)
    if progress_callback:
        progress_callback(0.82, "Matching OCR words to audio words...")
    synced_words = sync_words(ocr_words, timed_words, min_similarity=min_similarity)
    if progress_callback:
        progress_callback(0.92, "Finalizing pipeline data...")

    if save_outputs:
        save_json(whisper_result, paths["whisper"])
        save_json([asdict(word) for word in ocr_words], paths["ocr"])
        save_json(synced_words_to_json(synced_words), paths["synced"])
    else:
        paths["whisper"] = ""
        paths["ocr"] = ""
        paths["synced"] = ""
    if progress_callback:
        progress_callback(1.0, "Pipeline completed")

    return {
        "paths": paths,
        "whisper_result": whisper_result,
        "ocr_words": ocr_words,
        "timed_words": timed_words,
        "synced_words": synced_words,
    }


def format_summary(synced_words: Sequence[SyncedWord]) -> str:
    total = len(synced_words)
    aligned = sum(1 for word in synced_words if word.source == "aligned")
    estimated = total - aligned
    avg_confidence = sum(word.confidence for word in synced_words) / total if total else 0.0
    return (
        f"Total words: {total}\n"
        f"Aligned directly: {aligned}\n"
        f"Estimated/interpolated: {estimated}\n"
        f"Average confidence: {avg_confidence:.2f}"
    )
