import re
import time
import unicodedata
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Dict, List, Sequence, Tuple

import numpy as np
import requests
from moviepy import AudioClip, AudioFileClip, ImageClip, concatenate_audioclips
from PIL import Image, ImageDraw

from sync_core import (
    OCRWord,
    ProgressCallback,
    RenderStyle,
    extract_timed_words,
    load_font,
    normalize_word,
    render_video,
    sync_words,
    transcribe_audio,
)


TEXT_LIBRARY: Dict[str, List[Tuple[str, str]]] = {
    "תורה": [
        ("בראשית", "Genesis"),
        ("שמות", "Exodus"),
        ("ויקרא", "Leviticus"),
        ("במדבר", "Numbers"),
        ("דברים", "Deuteronomy"),
    ],
    "נביאים": [
        ("יהושע", "Joshua"),
        ("שופטים", "Judges"),
        ("שמואל א", "I Samuel"),
        ("שמואל ב", "II Samuel"),
        ("מלכים א", "I Kings"),
        ("מלכים ב", "II Kings"),
        ("ישעיהו", "Isaiah"),
        ("ירמיהו", "Jeremiah"),
        ("יחזקאל", "Ezekiel"),
        ("הושע", "Hosea"),
        ("יואל", "Joel"),
        ("עמוס", "Amos"),
        ("עובדיה", "Obadiah"),
        ("יונה", "Jonah"),
        ("מיכה", "Micah"),
        ("נחום", "Nahum"),
        ("חבקוק", "Habakkuk"),
        ("צפניה", "Zephaniah"),
        ("חגי", "Haggai"),
        ("זכריה", "Zechariah"),
        ("מלאכי", "Malachi"),
    ],
    "כתובים": [
        ("תהילים", "Psalms"),
        ("משלי", "Proverbs"),
        ("איוב", "Job"),
        ("שיר השירים", "Song of Songs"),
        ("רות", "Ruth"),
        ("איכה", "Lamentations"),
        ("קהלת", "Ecclesiastes"),
        ("אסתר", "Esther"),
        ("דניאל", "Daniel"),
        ("עזרא", "Ezra"),
        ("נחמיה", "Nehemiah"),
        ("דברי הימים א", "I Chronicles"),
        ("דברי הימים ב", "II Chronicles"),
    ],
}

BOOK_ALIASES: Dict[str, str] = {}
for category_books in TEXT_LIBRARY.values():
    for hebrew_name, canonical_name in category_books:
        BOOK_ALIASES[hebrew_name.strip().lower()] = canonical_name
        BOOK_ALIASES[canonical_name.strip().lower()] = canonical_name


HEBREW_NUMERAL_VALUES = {
    "א": 1,
    "ב": 2,
    "ג": 3,
    "ד": 4,
    "ה": 5,
    "ו": 6,
    "ז": 7,
    "ח": 8,
    "ט": 9,
    "י": 10,
    "כ": 20,
    "ך": 20,
    "ל": 30,
    "מ": 40,
    "ם": 40,
    "נ": 50,
    "ן": 50,
    "ס": 60,
    "ע": 70,
    "פ": 80,
    "ף": 80,
    "צ": 90,
    "ץ": 90,
    "ק": 100,
    "ר": 200,
    "ש": 300,
    "ת": 400,
}


def resolve_book_name(book_name: str) -> str:
    cleaned = (book_name or "").strip().lower()
    if cleaned in BOOK_ALIASES:
        return BOOK_ALIASES[cleaned]
    raise ValueError("Unsupported Sefaria book name.")


def parse_hebrew_number(value: str) -> int:
    cleaned = (value or "").strip().replace('"', "").replace("׳", "").replace("״", "").replace("'", "")
    if not cleaned:
        raise ValueError("Missing chapter or verse number.")
    if cleaned.isdigit():
        return int(cleaned)
    total = 0
    for char in cleaned:
        if char not in HEBREW_NUMERAL_VALUES:
            raise ValueError(f"Cannot parse Hebrew number: {value}")
        total += HEBREW_NUMERAL_VALUES[char]
    return total


def strip_niqqud(text: str) -> str:
    return "".join(
        char
        for char in text
        if normalize_word(char) or char.isspace() or char in {'־', '"', "'", "״", "׳", ":", "׃", "-", ","}
    )


def clean_sefaria_hebrew_text(text: str, include_niqqud: bool = True) -> str:
    cleaned = (text or "").replace("\n", " ").replace("\r", " ")
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\^\{[^}]*\}", " ", cleaned)
    cleaned = re.sub(r"\[[^\]]*\]", " ", cleaned)
    cleaned = re.sub(r"\{[^}]*\}", " ", cleaned)
    cleaned = re.sub(r"[A-Za-z0-9_/\\|~`=*+<>]+", " ", cleaned)

    allowed_punctuation = {'־', '"', "'", "״", "׳", ":", "׃", "-", ","}
    filtered_chars = []
    for char in cleaned:
        is_hebrew_letter = "\u0590" <= char <= "\u05FF" and unicodedata.category(char) != "Mn"
        is_niqqud = unicodedata.category(char) == "Mn"
        if is_hebrew_letter or char.isspace() or char in allowed_punctuation or (include_niqqud and is_niqqud):
            filtered_chars.append(char)
    cleaned = "".join(filtered_chars)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not include_niqqud:
        cleaned = strip_niqqud(cleaned)
    return cleaned


def fetch_passage_from_sefaria(
    book_name: str,
    start_chapter: int,
    start_verse: int,
    end_chapter: int,
    end_verse: int,
    include_niqqud: bool = True,
) -> Dict[str, object]:
    canonical_book = resolve_book_name(book_name)
    verses: List[Tuple[str, str]] = []

    for chapter in range(start_chapter, end_chapter + 1):
        response = requests.get(
            f"https://www.sefaria.org/api/texts/{canonical_book}.{chapter}",
            params={"lang": "he"},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        chapter_text = payload.get("he", [])
        if not isinstance(chapter_text, list):
            raise ValueError("Unexpected response from Sefaria API.")

        first_verse = start_verse if chapter == start_chapter else 1
        last_verse = end_verse if chapter == end_chapter else len(chapter_text)
        for verse_number in range(first_verse, last_verse + 1):
            if 1 <= verse_number <= len(chapter_text):
                verse_text = clean_sefaria_hebrew_text(
                    chapter_text[verse_number - 1],
                    include_niqqud=include_niqqud,
                )
                verses.append((f"{canonical_book} {chapter}:{verse_number}", verse_text))

    if not verses:
        raise ValueError("No verses were returned for the requested range.")

    return {
        "book": canonical_book,
        "start_ref": f"{canonical_book} {start_chapter}:{start_verse}",
        "end_ref": f"{canonical_book} {end_chapter}:{end_verse}",
        "verses": verses,
        "text": " ".join(text for _, text in verses),
    }


def layout_text_image(
    text: str,
    font_path: str,
    font_size: int,
    max_line_width: int,
    line_spacing: int,
    margin: int = 40,
    background: str = "white",
    foreground: str = "black",
) -> Tuple[Image.Image, List[OCRWord]]:
    font = load_font(font_path, font_size)
    draw_probe = ImageDraw.Draw(Image.new("RGB", (10, 10), background))
    space_width = max(draw_probe.textbbox((0, 0), " ", font=font)[2], 8)
    line_height = draw_probe.textbbox((0, 0), "אבגדה", font=font)[3] + line_spacing

    tokens = [token for token in re.split(r"\s+", text.strip()) if token]
    lines: List[List[str]] = []
    current_line: List[str] = []
    current_width = 0

    for token in tokens:
        token_bbox = draw_probe.textbbox((0, 0), token, font=font)
        token_width = token_bbox[2] - token_bbox[0]
        proposed_width = token_width if not current_line else current_width + space_width + token_width
        if current_line and proposed_width > max_line_width:
            lines.append(current_line)
            current_line = [token]
            current_width = token_width
        else:
            current_line.append(token)
            current_width = proposed_width

    if current_line:
        lines.append(current_line)

    image_width = max_line_width + (margin * 2)
    image_height = (len(lines) * line_height) + (margin * 2)
    image = Image.new("RGB", (image_width, image_height), background)
    draw = ImageDraw.Draw(image)

    words: List[OCRWord] = []
    y = margin
    for line in lines:
        x = image_width - margin
        for token in line:
            bbox = draw.textbbox((0, 0), token, font=font)
            token_width = bbox[2] - bbox[0]
            token_height = bbox[3] - bbox[1]
            x -= token_width
            draw.text((x, y), token, font=font, fill=foreground)
            words.append(
                OCRWord(
                    word=token,
                    normalized=normalize_word(token),
                    x=int(x),
                    y=int(y),
                    w=int(token_width),
                    h=int(token_height),
                )
            )
            x -= space_width
        y += line_height

    return image, words


def split_passage_into_slides(verses: Sequence[Tuple[str, str]], slide_count: int) -> List[str]:
    count = max(int(slide_count or 1), 1)
    verse_texts = [text for _ref, text in verses if text.strip()]
    if not verse_texts:
        return []
    if count <= 1 or len(verse_texts) == 1:
        return [" ".join(verse_texts)]

    chunk_size = max(1, len(verse_texts) // count)
    remainder = len(verse_texts) % count
    slides: List[str] = []
    start = 0
    for index in range(count):
        extra = 1 if index < remainder else 0
        end = min(start + chunk_size + extra, len(verse_texts))
        if start >= len(verse_texts):
            break
        slides.append(" ".join(verse_texts[start:end]))
        start = end
    return [slide for slide in slides if slide.strip()]


def layout_text_slides(
    slide_texts: Sequence[str],
    font_path: str,
    font_size: int,
    max_line_width: int,
    line_spacing: int,
    margin: int = 40,
    background: str = "white",
    foreground: str = "black",
) -> Tuple[List[Image.Image], List[OCRWord]]:
    images: List[Image.Image] = []
    words: List[OCRWord] = []
    for slide_index, slide_text in enumerate(slide_texts):
        image, slide_words = layout_text_image(
            slide_text,
            font_path,
            font_size,
            max_line_width,
            line_spacing,
            margin=margin,
            background=background,
            foreground=foreground,
        )
        for word in slide_words:
            word.slide_index = slide_index
        images.append(image)
        words.extend(slide_words)

    if images:
        target_width = max(image.width for image in images)
        target_height = max(image.height for image in images)
        normalized_images: List[Image.Image] = []
        for image in images:
            if image.width == target_width and image.height == target_height:
                normalized_images.append(image)
            else:
                canvas = Image.new("RGB", (target_width, target_height), background)
                canvas.paste(image, (0, 0))
                normalized_images.append(canvas)
        images = normalized_images

    return images, words


def build_preview_strip(images: Sequence[Image.Image], spacing: int = 24, background: str = "white") -> Image.Image:
    if not images:
        return Image.new("RGB", (800, 600), background)
    if len(images) == 1:
        return images[0].copy()
    width = max(image.width for image in images)
    height = sum(image.height for image in images) + (spacing * (len(images) - 1))
    canvas = Image.new("RGB", (width, height), background)
    y = 0
    for image in images:
        x = (width - image.width) // 2
        canvas.paste(image, (x, y))
        y += image.height + spacing
    return canvas


def sanitize_name(value: str) -> str:
    return re.sub(r"[^\u0590-\u05FFA-Za-z0-9._-]+", "_", value).strip("_") or "torah_text"


def build_reference_stem(book_name: str, start_chapter: str, start_verse: str, end_chapter: str, end_verse: str) -> str:
    return sanitize_name(f"{book_name}_{start_chapter}_{start_verse}_{end_chapter}_{end_verse}")


def build_export_stem(book_name: str, start_chapter: str, start_verse: str, end_chapter: str, end_verse: str) -> str:
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    return f"{build_reference_stem(book_name, start_chapter, start_verse, end_chapter, end_verse)}_{timestamp}"


def build_synced_words_from_layout(
    layout_words: Sequence[OCRWord],
    audio_path: str,
    model_name: str = "small",
    progress_callback: ProgressCallback = None,
):
    whisper_result = transcribe_audio(audio_path, model_name=model_name, progress_callback=progress_callback)
    timed_words = extract_timed_words(whisper_result)
    return whisper_result, sync_words(layout_words, timed_words)


def render_static_video(
    image_path: str,
    audio_path: str,
    output_path: str,
    progress_callback: ProgressCallback = None,
) -> None:
    if progress_callback:
        progress_callback(0.05, "Preparing static video...")
    audio = AudioFileClip(audio_path)
    clip = ImageClip(image_path).with_duration(audio.duration).with_audio(audio)
    if progress_callback:
        progress_callback(0.4, "Writing static video file...")
    clip.write_videofile(
        output_path,
        fps=25,
        codec="libx264",
        audio_codec="aac",
        ffmpeg_params=["-movflags", "+faststart"],
        pixel_format="yuv420p",
    )
    audio.close()
    clip.close()
    if progress_callback:
        progress_callback(1.0, "Static video completed")


def render_slide_segment_video(
    image_path: str,
    audio_path: str,
    synced_words: Sequence[object],
    output_path: str,
    style: RenderStyle,
    padding_start: float = 1.5,
    padding_end: float = 1.0,
    progress_callback: ProgressCallback = None,
) -> None:
    if not synced_words:
        raise ValueError("Slide video requires synced words for the target slide.")

    def silence_frame(t):
        if np.isscalar(t):
            return np.array([0.0], dtype=np.float32)
        return np.zeros((len(t), 1), dtype=np.float32)

    source_audio = AudioFileClip(audio_path)
    audio_duration = max(float(source_audio.duration or 0.0), 0.0)
    slide_start = max(min(word.start for word in synced_words), 0.0)
    slide_end = min(max(word.end for word in synced_words), audio_duration)
    if slide_end <= slide_start:
        slide_end = min(slide_start + 0.05, audio_duration)
    base_audio = source_audio.subclipped(slide_start, slide_end)
    silence_before = AudioClip(silence_frame, duration=padding_start, fps=44100)
    silence_after = AudioClip(silence_frame, duration=padding_end, fps=44100)
    padded_audio = concatenate_audioclips([silence_before, base_audio, silence_after])
    with NamedTemporaryFile(suffix=".wav", delete=False) as temp_audio_file:
        temp_audio_path = temp_audio_file.name
    padded_audio.write_audiofile(temp_audio_path, fps=44100, nbytes=2, codec="pcm_s16le", logger=None)

    adjusted_words = []
    for word in synced_words:
        payload = dict(word.__dict__)
        payload["start"] = (word.start - slide_start) + padding_start
        payload["end"] = (word.end - slide_start) + padding_start
        adjusted_words.append(type(word)(**payload))

    render_video(
        image_path=image_path,
        audio_path=temp_audio_path,
        synced_words=adjusted_words,
        output_path=output_path,
        style=style,
        progress_callback=progress_callback,
    )

    base_audio.close()
    source_audio.close()
    silence_before.close()
    silence_after.close()
    padded_audio.close()
    Path(temp_audio_path).unlink(missing_ok=True)
