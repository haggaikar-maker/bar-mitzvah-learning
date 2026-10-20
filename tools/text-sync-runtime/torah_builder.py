from __future__ import annotations

import json
import re
import shutil
import threading
import traceback
import time
import unicodedata
from dataclasses import dataclass, field
from tempfile import NamedTemporaryFile, TemporaryDirectory
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import requests
try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext, ttk
except ImportError:
    # The worker uses the layout functions only; the desktop UI is optional.
    tk = None
    filedialog = messagebox = scrolledtext = ttk = None
from PIL import Image, ImageChops, ImageDraw, ImageFont
try:
    from PIL import ImageTk
except (ImportError, OSError):
    # The worker uses layout functions only; Tk may be unavailable in headless containers.
    ImageTk = None
from moviepy import AudioClip, AudioFileClip, ImageClip, concatenate_audioclips

from media_tools import FFmpegAudioRecorder, FFplayAudioPlayer
from sync_core import (
    OCRWord,
    ProgressCallback,
    RenderStyle,
    extract_timed_words,
    load_font,
    normalize_word,
    render_video,
    save_json,
    sync_words,
    synced_words_to_json,
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

BLANK_LINE_TOKEN = "__BLANK__"
LAYOUT_WORD_BREAK_CHARS = {'־', ':', '׃', '|', ',', ';', '׀'}
COUNT_LAYOUT_HEADER = "@COUNT_LAYOUT_V1"
TIKKUN_DATA_DIR = Path(__file__).resolve().parent / "tikkun_data"
TIKKUN_TORAH_PAGES_DIR = TIKKUN_DATA_DIR / "pages" / "torah"
TIKKUN_TORAH_TOC_FILE = TIKKUN_DATA_DIR / "tables-of-contents" / "torah.json"
TIKKUN_TORAH_BOOK_IDS = {
    "Genesis": 1,
    "Exodus": 2,
    "Leviticus": 3,
    "Numbers": 4,
    "Deuteronomy": 5,
}
_TIKKUN_TORAH_CACHE: Dict[bool, Optional[Dict[str, object]]] = {}


def resolve_book_name(book_name: str) -> str:
    cleaned = (book_name or "").strip().lower()
    if cleaned in BOOK_ALIASES:
        return BOOK_ALIASES[cleaned]
    raise ValueError("שם הספר אינו נתמך.")


HEBREW_NUMERAL_VALUES = {
    "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
    "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
    "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90, "ק": 100, "ר": 200,
    "ש": 300, "ת": 400,
}


def parse_hebrew_number(value: str) -> int:
    cleaned = (value or "").strip().replace('"', "").replace("׳", "").replace("״", "").replace("'", "")
    if not cleaned:
        raise ValueError("חסר מספר פרק/פסוק")
    if cleaned.isdigit():
        return int(cleaned)
    total = 0
    for char in cleaned:
        if char not in HEBREW_NUMERAL_VALUES:
            raise ValueError(f"לא ניתן לפרש את המספר: {value}")
        total += HEBREW_NUMERAL_VALUES[char]
    return total


def strip_niqqud(text: str) -> str:
    return "".join(char for char in text if normalize_word(char) or char.isspace() or char in {'"', "'", "״", "׳"})


def normalize_layout_word_breaks(text: str) -> str:
    normalized = text or ""
    for char in LAYOUT_WORD_BREAK_CHARS:
        normalized = normalized.replace(char, " ")
    return re.sub(r"\s+", " ", normalized).strip()


def extract_layout_tokens(text: str) -> List[str]:
    cleaned = normalize_layout_word_breaks(strip_layout_control_tokens(text))
    tokens: List[str] = []
    for token in re.split(r"\s+", cleaned):
        stripped = token.strip("".join(LAYOUT_WORD_BREAK_CHARS) + "\"'׳״")
        if stripped:
            tokens.append(stripped)
    return tokens


def is_cantillation_mark(char: str) -> bool:
    codepoint = ord(char)
    return 0x0591 <= codepoint <= 0x05AF


def strip_cantillation(text: str) -> str:
    return "".join(char for char in text if not is_cantillation_mark(char))


def has_cantillation(text: str) -> bool:
    return any(is_cantillation_mark(char) for char in text)


@dataclass
class LayoutLine:
    left_text: str = ""
    center_text: str = ""
    right_text: str = ""
    markers: List[str] = field(default_factory=list)
    is_blank: bool = False


@dataclass
class LayoutCountRow:
    right_count: int = 0
    center_count: int = 0
    left_count: int = 0


@dataclass
class LayoutColumn:
    lines: List[LayoutLine] = field(default_factory=list)


@dataclass
class LayoutPage:
    columns: List[LayoutColumn] = field(default_factory=list)


@dataclass
class TikkunSegmentData:
    text: str
    tokens: List[str]
    normalized_tokens: List[str]


@dataclass
class TikkunLineData:
    page_number: int
    line_number: int
    segments: List[TikkunSegmentData] = field(default_factory=list)
    is_petucha: bool = False


@dataclass
class TikkunTokenRecord:
    page_number: int
    line_number: int
    segment_index: int
    token_index: int
    raw_token: str
    normalized_token: str


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
        cleaned = normalize_layout_word_breaks(cleaned)
    return cleaned


def clean_tikkun_segment_text(text: str, include_niqqud: bool = True) -> str:
    cleaned = (text or "").replace("\n", " ").replace("\r", " ")
    cleaned = re.sub(r"#\([^)]*\)", " ", cleaned)
    cleaned = re.sub(r"#\[[^\]]*\]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return clean_sefaria_hebrew_text(cleaned, include_niqqud=include_niqqud)


def parse_passage_ref(ref_text: str) -> Optional[Tuple[str, int, int]]:
    match = re.fullmatch(r"(.+?)\s+(\d+):(\d+)", (ref_text or "").strip())
    if not match:
        return None
    return match.group(1), int(match.group(2)), int(match.group(3))


def load_tikkun_torah_data(include_niqqud: bool = True) -> Optional[Dict[str, object]]:
    cached = _TIKKUN_TORAH_CACHE.get(include_niqqud)
    if cached is not None:
        return cached

    if not TIKKUN_TORAH_PAGES_DIR.exists() or not TIKKUN_TORAH_TOC_FILE.exists():
        _TIKKUN_TORAH_CACHE[include_niqqud] = None
        return None

    toc_payload = json.loads(TIKKUN_TORAH_TOC_FILE.read_text(encoding="utf-8"))
    verse_locations: Dict[Tuple[int, int, int], Tuple[int, int]] = {}
    for book_key, chapters in toc_payload.items():
        for chapter_key, verses in chapters.items():
            for verse_key, location in verses.items():
                verse_locations[(int(book_key), int(chapter_key), int(verse_key))] = (
                    int(location["p"]),
                    int(location["l"]),
                )

    line_map: Dict[Tuple[int, int], TikkunLineData] = {}
    first_token_index_by_line: Dict[Tuple[int, int], int] = {}
    token_stream: List[TikkunTokenRecord] = []
    stream_norms: List[str] = []

    def page_sort_key(path: Path) -> int:
        try:
            return int(path.stem)
        except ValueError:
            return 0

    for page_path in sorted(TIKKUN_TORAH_PAGES_DIR.glob("*.json"), key=page_sort_key):
        page_number = page_sort_key(page_path)
        page_payload = json.loads(page_path.read_text(encoding="utf-8"))
        for line_number, entry in enumerate(page_payload, start=1):
            segments: List[TikkunSegmentData] = []
            for segment_group in entry.get("text", []):
                raw_parts = segment_group if isinstance(segment_group, list) else [segment_group]
                for raw_part in raw_parts:
                    cleaned_segment = clean_tikkun_segment_text(str(raw_part), include_niqqud=include_niqqud)
                    segment_tokens = extract_layout_tokens(cleaned_segment)
                    normalized_tokens = [normalize_word(token) for token in segment_tokens]
                    if cleaned_segment or segment_tokens:
                        segments.append(
                            TikkunSegmentData(
                                text=cleaned_segment,
                                tokens=segment_tokens,
                                normalized_tokens=normalized_tokens,
                            )
                        )

            line_data = TikkunLineData(
                page_number=page_number,
                line_number=line_number,
                segments=segments,
                is_petucha=bool(entry.get("isPetucha")),
            )
            line_map[(page_number, line_number)] = line_data

            for segment_index, segment in enumerate(segments):
                if segment.tokens and (page_number, line_number) not in first_token_index_by_line:
                    first_token_index_by_line[(page_number, line_number)] = len(token_stream)
                for token_index, (raw_token, normalized_token) in enumerate(zip(segment.tokens, segment.normalized_tokens)):
                    token_stream.append(
                        TikkunTokenRecord(
                            page_number=page_number,
                            line_number=line_number,
                            segment_index=segment_index,
                            token_index=token_index,
                            raw_token=raw_token,
                            normalized_token=normalized_token,
                        )
                    )
                    stream_norms.append(normalized_token)

    data = {
        "verse_locations": verse_locations,
        "line_map": line_map,
        "first_token_index_by_line": first_token_index_by_line,
        "token_stream": token_stream,
        "stream_norms": stream_norms,
    }
    _TIKKUN_TORAH_CACHE[include_niqqud] = data
    return data


def find_tikkun_token_subsequence(
    stream_norms: Sequence[str],
    target_norms: Sequence[str],
    start_index: int,
    end_index: Optional[int] = None,
) -> Optional[int]:
    if not target_norms:
        return start_index
    max_start = len(stream_norms) - len(target_norms)
    if max_start < start_index:
        return None
    effective_end = min(end_index if end_index is not None else max_start + 1, max_start + 1)
    first_token = target_norms[0]
    for index in range(max(start_index, 0), max(effective_end, 0)):
        if stream_norms[index] != first_token:
            continue
        if list(stream_norms[index:index + len(target_norms)]) == list(target_norms):
            return index
    return None


def line_layout_from_tikkun_selection(
    line_data: TikkunLineData,
    selections: Dict[int, Dict[str, object]],
) -> LayoutLine:
    if not selections:
        return LayoutLine(is_blank=True)

    if len(line_data.segments) >= 2:
        right_tokens = list(selections.get(0, {}).get("tokens", []))
        left_tokens = list(selections.get(1, {}).get("tokens", []))
        center_chunks = [
            " ".join(selections[index]["tokens"]).strip()
            for index in range(2, len(line_data.segments) - 1)
            if selections.get(index)
        ]
        return LayoutLine(
            right_text=" ".join(right_tokens).strip(),
            center_text=" ".join(chunk for chunk in center_chunks if chunk).strip(),
            left_text=" ".join(left_tokens).strip(),
            is_blank=not (right_tokens or left_tokens or center_chunks),
        )

    segment = line_data.segments[0] if line_data.segments else None
    segment_selection = selections.get(0)
    if segment is None or not segment_selection:
        return LayoutLine(is_blank=True)

    selected_tokens = list(segment_selection.get("tokens", []))
    if not selected_tokens:
        return LayoutLine(is_blank=True)

    selected_text = " ".join(selected_tokens).strip()
    first_index = int(segment_selection.get("first", 0))
    last_index = int(segment_selection.get("last", len(segment.tokens) - 1))
    full_segment = first_index <= 0 and last_index >= len(segment.tokens) - 1
    left_cropped = first_index > 0
    right_cropped = last_index < len(segment.tokens) - 1

    if full_segment:
        if line_data.is_petucha:
            return LayoutLine(right_text=selected_text)
        return LayoutLine(center_text=selected_text)
    if left_cropped and right_cropped:
        return LayoutLine(center_text=selected_text)
    if left_cropped:
        return LayoutLine(left_text=selected_text)
    if right_cropped:
        return LayoutLine(right_text=selected_text)
    return LayoutLine(center_text=selected_text)


def build_readable_text_from_layout_pages(pages: Sequence[LayoutPage]) -> str:
    lines: List[str] = []
    for page_index, page in enumerate(pages):
        if page_index:
            lines.append("")
        for column in page.columns:
            for line in column.lines:
                if line.is_blank and not (line.right_text or line.center_text or line.left_text):
                    lines.append("")
                    continue
                parts = [part for part in (line.right_text, line.center_text, line.left_text) if part]
                lines.append("    ".join(parts).strip())
    return "\n".join(lines).strip()


def line_to_full_layout(line_data: TikkunLineData) -> LayoutLine:
    if not line_data.segments:
        return LayoutLine(is_blank=True)
    if len(line_data.segments) >= 2:
        center_chunks = [segment.text for segment in line_data.segments[1:-1] if segment.text.strip()]
        return LayoutLine(
            right_text=line_data.segments[0].text.strip(),
            center_text=" ".join(center_chunks).strip(),
            left_text=line_data.segments[-1].text.strip(),
            is_blank=not any(segment.text.strip() for segment in line_data.segments),
        )
    single_text = line_data.segments[0].text.strip()
    if line_data.is_petucha:
        return LayoutLine(right_text=single_text, is_blank=not single_text)
    return LayoutLine(center_text=single_text, is_blank=not single_text)


def tikkun_location_key(location: Tuple[int, int]) -> Tuple[int, int]:
    return (int(location[0]), int(location[1]))


def get_next_tikkun_verse_location(
    verse_locations: Dict[Tuple[int, int, int], Tuple[int, int]],
    book_id: int,
    chapter_number: int,
    verse_number: int,
) -> Optional[Tuple[int, int]]:
    current_key = (book_id, chapter_number, verse_number)
    current_location = verse_locations.get(current_key)
    if current_location is None:
        return None

    ordered_keys = sorted(
        (key for key in verse_locations.keys() if key[0] == book_id),
        key=lambda item: (item[1], item[2]),
    )
    try:
        current_index = ordered_keys.index(current_key)
    except ValueError:
        return None
    if current_index + 1 >= len(ordered_keys):
        return None
    return verse_locations.get(ordered_keys[current_index + 1])


def find_tikkun_verse_token_span(
    *,
    token_stream: Sequence[TikkunTokenRecord],
    stream_norms: Sequence[str],
    first_token_index_by_line: Dict[Tuple[int, int], int],
    verse_locations: Dict[Tuple[int, int, int], Tuple[int, int]],
    book_id: int,
    chapter_number: int,
    verse_number: int,
    verse_text: str,
) -> Optional[Tuple[int, int]]:
    verse_location = verse_locations.get((book_id, chapter_number, verse_number))
    if verse_location is None:
        return None

    target_norms = [normalize_word(token) for token in extract_layout_tokens(verse_text) if normalize_word(token)]
    if not target_norms:
        return None

    hinted_index = first_token_index_by_line.get(verse_location, 0)
    local_start = max(hinted_index - 24, 0)
    local_end = min(hinted_index + 240, len(stream_norms))
    match_index = find_tikkun_token_subsequence(stream_norms, target_norms, local_start, local_end)
    if match_index is None:
        broad_start = max(hinted_index - 80, 0)
        broad_end = min(hinted_index + 800, len(stream_norms))
        match_index = find_tikkun_token_subsequence(stream_norms, target_norms, broad_start, broad_end)
    if match_index is None:
        return None

    end_index = match_index + len(target_norms) - 1
    if end_index >= len(token_stream):
        return None
    return (match_index, end_index)


def build_tikkun_line_selections_from_token_span(
    token_stream: Sequence[TikkunTokenRecord],
    start_index: int,
    end_index: int,
) -> Dict[Tuple[int, int], Dict[int, Dict[str, object]]]:
    selections: Dict[Tuple[int, int], Dict[int, Dict[str, object]]] = {}
    if start_index < 0 or end_index < start_index:
        return selections

    for record in token_stream[start_index:end_index + 1]:
        line_key = (record.page_number, record.line_number)
        line_selection = selections.setdefault(line_key, {})
        segment_selection = line_selection.setdefault(
            record.segment_index,
            {"tokens": [], "first": record.token_index, "last": record.token_index},
        )
        segment_selection["tokens"].append(record.raw_token)
        segment_selection["first"] = min(int(segment_selection["first"]), record.token_index)
        segment_selection["last"] = max(int(segment_selection["last"]), record.token_index)
    return selections


def build_tikkun_layout_pages_for_passage(
    passage: Dict[str, object],
    include_niqqud: bool = True,
) -> Optional[List[LayoutPage]]:
    canonical_book = str(passage.get("book", "") or "").strip()
    book_id = TIKKUN_TORAH_BOOK_IDS.get(canonical_book)
    if not book_id:
        return None

    tikkun_data = load_tikkun_torah_data(include_niqqud=include_niqqud)
    if not tikkun_data:
        return None

    line_map: Dict[Tuple[int, int], TikkunLineData] = tikkun_data["line_map"]  # type: ignore[assignment]
    verse_locations: Dict[Tuple[int, int, int], Tuple[int, int]] = tikkun_data["verse_locations"]  # type: ignore[assignment]
    first_token_index_by_line: Dict[Tuple[int, int], int] = tikkun_data["first_token_index_by_line"]  # type: ignore[assignment]
    token_stream: List[TikkunTokenRecord] = tikkun_data["token_stream"]  # type: ignore[assignment]
    stream_norms: List[str] = tikkun_data["stream_norms"]  # type: ignore[assignment]
    verse_refs = passage.get("verses", [])
    if not verse_refs:
        return None
    start_ref = parse_passage_ref(verse_refs[0][0])
    end_ref = parse_passage_ref(verse_refs[-1][0])
    if not start_ref or not end_ref:
        return None

    _start_book, start_chapter, start_verse = start_ref
    _end_book, end_chapter, end_verse = end_ref
    start_location = verse_locations.get((book_id, start_chapter, start_verse))
    if start_location is None:
        return None
    start_span = find_tikkun_verse_token_span(
        token_stream=token_stream,
        stream_norms=stream_norms,
        first_token_index_by_line=first_token_index_by_line,
        verse_locations=verse_locations,
        book_id=book_id,
        chapter_number=start_chapter,
        verse_number=start_verse,
        verse_text=verse_refs[0][1],
    )
    end_span = find_tikkun_verse_token_span(
        token_stream=token_stream,
        stream_norms=stream_norms,
        first_token_index_by_line=first_token_index_by_line,
        verse_locations=verse_locations,
        book_id=book_id,
        chapter_number=end_chapter,
        verse_number=end_verse,
        verse_text=verse_refs[-1][1],
    )

    if start_span is not None and end_span is not None and end_span[1] >= start_span[0]:
        selections = build_tikkun_line_selections_from_token_span(token_stream, start_span[0], end_span[1])
        selected_line_keys = sorted(selections.keys(), key=lambda item: (item[0], item[1]))
        if selected_line_keys:
            pages: List[LayoutPage] = []
            page_numbers = sorted({page_number for page_number, _ in selected_line_keys})
            for page_number in page_numbers:
                page_lines = [
                    line_layout_from_tikkun_selection(line_map[line_key], selections.get(line_key, {}))
                    for line_key in selected_line_keys
                    if line_key[0] == page_number
                ]
                while page_lines and page_lines[0].is_blank and not (page_lines[0].right_text or page_lines[0].center_text or page_lines[0].left_text):
                    page_lines.pop(0)
                while page_lines and page_lines[-1].is_blank and not (page_lines[-1].right_text or page_lines[-1].center_text or page_lines[-1].left_text):
                    page_lines.pop()
                if page_lines:
                    pages.append(LayoutPage(columns=[LayoutColumn(lines=page_lines)]))
            if pages:
                return pages

    end_exclusive = get_next_tikkun_verse_location(verse_locations, book_id, end_chapter, end_verse)
    ordered_line_keys = sorted(line_map.keys(), key=lambda item: (item[0], item[1]))
    selected_line_keys: List[Tuple[int, int]] = []
    start_key = tikkun_location_key(start_location)
    end_key = tikkun_location_key(end_exclusive) if end_exclusive else None
    for line_key in ordered_line_keys:
        if tikkun_location_key(line_key) < start_key:
            continue
        if end_key is not None and tikkun_location_key(line_key) >= end_key:
            break
        selected_line_keys.append(line_key)

    if not selected_line_keys:
        return None

    pages: List[LayoutPage] = []
    page_numbers = sorted({page_number for page_number, _ in selected_line_keys})
    for page_number in page_numbers:
        page_lines = [
            line_to_full_layout(line_map[line_key])
            for line_key in selected_line_keys
            if line_key[0] == page_number
        ]
        while page_lines and page_lines[0].is_blank and not (page_lines[0].right_text or page_lines[0].center_text or page_lines[0].left_text):
            page_lines.pop(0)
        while page_lines and page_lines[-1].is_blank and not (page_lines[-1].right_text or page_lines[-1].center_text or page_lines[-1].left_text):
            page_lines.pop()
        if page_lines:
            pages.append(LayoutPage(columns=[LayoutColumn(lines=page_lines)]))

    return pages or None


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
            raise ValueError("Unexpected response from Sefaria API")

        first_verse = start_verse if chapter == start_chapter else 1
        last_verse = end_verse if chapter == end_chapter else len(chapter_text)
        for verse_number in range(first_verse, last_verse + 1):
            if verse_number < 1 or verse_number > len(chapter_text):
                continue
            verse_text = clean_sefaria_hebrew_text(chapter_text[verse_number - 1], include_niqqud=include_niqqud)
            verses.append((f"{canonical_book} {chapter}:{verse_number}", verse_text))

    if not verses:
        raise ValueError("No verses were returned for the requested range")

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
    cantillation_color: Optional[str] = None,
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
        proposed = token_width if not current_line else current_width + space_width + token_width
        if current_line and proposed > max_line_width:
            lines.append(current_line)
            current_line = [token]
            current_width = token_width
        else:
            current_line.append(token)
            current_width = proposed

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
            if cantillation_color and has_cantillation(token):
                plain_token = strip_cantillation(token)
                plain_bbox = draw.textbbox((0, 0), plain_token, font=font)
                left = min(bbox[0], plain_bbox[0])
                top = min(bbox[1], plain_bbox[1])
                right = max(bbox[2], plain_bbox[2])
                bottom = max(bbox[3], plain_bbox[3])
                mask_width = max(right - left, 1)
                mask_height = max(bottom - top, 1)
                origin = (-left, -top)
                full_mask = Image.new("L", (mask_width, mask_height), 0)
                plain_mask = Image.new("L", (mask_width, mask_height), 0)
                ImageDraw.Draw(full_mask).text(origin, token, font=font, fill=255)
                ImageDraw.Draw(plain_mask).text(origin, plain_token, font=font, fill=255)
                cantillation_mask = ImageChops.subtract(full_mask, plain_mask)
                color_layer = Image.new("RGB", (mask_width, mask_height), cantillation_color)
                image.paste(color_layer, (int(x + left), int(y + top)), cantillation_mask)
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


def build_initial_manual_layout(verses: Sequence[Tuple[str, str]], include_niqqud: bool = False) -> str:
    return build_layout_file_text(verses, include_niqqud=include_niqqud)


def parse_manual_layout_text(layout_text: str) -> List[LayoutPage]:
    pages: List[LayoutPage] = []
    current_page = LayoutPage(columns=[LayoutColumn()])
    current_column = current_page.columns[0]
    current_line = LayoutLine()

    def append_text(target: str, chunk: str) -> str:
        cleaned = chunk.strip()
        if not cleaned:
            return target
        if not target:
            return cleaned
        return f"{target} {cleaned}"

    def finalize_line() -> None:
        nonlocal current_line
        if current_line.left_text or current_line.center_text or current_line.right_text or current_line.markers or current_line.is_blank:
            current_column.lines.append(current_line)
        current_line = LayoutLine()

    def finalize_column() -> None:
        nonlocal current_column
        finalize_line()
        if current_column.lines:
            current_page.columns.append(LayoutColumn())
            current_column = current_page.columns[-1]

    def finalize_page() -> None:
        nonlocal current_page, current_column
        finalize_line()
        current_page.columns = [column for column in current_page.columns if column.lines]
        if current_page.columns:
            pages.append(current_page)
        current_page = LayoutPage(columns=[LayoutColumn()])
        current_column = current_page.columns[0]

    for raw_line in layout_text.replace("\r", "").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if line == "^":
            finalize_column()
            continue
        if line == "#":
            finalize_page()
            continue

        if line.endswith("^"):
            line = line[:-1].rstrip()
            trailing_column_break = True
        else:
            trailing_column_break = False

        if line.endswith("#"):
            line = line[:-1].rstrip()
            trailing_page_break = True
        else:
            trailing_page_break = False

        tagged_line = line
        align_matches = re.findall(r"<([LCR])>", tagged_line)
        align = align_matches[-1] if align_matches else "C"

        marker_matches = re.findall(r"\{[פס]\}", tagged_line)
        current_line.markers.extend(marker_matches)
        tagged_line = re.sub(r"\{[פס]\}", " ", tagged_line).strip()

        if tagged_line == BLANK_LINE_TOKEN:
            current_line.is_blank = True
            finalize_line()
            if trailing_page_break:
                finalize_page()
            elif trailing_column_break:
                finalize_column()
            continue

        if tagged_line.endswith("|"):
            tagged_line = tagged_line[:-1].rstrip()

        current_align = "C"
        if align_matches:
            segments = re.split(r"(<[LCR]>)", tagged_line)
            for segment in segments:
                segment = segment.strip()
                if not segment:
                    continue
                if re.fullmatch(r"<[LCR]>", segment):
                    current_align = segment[1]
                    continue
                if current_align == "L":
                    current_line.left_text = append_text(current_line.left_text, segment)
                elif current_align == "R":
                    current_line.right_text = append_text(current_line.right_text, segment)
                else:
                    current_line.center_text = append_text(current_line.center_text, segment)
        else:
            line = tagged_line
            if align == "L":
                current_line.left_text = append_text(current_line.left_text, line)
            elif align == "C":
                current_line.center_text = append_text(current_line.center_text, line)
            else:
                current_line.right_text = append_text(current_line.right_text, line)

        finalize_line()
        if trailing_page_break:
            finalize_page()
        elif trailing_column_break:
            finalize_column()

    finalize_page()
    return pages


def build_manual_line_text(line: LayoutLine) -> str:
    parts = [part for part in (line.right_text, line.center_text, line.left_text) if part]
    return " ".join(parts).strip()


def serialize_manual_layout_line(line: LayoutLine) -> str:
    if line.is_blank and not line.left_text and not line.center_text and not line.right_text and not line.markers:
        return BLANK_LINE_TOKEN

    parts: List[str] = []
    if line.right_text:
        parts.append(f"<R> {line.right_text}")
    if line.center_text:
        if line.right_text or line.left_text:
            parts.append(f"<C> {line.center_text}")
        else:
            parts.append(line.center_text)
    if line.left_text:
        parts.append(f"<L> {line.left_text}")
    if line.markers:
        parts.extend(line.markers)
    return " ".join(part.strip() for part in parts if part.strip()).strip()


def serialize_manual_layout_pages(pages: Sequence[LayoutPage]) -> str:
    page_blocks: List[str] = []
    for page in pages:
        line_texts: List[str] = []
        for column in page.columns:
            for line in column.lines:
                line_texts.append(serialize_manual_layout_line(line))
            if column is not page.columns[-1]:
                line_texts.append("^")
        page_blocks.append("\n".join(line_texts).strip())
    return "\n#\n".join(block for block in page_blocks if block)


def clone_layout_line(line: LayoutLine) -> LayoutLine:
    return LayoutLine(
        left_text=line.left_text,
        center_text=line.center_text,
        right_text=line.right_text,
        markers=list(line.markers),
        is_blank=line.is_blank,
    )


def clone_layout_page(page: LayoutPage) -> LayoutPage:
    return LayoutPage(
        columns=[
            LayoutColumn(lines=[clone_layout_line(line) for line in column.lines])
            for column in page.columns
        ]
    )


def is_right_short_break_line(line: LayoutLine) -> bool:
    return bool(line.right_text and not line.center_text and not line.left_text)


def line_ends_at_verse_boundary(line: LayoutLine) -> bool:
    for text in (line.left_text, line.center_text, line.right_text):
        if text and text.strip().endswith("׃"):
            return True
    return False


def choose_layout_split_points(
    lines: Sequence[LayoutLine],
    slide_count: int,
    page_break_points: Optional[Sequence[int]] = None,
    min_lines_per_slide: int = 5,
    max_lines_per_slide: int = 10,
) -> List[int]:
    total_lines = len(lines)
    if slide_count <= 1 or total_lines <= 1:
        return []

    page_break_set = {point for point in (page_break_points or []) if 0 < point < total_lines}
    constraints_active = (
        max_lines_per_slide > 0
        and min_lines_per_slide > 0
        and (slide_count * min_lines_per_slide) <= total_lines <= (slide_count * max_lines_per_slide)
    )
    split_points: List[int] = []
    used = set()
    previous_point = 0
    for index in range(1, slide_count):
        target = round((total_lines * index) / slide_count)
        best_point = None
        best_score = None
        search_radius = max(6, total_lines // max(slide_count, 1))
        start = max(1, target - search_radius)
        end = min(total_lines - 1, target + search_radius)
        for point in range(start, end + 1):
            if point in used:
                continue
            current_chunk_size = point - previous_point
            remaining_slides = slide_count - index
            remaining_lines = total_lines - point
            fits_constraints = True
            constraint_penalty = 0
            if constraints_active:
                fits_constraints = (
                    min_lines_per_slide <= current_chunk_size <= max_lines_per_slide
                    and (remaining_slides * min_lines_per_slide) <= remaining_lines <= (remaining_slides * max_lines_per_slide)
                )
                if not fits_constraints:
                    continue
            else:
                if current_chunk_size < min_lines_per_slide:
                    constraint_penalty += (min_lines_per_slide - current_chunk_size) * 4
                elif current_chunk_size > max_lines_per_slide:
                    constraint_penalty += (current_chunk_size - max_lines_per_slide) * 3
            line_before = lines[point - 1]
            boundary_bonus = 0
            if point in page_break_set:
                boundary_bonus += 12
            if is_right_short_break_line(line_before):
                boundary_bonus += 8
            if line_ends_at_verse_boundary(line_before):
                boundary_bonus += 5
            if line_before.is_blank:
                boundary_bonus += 3
            score = abs(point - target) - boundary_bonus + constraint_penalty
            if best_score is None or score < best_score:
                best_score = score
                best_point = point
        if best_point is None:
            fallback = min(max(target, 1), total_lines - 1)
            if fallback in used:
                continue
            best_point = fallback
        used.add(best_point)
        split_points.append(best_point)
        previous_point = best_point
    return sorted(point for point in split_points if 0 < point < total_lines)


def split_manual_layout_for_slides(layout_text: str, slide_count: int) -> str:
    count = max(int(slide_count or 1), 1)
    if count <= 1:
        return layout_text

    parsed_pages = parse_manual_layout_text(layout_text)
    if not parsed_pages:
        return layout_text

    flattened_pages: List[Tuple[List[LayoutLine], LayoutPage]] = []
    flat_lines: List[LayoutLine] = []
    page_break_points: List[int] = []
    for page in parsed_pages:
        page_lines: List[LayoutLine] = []
        for column in page.columns:
            page_lines.extend(clone_layout_line(line) for line in column.lines)
        if page_lines:
            flattened_pages.append((page_lines, page))
            flat_lines.extend(page_lines)

    if len(flat_lines) <= 1:
        return layout_text

    min_lines_per_slide = 5
    max_lines_per_slide = 10
    min_feasible_count = max(1, (len(flat_lines) + max_lines_per_slide - 1) // max_lines_per_slide)
    max_feasible_count = max(1, len(flat_lines) // min_lines_per_slide)
    if min_feasible_count <= max_feasible_count:
        count = min(max(count, min_feasible_count), max_feasible_count)

    running_total = 0
    for page_lines, _page in flattened_pages[:-1]:
        running_total += len(page_lines)
        if 0 < running_total < len(flat_lines):
            page_break_points.append(running_total)

    split_points = choose_layout_split_points(
        flat_lines,
        count,
        page_break_points=page_break_points,
        min_lines_per_slide=min_lines_per_slide,
        max_lines_per_slide=max_lines_per_slide,
    )
    if not split_points:
        return layout_text

    new_pages: List[LayoutPage] = []
    start = 0
    for split_point in split_points + [len(flat_lines)]:
        chunk_lines = [clone_layout_line(line) for line in flat_lines[start:split_point]]
        if chunk_lines:
            new_pages.append(LayoutPage(columns=[LayoutColumn(lines=chunk_lines)]))
        start = split_point

    if not new_pages:
        return layout_text
    return serialize_manual_layout_pages(new_pages)


def build_editor_pages_from_layout_text(layout_text: str, lines_per_page: int) -> List[List[LayoutLine]]:
    parsed_pages = parse_manual_layout_text(layout_text)
    editor_pages: List[List[LayoutLine]] = []
    for page in parsed_pages:
        flattened_lines: List[LayoutLine] = []
        for column in page.columns:
            flattened_lines.extend(clone_layout_line(line) for line in column.lines)
        if not flattened_lines:
            flattened_lines = [LayoutLine(is_blank=True)]
        for start in range(0, len(flattened_lines), lines_per_page):
            chunk = [clone_layout_line(line) for line in flattened_lines[start:start + lines_per_page]]
            while len(chunk) < lines_per_page:
                chunk.append(LayoutLine(is_blank=True))
            editor_pages.append(chunk)
    if not editor_pages:
        editor_pages.append([LayoutLine(is_blank=True) for _ in range(lines_per_page)])
    return editor_pages


def count_words_in_text(text: str) -> int:
    return len(extract_layout_tokens(text))


def build_count_pages_from_layout_text(layout_text: str, lines_per_page: int) -> List[List[LayoutCountRow]]:
    parsed_pages = parse_manual_layout_text(layout_text)
    count_pages: List[List[LayoutCountRow]] = []
    for page in parsed_pages:
        rows: List[LayoutCountRow] = []
        for column in page.columns:
            for line in column.lines:
                rows.append(
                    LayoutCountRow(
                        right_count=count_words_in_text(line.right_text),
                        center_count=count_words_in_text(line.center_text),
                        left_count=count_words_in_text(line.left_text),
                    )
                )
        if not rows:
            rows = [LayoutCountRow()]
        for start in range(0, len(rows), lines_per_page):
            chunk = [LayoutCountRow(row.right_count, row.center_count, row.left_count) for row in rows[start:start + lines_per_page]]
            while len(chunk) < lines_per_page:
                chunk.append(LayoutCountRow())
            count_pages.append(chunk)
    if not count_pages:
        count_pages.append([LayoutCountRow() for _ in range(lines_per_page)])
    return count_pages


def extract_source_words_from_verses(verses: Sequence[Tuple[str, str]]) -> List[str]:
    words: List[str] = []
    for _ref, verse_text in verses:
        words.extend(extract_layout_tokens(verse_text))
    return words


def count_row_total(row: LayoutCountRow) -> int:
    return max(row.right_count, 0) + max(row.center_count, 0) + max(row.left_count, 0)


def trim_zero_rows(page_rows: Sequence[LayoutCountRow]) -> List[LayoutCountRow]:
    if not page_rows:
        return []

    start = 0
    end = len(page_rows)

    while start < end and count_row_total(page_rows[start]) == 0:
        start += 1
    while end > start and count_row_total(page_rows[end - 1]) == 0:
        end -= 1

    return [
        LayoutCountRow(
            right_count=row.right_count,
            center_count=row.center_count,
            left_count=row.left_count,
        )
        for row in page_rows[start:end]
    ]


def parse_optional_non_negative_int(value: str) -> int:
    cleaned = (value or "").strip()
    if not cleaned:
        return 0
    try:
        return max(int(cleaned), 0)
    except ValueError:
        return 0


def build_layout_page_from_count_rows(
    source_words: Sequence[str],
    page_rows: Sequence[LayoutCountRow],
    start_index: int = 0,
) -> Tuple[LayoutPage, int]:
    cursor = start_index
    lines: List[LayoutLine] = []
    effective_rows = trim_zero_rows(page_rows)

    def consume(count: int) -> str:
        nonlocal cursor
        if count <= 0:
            return ""
        chunk = list(source_words[cursor:cursor + count])
        cursor += len(chunk)
        return " ".join(chunk).strip()

    for row in effective_rows:
        if count_row_total(row) <= 0:
            lines.append(LayoutLine(is_blank=True))
            continue
        lines.append(
            LayoutLine(
                right_text=consume(max(row.right_count, 0)),
                center_text=consume(max(row.center_count, 0)),
                left_text=consume(max(row.left_count, 0)),
            )
        )

    if not lines:
        lines = [LayoutLine(is_blank=True)]

    return LayoutPage(columns=[LayoutColumn(lines=lines)]), cursor


def build_layout_pages_from_count_pages(
    source_words: Sequence[str],
    count_pages: Sequence[Sequence[LayoutCountRow]],
) -> List[LayoutPage]:
    pages: List[LayoutPage] = []
    cursor = 0
    for page_rows in count_pages:
        page, cursor = build_layout_page_from_count_rows(source_words, page_rows, cursor)
        pages.append(page)
    return pages


def build_count_draft_pages(
    source_text: str,
    font_path: str,
    font_size: int,
    max_line_width: int,
    lines_per_page: int,
) -> List[List[LayoutCountRow]]:
    wrapped_lines = wrap_text_for_manual_layout(source_text, font_path, font_size, max_line_width)
    if not wrapped_lines:
        return [[LayoutCountRow() for _ in range(lines_per_page)]]

    rows = [LayoutCountRow(center_count=count_words_in_text(line)) for line in wrapped_lines]
    pages: List[List[LayoutCountRow]] = []
    for start in range(0, len(rows), lines_per_page):
        chunk = [LayoutCountRow(row.right_count, row.center_count, row.left_count) for row in rows[start:start + lines_per_page]]
        while len(chunk) < lines_per_page:
            chunk.append(LayoutCountRow())
        pages.append(chunk)
    return pages


def serialize_count_layout_pages(count_pages: Sequence[Sequence[LayoutCountRow]], lines_per_page: int) -> str:
    lines = [f"{COUNT_LAYOUT_HEADER} lines_per_page={max(int(lines_per_page or 1), 1)}"]
    for page_index, page_rows in enumerate(count_pages):
        if page_index > 0:
            lines.append("#")
        for row in page_rows:
            lines.append(f"{max(row.left_count, 0)}|{max(row.center_count, 0)}|{max(row.right_count, 0)}")
    return "\n".join(lines).strip()


def parse_count_layout_pages(layout_text: str, default_lines_per_page: int = 42) -> Tuple[Optional[List[List[LayoutCountRow]]], int]:
    stripped = (layout_text or "").strip()
    if not stripped.startswith(COUNT_LAYOUT_HEADER):
        return None, default_lines_per_page

    raw_lines = [line.strip() for line in stripped.splitlines()]
    header = raw_lines[0]
    match = re.search(r"lines_per_page=(\d+)", header)
    lines_per_page = max(int(match.group(1)), 1) if match else max(int(default_lines_per_page or 1), 1)

    pages: List[List[LayoutCountRow]] = [[]]
    for raw_line in raw_lines[1:]:
        if not raw_line:
            continue
        if raw_line == "#":
            if pages[-1]:
                pages.append([])
            continue
        parts = [part.strip() for part in raw_line.split("|")]
        if len(parts) != 3:
            continue
        left_count = parse_optional_non_negative_int(parts[0])
        center_count = parse_optional_non_negative_int(parts[1])
        right_count = parse_optional_non_negative_int(parts[2])
        pages[-1].append(LayoutCountRow(left_count=left_count, center_count=center_count, right_count=right_count))

    normalized_pages: List[List[LayoutCountRow]] = []
    for page_rows in pages:
        chunk = [
            LayoutCountRow(
                right_count=row.right_count,
                center_count=row.center_count,
                left_count=row.left_count,
            )
            for row in page_rows[:lines_per_page]
        ]
        while len(chunk) < lines_per_page:
            chunk.append(LayoutCountRow())
        normalized_pages.append(chunk)

    if not normalized_pages:
        normalized_pages = [[LayoutCountRow() for _ in range(lines_per_page)]]
    return normalized_pages, lines_per_page


def is_count_layout_text(layout_text: str) -> bool:
    return (layout_text or "").strip().startswith(COUNT_LAYOUT_HEADER)


def infer_line_indices_from_centers(centers: Sequence[float], spacing: float, line_count: int) -> Optional[List[int]]:
    if not centers:
        return []

    best_indices: Optional[List[int]] = None
    best_error = float("inf")

    for start_index in range(line_count):
        base_center = centers[0] - (start_index * spacing)
        indices: List[int] = []
        valid = True
        last_index = -1
        total_error = 0.0

        for center in centers:
            index = int(round((center - base_center) / spacing))
            if index < 0 or index >= line_count or index <= last_index:
                valid = False
                break
            predicted_center = base_center + (index * spacing)
            total_error += abs(predicted_center - center)
            indices.append(index)
            last_index = index

        if valid and total_error < best_error:
            best_error = total_error
            best_indices = indices

    return best_indices


def row_visual_width(row: Sequence[OCRWord]) -> int:
    if not row:
        return 0
    left = min(word.x for word in row)
    right = max(word.x + word.w for word in row)
    return max(int(right - left), 0)


def score_row_for_layout(row: Sequence[OCRWord]) -> float:
    width_score = row_visual_width(row)
    word_bonus = len(row) * 120
    return width_score + word_bonus


def estimate_row_word_count(row: Sequence[OCRWord]) -> int:
    compact_row = filter_row_overlaps(row)
    if not compact_row:
        return 0

    compact_row = sorted(compact_row, key=lambda item: item.x, reverse=True)
    count = 1
    previous = compact_row[0]

    for current in compact_row[1:]:
        gap = previous.x - (current.x + current.w)
        avg_height = (previous.h + current.h) / 2
        merge_threshold = max(6.0, avg_height * 0.22)
        if gap > merge_threshold:
            count += 1
        previous = current

    return count


def filter_candidate_rows(rows: Sequence[Sequence[OCRWord]]) -> List[List[OCRWord]]:
    if not rows:
        return []
    widths = [row_visual_width(row) for row in rows]
    max_width = max(widths) if widths else 0
    if max_width <= 0:
        return [list(row) for row in rows]

    filtered: List[List[OCRWord]] = []
    for row, width in zip(rows, widths):
        if len(row) >= 2 and width >= max_width * 0.35:
            filtered.append(list(row))
    return filtered or [list(row) for row in rows]


def choose_best_row_window(rows: Sequence[Sequence[OCRWord]], line_count: int) -> List[List[OCRWord]]:
    if len(rows) <= line_count:
        return [list(row) for row in rows]

    best_rows: Optional[List[List[OCRWord]]] = None
    best_score = float("-inf")
    for start in range(0, len(rows) - line_count + 1):
        window = [list(row) for row in rows[start:start + line_count]]
        spacing = estimate_row_spacing(window) or 48.0
        centers = [sum(word.y + (word.h / 2) for word in row) / len(row) for row in window if row]
        diffs = [centers[index + 1] - centers[index] for index in range(len(centers) - 1)]
        spacing_error = sum(abs(diff - spacing) for diff in diffs)
        content_score = sum(score_row_for_layout(row) for row in window)
        score = content_score - (spacing_error * 40.0)
        if score > best_score:
            best_score = score
            best_rows = window
    return best_rows or [list(row) for row in rows[:line_count]]


def count_rows_from_image(
    image_path: str,
    line_count: int,
    progress_callback: ProgressCallback = None,
) -> List[LayoutCountRow]:
    if progress_callback:
        progress_callback(0.05, "טוען OCR מהתמונה...")
    ocr_words = extract_ocr_words(image_path)
    if progress_callback:
        progress_callback(0.45, "מזהה שורות בתמונה...")
    rows = cluster_words_into_rows(ocr_words, threshold=18)
    rows = [row for row in rows if row]
    rows.sort(key=lambda row: sum(word.y + (word.h / 2) for word in row) / len(row))
    if not rows:
        return [LayoutCountRow() for _ in range(line_count)]

    if progress_callback:
        progress_callback(0.65, "מסנן שורות חריגות...")
    rows = filter_candidate_rows(rows)
    rows = choose_best_row_window(rows, line_count)

    centers = [sum(word.y + (word.h / 2) for word in row) / len(row) for row in rows]
    spacing = estimate_row_spacing(rows)
    if not spacing:
        if len(centers) >= 2:
            diffs = [centers[index + 1] - centers[index] for index in range(len(centers) - 1)]
            spacing = max(sum(diffs) / len(diffs), 1.0)
        else:
            spacing = 48.0

    if progress_callback:
        progress_callback(0.82, "ממפה את השורות לעמוד...")
    indices = infer_line_indices_from_centers(centers, spacing, line_count)
    if indices is None:
        rows = choose_best_row_window(rows, line_count)
        indices = list(range(min(len(rows), line_count)))

    count_rows = [LayoutCountRow() for _ in range(line_count)]
    for row, target_index in zip(rows, indices):
        count_rows[target_index] = LayoutCountRow(center_count=estimate_row_word_count(row))

    if progress_callback:
        progress_callback(1.0, "זיהוי התמונה הושלם")

    return count_rows


def wrap_text_for_manual_layout(
    text: str,
    font_path: str,
    font_size: int,
    max_line_width: int,
) -> List[str]:
    font = load_font(font_path, font_size)
    draw_probe = ImageDraw.Draw(Image.new("RGB", (10, 10), "white"))
    space_width = max(draw_probe.textbbox((0, 0), " ", font=font)[2], 8)
    tokens = extract_layout_tokens(text)
    if not tokens:
        return []

    lines: List[str] = []
    current_tokens: List[str] = []
    current_width = 0

    for token in tokens:
        token_bbox = draw_probe.textbbox((0, 0), token, font=font)
        token_width = token_bbox[2] - token_bbox[0]
        proposed_width = token_width if not current_tokens else current_width + space_width + token_width
        if current_tokens and proposed_width > max_line_width:
            lines.append(" ".join(current_tokens))
            current_tokens = [token]
            current_width = token_width
        else:
            current_tokens.append(token)
            current_width = proposed_width

    if current_tokens:
        lines.append(" ".join(current_tokens))
    return lines


def build_manual_layout_draft(
    source_text: str,
    font_path: str,
    font_size: int,
    max_line_width: int,
    lines_per_page: int,
) -> str:
    wrapped_lines = wrap_text_for_manual_layout(source_text, font_path, font_size, max_line_width)
    if not wrapped_lines:
        return ""

    pages: List[LayoutPage] = []
    for index in range(0, len(wrapped_lines), lines_per_page):
        page = LayoutPage(columns=[LayoutColumn()])
        for line_text in wrapped_lines[index:index + lines_per_page]:
            page.columns[0].lines.append(LayoutLine(center_text=line_text))
        pages.append(page)
    return serialize_manual_layout_pages(pages)


def draw_rtl_segment(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    segment_text: str,
    x: float,
    y: float,
    font: ImageFont.FreeTypeFont,
    foreground: str,
    cantillation_color: Optional[str],
    slide_index: int,
) -> List[OCRWord]:
    if not segment_text.strip():
        return []

    words: List[OCRWord] = []
    draw_token_with_optional_cantillation(
        image,
        draw,
        segment_text,
        x,
        y,
        font,
        foreground,
        cantillation_color,
    )

    segment_right = x + (draw.textbbox((0, 0), segment_text, font=font)[2] - draw.textbbox((0, 0), segment_text, font=font)[0])
    space_width = max(draw.textbbox((0, 0), " ", font=font)[2], 8)
    for token in [token for token in re.split(r"\s+", segment_text.strip()) if token]:
        token_bbox = draw.textbbox((0, 0), token, font=font)
        token_width = token_bbox[2] - token_bbox[0]
        token_height = token_bbox[3] - token_bbox[1]
        segment_right -= token_width
        words.append(
            OCRWord(
                word=token,
                normalized=normalize_word(token),
                x=int(segment_right),
                y=int(y),
                w=int(token_width),
                h=int(token_height),
                slide_index=slide_index,
            )
        )
        segment_right -= space_width
    return words


def draw_token_with_optional_cantillation(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    token: str,
    x: float,
    y: float,
    font: ImageFont.FreeTypeFont,
    foreground: str,
    cantillation_color: Optional[str],
) -> Tuple[int, int]:
    bbox = draw.textbbox((0, 0), token, font=font)
    token_width = bbox[2] - bbox[0]
    token_height = bbox[3] - bbox[1]
    draw.text((x, y), token, font=font, fill=foreground)
    if cantillation_color and has_cantillation(token):
        plain_token = strip_cantillation(token)
        plain_bbox = draw.textbbox((0, 0), plain_token, font=font)
        left = min(bbox[0], plain_bbox[0])
        top = min(bbox[1], plain_bbox[1])
        right = max(bbox[2], plain_bbox[2])
        bottom = max(bbox[3], plain_bbox[3])
        mask_width = max(right - left, 1)
        mask_height = max(bottom - top, 1)
        origin = (-left, -top)
        full_mask = Image.new("L", (mask_width, mask_height), 0)
        plain_mask = Image.new("L", (mask_width, mask_height), 0)
        ImageDraw.Draw(full_mask).text(origin, token, font=font, fill=255)
        ImageDraw.Draw(plain_mask).text(origin, plain_token, font=font, fill=255)
        cantillation_mask = ImageChops.subtract(full_mask, plain_mask)
        color_layer = Image.new("RGB", (mask_width, mask_height), cantillation_color)
        image.paste(color_layer, (int(x + left), int(y + top)), cantillation_mask)
    return int(token_width), int(token_height)


def draw_justified_rtl_line(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    column_left: float,
    column_width: float,
    y: float,
    foreground: str,
    cantillation_color: Optional[str],
    slide_index: int,
) -> List[OCRWord]:
    chunks = re.findall(r"\S+|\s+", text.strip())
    words_only = [chunk for chunk in chunks if not chunk.isspace()]
    if not words_only:
        return []

    base_bbox = draw.textbbox((0, 0), text.strip(), font=font)
    base_width = base_bbox[2] - base_bbox[0]
    gap_indices = [index for index, chunk in enumerate(chunks) if chunk.isspace()]
    extra_width = max(int(column_width - base_width), 0)
    gap_bonus: Dict[int, int] = {}
    if gap_indices and extra_width > 0:
        per_gap = extra_width // len(gap_indices)
        remainder = extra_width % len(gap_indices)
        for offset, gap_index in enumerate(gap_indices):
            gap_bonus[gap_index] = per_gap + (1 if offset < remainder else 0)

    cursor = column_left + column_width
    words: List[OCRWord] = []
    for index, chunk in enumerate(chunks):
        if chunk.isspace():
            gap_bbox = draw.textbbox((0, 0), chunk, font=font)
            gap_width = (gap_bbox[2] - gap_bbox[0]) + gap_bonus.get(index, 0)
            cursor -= gap_width
            continue

        token_bbox = draw.textbbox((0, 0), chunk, font=font)
        token_width = token_bbox[2] - token_bbox[0]
        token_width, token_height = draw_token_with_optional_cantillation(
            image,
            draw,
            chunk,
            cursor - token_width,
            y,
            font,
            foreground,
            cantillation_color,
        )
        cursor -= token_width
        words.append(
            OCRWord(
                word=chunk,
                normalized=normalize_word(chunk),
                x=int(cursor),
                y=int(y),
                w=int(token_width),
                h=int(token_height),
                slide_index=slide_index,
            )
        )
    return words


def layout_manual_pages(
    layout_text: str,
    font_path: str,
    font_size: int,
    column_width: int,
    line_spacing: int,
    margin: int = 40,
    column_gap: int = 80,
    background: str = "white",
    foreground: str = "black",
    cantillation_color: Optional[str] = None,
) -> Tuple[List[Image.Image], List[OCRWord]]:
    pages = parse_manual_layout_text(layout_text)
    if not pages:
        raise ValueError("לא נמצא layout ידני תקין.")

    font = load_font(font_path, font_size)
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10), background))
    space_width = max(probe.textbbox((0, 0), " ", font=font)[2], 8)
    line_height = probe.textbbox((0, 0), "אבגדה", font=font)[3] + line_spacing

    images: List[Image.Image] = []
    words: List[OCRWord] = []

    for page_index, page in enumerate(pages):
        page.columns = [column for column in page.columns if column.lines]
        if not page.columns:
            continue
        max_lines = max(len(column.lines) for column in page.columns)
        image_width = (margin * 2) + (len(page.columns) * column_width) + ((len(page.columns) - 1) * column_gap)
        image_height = (margin * 2) + (max_lines * line_height)
        image = Image.new("RGB", (image_width, image_height), background)
        draw = ImageDraw.Draw(image)

        for column_index, column in enumerate(page.columns):
            column_left = margin + (column_index * (column_width + column_gap))
            y = margin
            for line in column.lines:
                has_left = bool(line.left_text)
                has_center = bool(line.center_text)
                has_right = bool(line.right_text)

                if has_center and not has_left and not has_right:
                    line_text = build_manual_line_text(line)
                    words.extend(
                        draw_justified_rtl_line(
                            image,
                            draw,
                            line_text,
                            font,
                            column_left,
                            column_width,
                            y,
                            foreground,
                            cantillation_color,
                            page_index,
                        )
                    )
                else:
                    segment_specs = [
                        ("L", line.left_text),
                        ("C", line.center_text),
                        ("R", line.right_text),
                    ]
                    for align, segment_text in segment_specs:
                        if not segment_text:
                            continue
                        bbox = draw.textbbox((0, 0), segment_text, font=font)
                        segment_width = bbox[2] - bbox[0]
                        if align == "L":
                            segment_x = column_left
                        elif align == "C":
                            segment_x = column_left + ((column_width - segment_width) / 2)
                        else:
                            segment_x = column_left + column_width - segment_width

                        words.extend(
                            draw_rtl_segment(
                                image,
                                draw,
                                segment_text,
                                segment_x,
                                y,
                                font,
                                foreground,
                                cantillation_color,
                                page_index,
                            )
                        )
                y += line_height

        images.append(image)

    return images, words


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
    cantillation_color: Optional[str] = None,
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
            cantillation_color=cantillation_color,
        )
        for word in slide_words:
            word.slide_index = slide_index
        images.append(image)
        words.extend(slide_words)
    images = normalize_slide_image_sizes(images, background=background)
    return images, words


def normalize_slide_image_sizes(
    images: Sequence[Image.Image],
    background: str = "white",
) -> List[Image.Image]:
    if not images:
        return []
    target_width = max(image.width for image in images)
    target_height = max(image.height for image in images)
    normalized_images: List[Image.Image] = []
    for image in images:
        if image.width == target_width and image.height == target_height:
            normalized_images.append(image)
            continue
        canvas = Image.new("RGB", (target_width, target_height), background)
        canvas.paste(image, (0, 0))
        normalized_images.append(canvas)
    return normalized_images


def normalize_word_boxes_by_line(words: Sequence[OCRWord]) -> List[OCRWord]:
    normalized_words = [
        OCRWord(
            word=word.word,
            normalized=word.normalized,
            x=word.x,
            y=word.y,
            w=word.w,
            h=word.h,
            slide_index=word.slide_index,
        )
        for word in words
    ]
    if not normalized_words:
        return []

    grouped_by_slide: Dict[int, List[OCRWord]] = {}
    for word in normalized_words:
        grouped_by_slide.setdefault(word.slide_index, []).append(word)

    for slide_words in grouped_by_slide.values():
        slide_words.sort(key=lambda item: (item.y, item.x))
        line_groups: List[List[OCRWord]] = []
        for word in slide_words:
            if not line_groups:
                line_groups.append([word])
                continue
            last_group = line_groups[-1]
            group_y = sum(item.y for item in last_group) / len(last_group)
            threshold = max(2, int(max(item.h for item in last_group) * 0.35))
            if abs(word.y - group_y) <= threshold:
                last_group.append(word)
            else:
                line_groups.append([word])

        for group in line_groups:
            top = min(item.y for item in group)
            bottom = max(item.y + item.h for item in group)
            common_height = max(bottom - top, 1)
            for item in group:
                item.y = top
                item.h = common_height

    return normalized_words


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


def build_tora_order_directory(output_dir: str) -> Path:
    root = Path(output_dir).expanduser() if output_dir else Path(__file__).resolve().parent
    tora_order_dir = root / "TORA ORDER"
    tora_order_dir.mkdir(parents=True, exist_ok=True)
    return tora_order_dir


def strip_layout_control_tokens(text: str) -> str:
    cleaned = re.sub(r"<[LCR]>", " ", text)
    cleaned = re.sub(r"\{[פס]\}", " ", cleaned)
    cleaned = cleaned.replace("|", " ").replace("^", " ").replace("#", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def normalize_layout_match_text(text: str) -> str:
    return normalize_layout_word_breaks(strip_niqqud(strip_layout_control_tokens(text)))


def build_layout_file_text(verses: Sequence[Tuple[str, str]], include_niqqud: bool = False) -> str:
    parts: List[str] = []
    for _ref, verse_text in verses:
        clean_text = verse_text.strip()
        if not include_niqqud:
            clean_text = strip_niqqud(clean_text)
            clean_text = normalize_layout_word_breaks(clean_text)
        clean_text = re.sub(r"\s+", " ", clean_text).strip()
        if clean_text:
            parts.append(clean_text)
    return " ".join(parts)


def find_best_layout_file(
    tora_order_dir: Path,
    reference_stem: str,
    passage_text: str,
    selected_layout_path: str = "",
) -> Optional[Path]:
    if selected_layout_path:
        selected = Path(selected_layout_path)
        if selected.exists():
            return selected

    exact_path = tora_order_dir / f"{reference_stem}.txt"
    if exact_path.exists():
        return exact_path

    target_text = normalize_layout_match_text(passage_text)
    candidates: List[Path] = []
    for candidate in tora_order_dir.glob("*.txt"):
        try:
            candidate_text = normalize_layout_match_text(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
        if target_text and target_text in candidate_text:
            candidates.append(candidate)
    if candidates:
        candidates.sort(key=lambda item: item.stat().st_mtime, reverse=True)
        return candidates[0]
    return None


def build_output_directories(output_dir: str) -> Dict[str, Path]:
    root = Path(output_dir).expanduser() if output_dir else Path(__file__).resolve().parent
    image_dir = root / "Output Image"
    audio_dir = root / "Output audio"
    video_dir = root / "Output video"
    for path in (image_dir, audio_dir, video_dir):
        path.mkdir(parents=True, exist_ok=True)
    return {
        "image": image_dir,
        "audio": audio_dir,
        "video": video_dir,
    }


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
    output_target = Path(output_path)
    output_target.parent.mkdir(parents=True, exist_ok=True)
    temp_audio_path = output_target.with_name(f"{output_target.stem}_temp_audio.m4a")
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
        temp_audiofile=str(temp_audio_path),
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
        raise ValueError("Slide video requires synced words for the target slide")

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


class TorahBuilderWindow:
    def __init__(self, parent: tk.Misc) -> None:
        self.window = tk.Toplevel(parent)
        self.window.title("Torah Builder")
        self.window.geometry("1380x900")
        self.window.protocol("WM_DELETE_WINDOW", self.on_close)

        self.category_var = tk.StringVar(value="תורה")
        self.book_var = tk.StringVar(value="בראשית")
        self.start_chapter_var = tk.StringVar(value="א")
        self.start_verse_var = tk.StringVar(value="א")
        self.end_chapter_var = tk.StringVar(value="א")
        self.end_verse_var = tk.StringVar(value="ג")
        self.include_niqqud_var = tk.BooleanVar(value=True)
        self.output_dir_var = tk.StringVar(value=str(Path(__file__).resolve().parent))
        self.layout_mode_var = tk.StringVar(value="automatic")
        self.active_layout_label_var = tk.StringVar(value="Layout פעיל: אוטומטי")
        self.font_path_var = tk.StringVar()
        self.font_size_var = tk.StringVar(value="56")
        self.line_width_var = tk.StringVar(value="1100")
        self.line_spacing_var = tk.StringVar(value="20")
        self.column_gap_var = tk.StringVar(value="80")
        self.layout_lines_per_page_var = tk.StringVar(value="42")
        self.highlight_cantillation_var = tk.BooleanVar(value=False)
        self.cantillation_color_var = tk.StringVar(value="#C1121F")
        self.slide_count_var = tk.StringVar(value="1")
        self.transition_duration_var = tk.StringVar(value="0.35")
        self.separate_slide_videos_var = tk.BooleanVar(value=False)
        self.model_name_var = tk.StringVar(value="small")
        self.status_var = tk.StringVar(value="Ready")
        self.progress_var = tk.DoubleVar(value=0.0)
        self.audio_path_var = tk.StringVar()
        self.device_var = tk.StringVar()
        self.recording_status_var = tk.StringVar(value="Not recording")
        self.recording_elapsed_var = tk.StringVar(value="00:00")
        self.recording_progress_var = tk.DoubleVar(value=0.0)
        self.rewind_seconds_var = tk.StringVar(value="3")

        self.preview_image_tk = None
        self.preview_full_image = None
        self.preview_container = None
        self.current_passage = None
        self.manual_layout_text = ""
        self.manual_layout_path = ""
        self.export_stem = ""
        self.export_reference = ""
        self.generated_image_path = ""
        self.generated_layout_path = ""
        self.generated_audio_path = ""
        self.generated_layout_words: List[OCRWord] = []
        self.synced_words = []
        self.generated_slide_paths: List[str] = []
        self.cleaned_audio_path = ""
        self.recording_session_path = ""
        self.recording_segment_path = ""
        self.recording_segment_index = 0
        self.recording_saved_seconds = 0.0
        self.recording_started_at = 0.0
        self.recording_update_after = None
        self.temp_dir = TemporaryDirectory(prefix="text2video_builder_")
        self.main_canvas: Optional[tk.Canvas] = None
        self.main_canvas_window = None
        self.main_scroll_content: Optional[ttk.Frame] = None

        self.player = FFplayAudioPlayer()
        self.recorder = FFmpegAudioRecorder()
        self._build_ui()
        self.on_category_changed()
        self.refresh_audio_devices()

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.window)
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(0, weight=1)

        canvas = tk.Canvas(outer, highlightthickness=0)
        canvas.grid(row=0, column=0, sticky="nsew")
        y_scroll = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll = ttk.Scrollbar(outer, orient="horizontal", command=canvas.xview)
        x_scroll.grid(row=1, column=0, sticky="ew")
        canvas.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

        container = ttk.Frame(canvas, padding=12)
        self.main_canvas = canvas
        self.main_scroll_content = container
        self.main_canvas_window = canvas.create_window((0, 0), window=container, anchor="nw")
        container.bind("<Configure>", self._on_main_content_configure)
        canvas.bind("<Configure>", self._on_main_canvas_configure)
        self.window.bind_all("<MouseWheel>", self._on_main_mousewheel, add="+")

        container.columnconfigure(0, weight=1)
        container.rowconfigure(1, weight=1)

        top = ttk.Frame(container)
        top.grid(row=0, column=0, sticky="nsew")
        top.columnconfigure(0, weight=1)
        top.columnconfigure(1, weight=1)

        source_frame = ttk.LabelFrame(top, text="Sefaria Source", padding=10)
        source_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        for col in range(7):
            source_frame.columnconfigure(col, weight=1)
        source_font = ("Segoe UI", 10)

        ttk.Label(source_frame, text="קטגוריה", font=source_font).grid(row=0, column=0, sticky="w")
        self.category_combo = ttk.Combobox(source_frame, textvariable=self.category_var, values=list(TEXT_LIBRARY.keys()), state="readonly", font=source_font)
        self.category_combo.grid(row=0, column=1, sticky="ew", padx=4)
        self.category_combo.bind("<<ComboboxSelected>>", self.on_category_changed)
        ttk.Label(source_frame, text="ספר", font=source_font).grid(row=0, column=2, sticky="w")
        self.book_combo = ttk.Combobox(source_frame, textvariable=self.book_var, state="readonly", font=source_font)
        self.book_combo.grid(row=0, column=3, sticky="ew", padx=4)
        ttk.Checkbutton(source_frame, text="הצג ניקוד", variable=self.include_niqqud_var).grid(row=0, column=4, columnspan=3, sticky="e")
        ttk.Label(source_frame, text="התחלה", font=source_font).grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(source_frame, textvariable=self.start_chapter_var, width=6, font=source_font).grid(row=1, column=1, sticky="ew", padx=4, pady=(8, 0))
        ttk.Label(source_frame, text="פסוק", font=source_font).grid(row=1, column=2, sticky="w", pady=(8, 0))
        ttk.Entry(source_frame, textvariable=self.start_verse_var, width=6, font=source_font).grid(row=1, column=3, sticky="ew", padx=4, pady=(8, 0))
        ttk.Label(source_frame, text="סוף", font=source_font).grid(row=1, column=4, sticky="w", pady=(8, 0))
        ttk.Entry(source_frame, textvariable=self.end_chapter_var, width=6, font=source_font).grid(row=1, column=5, sticky="ew", padx=4, pady=(8, 0))
        ttk.Entry(source_frame, textvariable=self.end_verse_var, width=6, font=source_font).grid(row=1, column=6, sticky="ew", padx=4, pady=(8, 0))
        ttk.Button(source_frame, text="משוך טקסט", command=self.fetch_text).grid(row=2, column=0, columnspan=7, sticky="ew", pady=(8, 0))
        style_frame = ttk.LabelFrame(top, text="Image Settings", padding=10)
        style_frame.grid(row=0, column=1, sticky="nsew")
        style_frame.columnconfigure(1, weight=1)

        self._add_entry(style_frame, 0, "Output folder", self.output_dir_var, button=("Browse", self.pick_output_dir))
        self._add_entry(style_frame, 1, "Whisper model", self.model_name_var)
        ttk.Label(style_frame, text="Layout mode").grid(row=2, column=0, sticky="w", pady=4)
        ttk.Combobox(
            style_frame,
            textvariable=self.layout_mode_var,
            values=["automatic", "manual_torah"],
            state="readonly",
        ).grid(row=2, column=1, sticky="ew", pady=4)
        ttk.Button(style_frame, text="ערוך Layout", command=self.open_layout_editor).grid(row=2, column=2, padx=(6, 0), pady=4)
        ttk.Button(style_frame, text="בחר Layout", command=self.choose_layout_file).grid(row=2, column=3, padx=(6, 0), pady=4)
        ttk.Label(style_frame, textvariable=self.active_layout_label_var, anchor="w").grid(row=3, column=0, columnspan=4, sticky="ew", pady=(4, 0))
        ttk.Button(style_frame, text="מאפייני טקסט", command=self.open_text_settings).grid(row=4, column=0, columnspan=4, sticky="ew", pady=(8, 0))
        ttk.Button(style_frame, text="Generate Image", command=self.generate_image).grid(row=5, column=0, columnspan=4, sticky="ew", pady=(8, 0))

        middle = ttk.Panedwindow(container, orient="horizontal")
        middle.grid(row=1, column=0, sticky="nsew", pady=12)

        left = ttk.Frame(middle)
        left.columnconfigure(0, weight=1)
        left.rowconfigure(1, weight=1)
        middle.add(left, weight=3)

        text_frame = ttk.LabelFrame(left, text="Fetched Text", padding=10)
        text_frame.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        text_frame.columnconfigure(0, weight=1)
        text_frame.rowconfigure(0, weight=1)
        self.text_box = tk.Text(text_frame, height=4, wrap="word")
        self.text_box.grid(row=0, column=0, sticky="nsew")
        text_scroll = ttk.Scrollbar(text_frame, orient="vertical", command=self.text_box.yview)
        text_scroll.grid(row=0, column=1, sticky="ns")
        self.text_box.configure(yscrollcommand=text_scroll.set)

        preview_frame = ttk.LabelFrame(left, text="Image Preview", padding=10)
        preview_frame.grid(row=1, column=0, sticky="nsew")
        preview_frame.columnconfigure(0, weight=1)
        preview_frame.rowconfigure(0, weight=1)
        self.preview_label = ttk.Label(preview_frame, anchor="center", cursor="hand2")
        self.preview_label.grid(row=0, column=0, sticky="nsew")
        self.preview_label.bind("<Button-1>", self.open_large_preview)
        self.preview_container = preview_frame
        preview_frame.bind("<Configure>", self._on_preview_resize)

        right = ttk.Frame(middle)
        right.columnconfigure(0, weight=1)
        middle.add(right, weight=2)

        audio_frame = ttk.LabelFrame(right, text="Audio", padding=10)
        audio_frame.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        audio_frame.columnconfigure(1, weight=1)
        ttk.Label(audio_frame, text="Mic device").grid(row=0, column=0, sticky="w")
        self.device_combo = ttk.Combobox(audio_frame, textvariable=self.device_var, state="readonly")
        self.device_combo.grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(audio_frame, text="Refresh", command=self.refresh_audio_devices).grid(row=0, column=2, padx=(4, 0))
        ttk.Button(audio_frame, text="Start Recording", command=self.start_recording).grid(row=1, column=0, sticky="ew", pady=(8, 0))
        ttk.Button(audio_frame, text="Pause Recording", command=self.pause_recording).grid(row=1, column=1, sticky="ew", padx=4, pady=(8, 0))
        ttk.Button(audio_frame, text="Stop Recording", command=self.stop_recording).grid(row=1, column=2, sticky="ew", pady=(8, 0))
        ttk.Button(audio_frame, text="Resume", command=self.resume_recording).grid(row=2, column=0, sticky="ew", pady=(8, 0))
        rewind_frame = ttk.Frame(audio_frame)
        rewind_frame.grid(row=2, column=1, columnspan=2, sticky="ew", padx=(4, 0), pady=(8, 0))
        rewind_frame.columnconfigure(1, weight=1)
        ttk.Button(rewind_frame, text="Rewind", command=self.rewind_recording).grid(row=0, column=0, sticky="ew")
        ttk.Entry(rewind_frame, textvariable=self.rewind_seconds_var, width=6).grid(row=0, column=1, sticky="ew", padx=(4, 4))
        ttk.Label(rewind_frame, text="sec").grid(row=0, column=2, sticky="w")
        ttk.Button(audio_frame, text="Import Audio", command=self.import_audio).grid(row=3, column=0, sticky="ew", pady=(8, 0))
        ttk.Button(audio_frame, text="Play", command=self.play_audio).grid(row=3, column=1, sticky="ew", padx=4, pady=(8, 0))
        ttk.Button(audio_frame, text="Pause", command=self.pause_audio).grid(row=3, column=2, sticky="ew", pady=(8, 0))
        ttk.Button(audio_frame, text="Stop", command=self.stop_audio).grid(row=4, column=0, sticky="ew", pady=(8, 0))
        ttk.Button(audio_frame, text="איכות קול", command=self.open_audio_quality).grid(row=4, column=1, sticky="ew", padx=4, pady=(8, 0))
        ttk.Label(audio_frame, textvariable=self.recording_status_var).grid(row=4, column=2, sticky="w", pady=(8, 0))
        ttk.Progressbar(audio_frame, variable=self.recording_progress_var, maximum=100, mode="determinate").grid(row=5, column=0, columnspan=3, sticky="ew", pady=(8, 0))
        ttk.Label(audio_frame, textvariable=self.recording_elapsed_var, anchor="center").grid(row=6, column=0, columnspan=3, sticky="ew", pady=(4, 0))
        ttk.Label(audio_frame, text="Selected audio").grid(row=7, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(audio_frame, textvariable=self.audio_path_var).grid(row=7, column=1, columnspan=2, sticky="ew", padx=(4, 0), pady=(8, 0))

        export_frame = ttk.LabelFrame(right, text="Export", padding=10)
        export_frame.grid(row=1, column=0, sticky="ew")
        export_frame.columnconfigure(0, weight=1)
        ttk.Button(export_frame, text="Save Image", command=self.save_generated_image_copy).grid(row=0, column=0, sticky="ew")
        ttk.Button(export_frame, text="Save Audio Copy", command=self.save_audio_copy).grid(row=1, column=0, sticky="ew", pady=(8, 0))
        ttk.Button(export_frame, text="Create Static Video", command=self.create_static_video).grid(row=2, column=0, sticky="ew", pady=(8, 0))
        ttk.Button(export_frame, text="Create Highlighted Video", command=self.create_highlighted_video).grid(row=3, column=0, sticky="ew", pady=(8, 0))

        footer = ttk.Frame(container)
        footer.grid(row=2, column=0, sticky="ew")
        footer.columnconfigure(0, weight=1)
        ttk.Progressbar(footer, variable=self.progress_var, maximum=100, mode="determinate").grid(row=0, column=0, sticky="ew")
        ttk.Label(footer, textvariable=self.status_var, anchor="w").grid(row=1, column=0, sticky="ew", pady=(4, 0))

    def _on_main_content_configure(self, _event=None) -> None:
        if self.main_canvas and self.main_scroll_content is not None:
            self.main_canvas.configure(scrollregion=self.main_canvas.bbox("all"))

    def _on_main_canvas_configure(self, event) -> None:
        if self.main_canvas and self.main_canvas_window is not None and self.main_scroll_content is not None:
            target_width = max(event.width, self.main_scroll_content.winfo_reqwidth())
            self.main_canvas.itemconfigure(self.main_canvas_window, width=target_width)
            self.main_canvas.configure(scrollregion=self.main_canvas.bbox("all"))

    def _on_main_mousewheel(self, event) -> None:
        if self.main_canvas and self.main_canvas.winfo_exists():
            self.main_canvas.yview_scroll(int(-event.delta / 120), "units")

    def _add_entry(self, parent: ttk.Widget, row: int, label: str, variable: tk.StringVar, button=None) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(parent, textvariable=variable).grid(row=row, column=1, sticky="ew", pady=4)
        if button:
            text, command = button
            ttk.Button(parent, text=text, command=command).grid(row=row, column=2, padx=(6, 0), pady=4)

    def on_category_changed(self, _event=None) -> None:
        books = [name for name, _canonical in TEXT_LIBRARY.get(self.category_var.get(), [])]
        self.book_combo["values"] = books
        if books and self.book_var.get() not in books:
            self.book_var.set(books[0])

    def set_status(self, text: str) -> None:
        self.status_var.set(text)
        self.window.update_idletasks()

    def set_progress(self, value: float, text: str) -> None:
        self.progress_var.set(max(0.0, min(100.0, value * 100.0)))
        self.set_status(text)

    def show_error_details(self, title: str, details: str) -> None:
        dialog = tk.Toplevel(self.window)
        dialog.title(title)
        dialog.transient(self.window)
        dialog.geometry("1000x700")
        dialog.minsize(700, 420)

        frame = ttk.Frame(dialog, padding=12)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(1, weight=1)

        ttk.Label(
            frame,
            text="אפשר להעתיק את הטקסט המלא של השגיאה ולשלוח אותו לבדיקה.",
            anchor="w",
            justify="right",
        ).grid(row=0, column=0, sticky="ew", pady=(0, 8))

        text_box = scrolledtext.ScrolledText(frame, wrap="word", font=("Consolas", 10))
        text_box.grid(row=1, column=0, sticky="nsew")
        text_box.insert("1.0", details)
        text_box.focus_set()

        button_row = ttk.Frame(frame)
        button_row.grid(row=2, column=0, sticky="ew", pady=(10, 0))
        button_row.columnconfigure(0, weight=1)

        def copy_all() -> None:
            dialog.clipboard_clear()
            dialog.clipboard_append(details)

        ttk.Button(button_row, text="העתק הכול", command=copy_all).grid(row=0, column=1, padx=(6, 0))
        ttk.Button(button_row, text="סגור", command=dialog.destroy).grid(row=0, column=2, padx=(6, 0))

    def run_in_background(self, target, done_message: str) -> None:
        def runner() -> None:
            try:
                target()
                self.window.after(0, lambda: self.set_status(done_message))
            except Exception as exc:
                traceback_text = "".join(traceback.format_exception(exc))
                self.window.after(0, lambda: self.show_error_details("Error", traceback_text))
                self.window.after(0, lambda: self.set_status("Failed"))

        threading.Thread(target=runner, daemon=True).start()

    def pick_output_dir(self) -> None:
        path = filedialog.askdirectory()
        if path:
            self.output_dir_var.set(path)

    def pick_font(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("Font files", "*.ttf *.otf"), ("All files", "*.*")])
        if path:
            self.font_path_var.set(path)

    def update_active_layout_label(self) -> None:
        if self.layout_mode_var.get() != "manual_torah":
            self.active_layout_label_var.set("Layout פעיל: אוטומטי")
            return
        if self.manual_layout_path:
            self.active_layout_label_var.set(f"Layout פעיל: {Path(self.manual_layout_path).name}")
            return
        if self.current_passage:
            self.active_layout_label_var.set(f"Layout פעיל: {self.get_reference_stem()}.txt")
            return
        self.active_layout_label_var.set("Layout פעיל: לא נבחר")

    def choose_layout_file(self) -> None:
        tora_order_dir = build_tora_order_directory(self.output_dir_var.get())
        chosen_path = filedialog.askopenfilename(
            title="בחר קובץ Layout",
            initialdir=str(tora_order_dir),
            filetypes=[("Layout text", "*.txt"), ("All files", "*.*")],
        )
        if chosen_path:
            self.manual_layout_path = chosen_path
            self.update_active_layout_label()
            self.set_status(f"Selected layout: {Path(chosen_path).name}")

    def build_export_name(self) -> str:
        reference = build_reference_stem(
            self.book_var.get(),
            self.start_chapter_var.get(),
            self.start_verse_var.get(),
            self.end_chapter_var.get(),
            self.end_verse_var.get(),
        )
        if not self.export_stem or self.export_reference != reference:
            self.export_reference = reference
            self.export_stem = build_export_stem(
                self.book_var.get(),
                self.start_chapter_var.get(),
                self.start_verse_var.get(),
                self.end_chapter_var.get(),
                self.end_verse_var.get(),
            )
        return self.export_stem

    def reset_export_name(self) -> None:
        self.export_stem = ""
        self.export_reference = ""

    def get_reference_stem(self) -> str:
        return build_reference_stem(
            self.book_var.get(),
            self.start_chapter_var.get(),
            self.start_verse_var.get(),
            self.end_chapter_var.get(),
            self.end_verse_var.get(),
        )

    def create_layout_text_file(self) -> None:
        if not self.current_passage:
            messagebox.showerror("Missing text", "Fetch text first.")
            return
        tora_order_dir = build_tora_order_directory(self.output_dir_var.get())
        reference_stem = self.get_reference_stem()
        layout_path = tora_order_dir / f"{reference_stem}.txt"
        layout_text = build_layout_file_text(
            self.current_passage.get("verses", []),
            include_niqqud=self.include_niqqud_var.get(),
        )
        layout_path.write_text(layout_text, encoding="utf-8")
        self.manual_layout_path = str(layout_path)
        self.manual_layout_text = layout_text
        self.set_status(f"Layout file saved: {layout_path.name}")

    def fetch_text(self) -> None:
        self.progress_var.set(0.0)
        self.reset_export_name()

        def task() -> None:
            self.window.after(0, lambda: self.set_progress(0.1, "Fetching verses from Sefaria..."))
            passage = fetch_passage_from_sefaria(
                self.book_var.get(),
                parse_hebrew_number(self.start_chapter_var.get()),
                parse_hebrew_number(self.start_verse_var.get()),
                parse_hebrew_number(self.end_chapter_var.get()),
                parse_hebrew_number(self.end_verse_var.get()),
                include_niqqud=self.include_niqqud_var.get(),
            )
            self.current_passage = passage
            layout_preview_text = "\n".join(text for _, text in passage["verses"])
            tikkun_pages = build_tikkun_layout_pages_for_passage(
                passage,
                include_niqqud=self.include_niqqud_var.get(),
            )
            if tikkun_pages:
                tora_order_dir = build_tora_order_directory(self.output_dir_var.get())
                layout_path = tora_order_dir / f"{self.get_reference_stem()}.txt"
                self.manual_layout_text = serialize_manual_layout_pages(tikkun_pages)
                layout_path.write_text(self.manual_layout_text.strip() + "\n", encoding="utf-8")
                self.manual_layout_path = str(layout_path)
                self.layout_mode_var.set("manual_torah")
                self.layout_lines_per_page_var.set(str(max(len(page.columns[0].lines) for page in tikkun_pages if page.columns) or 42))
                layout_preview_text = build_readable_text_from_layout_pages(tikkun_pages) or layout_preview_text
                status_text = "Verses fetched with Tikkun Torah layout"
            else:
                self.manual_layout_text = build_initial_manual_layout(
                    passage["verses"],
                    include_niqqud=self.include_niqqud_var.get(),
                )
                self.manual_layout_path = ""
                status_text = "Verses fetched"
            self.window.after(0, self.update_active_layout_label)
            self.window.after(0, lambda: self.text_box.delete("1.0", "end"))
            self.window.after(0, lambda: self.text_box.insert("1.0", layout_preview_text))
            self.window.after(0, lambda: self.set_progress(1.0, status_text))

        self.run_in_background(task, "Text fetched")

    def generate_image(self) -> None:
        if not self.current_passage:
            messagebox.showerror("Missing text", "Fetch a passage from Sefaria first.")
            return
        self.progress_var.set(0.0)

        def task() -> None:
            self.window.after(0, lambda: self.set_progress(0.2, "Generating text image..."))
            export_stem = self.build_export_name()
            directories = build_output_directories(self.output_dir_var.get())
            temp_root = Path(self.temp_dir.name)
            image_path = directories["image"] / f"{export_stem}.png"
            layout_path = temp_root / f"{export_stem}_layout.json"
            audio_path = directories["audio"] / f"{export_stem}.wav"
            cantillation_color = self.cantillation_color_var.get().strip() if self.highlight_cantillation_var.get() else None
            if self.layout_mode_var.get() == "manual_torah":
                tora_order_dir = build_tora_order_directory(self.output_dir_var.get())
                reference_layout_file = tora_order_dir / f"{self.get_reference_stem()}.txt"
                if not reference_layout_file.exists() and self.current_passage and is_count_layout_text(self.manual_layout_text):
                    reference_layout_file.write_text(self.manual_layout_text.strip() + "\n", encoding="utf-8")
                    self.manual_layout_path = str(reference_layout_file)
                    self.window.after(0, self.update_active_layout_label)
                manual_layout_file = reference_layout_file if reference_layout_file.exists() else None
                if manual_layout_file is None and self.manual_layout_path:
                    selected_layout = Path(self.manual_layout_path)
                    if selected_layout.exists():
                        manual_layout_file = selected_layout
                if manual_layout_file is None:
                    manual_layout_file = find_best_layout_file(
                        tora_order_dir,
                        self.get_reference_stem(),
                        self.current_passage.get("text", ""),
                        self.manual_layout_path,
                    )
                if not manual_layout_file:
                    raise ValueError("לא נמצא קובץ Layout מתאים. יש לפתוח 'ערוך Layout' ואז ללחוץ 'שמור Layout' או 'שמור וסגור'.")
                self.manual_layout_path = str(manual_layout_file)
                manual_source = manual_layout_file.read_text(encoding="utf-8").strip()
                self.manual_layout_text = manual_source
                parsed_count_pages, parsed_lines_per_page = parse_count_layout_pages(
                    manual_source,
                    max(int(self.layout_lines_per_page_var.get() or "42"), 1),
                )
                if parsed_count_pages is not None:
                    source_words = extract_source_words_from_verses(self.current_passage.get("verses", []))
                    pages_to_render = build_layout_pages_from_count_pages(source_words, parsed_count_pages)
                    manual_source = serialize_manual_layout_pages(pages_to_render)
                    self.layout_lines_per_page_var.set(str(parsed_lines_per_page))
                slide_count = max(int(self.slide_count_var.get() or "1"), 1)
                if slide_count > 1:
                    manual_source = split_manual_layout_for_slides(manual_source, slide_count)
                images, words = layout_manual_pages(
                    manual_source,
                    self.font_path_var.get(),
                    int(self.font_size_var.get()),
                    int(self.line_width_var.get()),
                    int(self.line_spacing_var.get()),
                    column_gap=int(self.column_gap_var.get() or "80"),
                    cantillation_color=cantillation_color,
                )
                images = normalize_slide_image_sizes(images)
            else:
                slide_count = max(int(self.slide_count_var.get() or "1"), 1)
                slide_texts = split_passage_into_slides(self.current_passage.get("verses", []), slide_count)
                images, words = layout_text_slides(
                    slide_texts or [self.current_passage["text"]],
                    self.font_path_var.get(),
                    int(self.font_size_var.get()),
                    int(self.line_width_var.get()),
                    int(self.line_spacing_var.get()),
                    cantillation_color=cantillation_color,
                )
            words = normalize_word_boxes_by_line(words)
            preview_image = build_preview_strip(images)
            preview_image.save(image_path)
            slide_paths: List[str] = []
            for slide_index, slide_image in enumerate(images):
                slide_path = directories["image"] / f"{export_stem}_slide_{slide_index + 1:02d}.png"
                slide_image.save(slide_path)
                slide_paths.append(str(slide_path))
            save_json(
                [
                    {
                        "word": word.word,
                        "normalized": word.normalized,
                        "x": word.x,
                        "y": word.y,
                        "w": word.w,
                        "h": word.h,
                        "slide_index": word.slide_index,
                    }
                    for word in words
                ],
                str(layout_path),
            )
            self.generated_image_path = str(image_path)
            self.generated_layout_path = str(layout_path)
            self.generated_audio_path = str(audio_path)
            self.generated_slide_paths = slide_paths
            self.cleaned_audio_path = ""
            self.generated_layout_words = words
            self.window.after(0, lambda: self.show_preview(preview_image))
            self.window.after(0, lambda: self.set_progress(1.0, "Image generated"))

        self.run_in_background(task, "Image generated")

    def show_preview(self, image: Image.Image) -> None:
        self.preview_full_image = image.copy()
        self._refresh_preview_image()

    def _on_preview_resize(self, _event=None) -> None:
        if self.preview_full_image is not None:
            self._refresh_preview_image()

    def _refresh_preview_image(self) -> None:
        if self.preview_full_image is None:
            return
        available_width = max((self.preview_label.winfo_width() or self.preview_container.winfo_width() or 980) - 24, 220)
        available_height = max((self.preview_label.winfo_height() or self.preview_container.winfo_height() or 720) - 24, 220)
        preview = self.preview_full_image.copy()
        preview.thumbnail((available_width, available_height))
        self.preview_image_tk = ImageTk.PhotoImage(preview)
        self.preview_label.configure(image=self.preview_image_tk)

    def open_large_preview(self, _event=None) -> None:
        if self.preview_full_image is None:
            return

        viewer = tk.Toplevel(self.window)
        viewer.title("תצוגה גדולה")
        try:
            viewer.state("zoomed")
        except tk.TclError:
            viewer.geometry(
                f"{self.window.winfo_screenwidth()}x{self.window.winfo_screenheight()}+0+0"
            )
        viewer.minsize(1000, 700)

        frame = ttk.Frame(viewer, padding=8)
        frame.pack(fill="both", expand=True)
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)

        canvas = tk.Canvas(frame, bg="white")
        canvas.grid(row=0, column=0, sticky="nsew")
        y_scroll = ttk.Scrollbar(frame, orient="vertical", command=canvas.yview)
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll = ttk.Scrollbar(frame, orient="horizontal", command=canvas.xview)
        x_scroll.grid(row=1, column=0, sticky="ew")
        canvas.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

        full_image_tk = ImageTk.PhotoImage(self.preview_full_image)
        canvas.create_image(0, 0, anchor="nw", image=full_image_tk)
        canvas.image = full_image_tk
        canvas.configure(scrollregion=(0, 0, self.preview_full_image.width, self.preview_full_image.height))

    def open_text_settings(self) -> None:
        dialog = tk.Toplevel(self.window)
        dialog.title("מאפייני טקסט")
        dialog.transient(self.window)
        dialog.grab_set()
        dialog.resizable(False, False)

        frame = ttk.Frame(dialog, padding=12)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(1, weight=1)

        self._add_entry(frame, 0, "Font path", self.font_path_var, button=("Browse", self.pick_font))
        self._add_entry(frame, 1, "Font size", self.font_size_var)
        self._add_entry(frame, 2, "Line width", self.line_width_var)
        self._add_entry(frame, 3, "Line spacing", self.line_spacing_var)
        self._add_entry(frame, 4, "Column gap", self.column_gap_var)
        ttk.Checkbutton(
            frame,
            text="צבע טעמי מקרא בנפרד",
            variable=self.highlight_cantillation_var,
        ).grid(row=5, column=0, columnspan=2, sticky="w", pady=(6, 0))
        self._add_entry(frame, 6, "Cantillation color", self.cantillation_color_var)
        self._add_entry(frame, 7, "Slides count", self.slide_count_var)
        self._add_entry(frame, 8, "Transition sec", self.transition_duration_var)
        ttk.Checkbutton(
            frame,
            text="Create separate videos for slides",
            variable=self.separate_slide_videos_var,
        ).grid(row=9, column=0, columnspan=2, sticky="w", pady=(6, 0))
        ttk.Button(dialog, text="סגור", command=dialog.destroy).pack(fill="x", padx=12, pady=(0, 12))

    def open_layout_editor(self) -> None:
        tora_order_dir = build_tora_order_directory(self.output_dir_var.get())
        default_lines_per_page = max(int(self.layout_lines_per_page_var.get() or "42"), 1)
        if self.current_passage:
            layout_path = tora_order_dir / f"{self.get_reference_stem()}.txt"
            if layout_path.exists():
                self.manual_layout_text = layout_path.read_text(encoding="utf-8")
                parsed_count_pages, parsed_lines_per_page = parse_count_layout_pages(self.manual_layout_text, default_lines_per_page)
                if parsed_count_pages is not None:
                    editor_pages = parsed_count_pages
                    default_lines_per_page = parsed_lines_per_page
                    source_words = extract_source_words_from_verses(self.current_passage.get("verses", []))
                else:
                    editor_pages = build_count_pages_from_layout_text(self.manual_layout_text, default_lines_per_page)
                    source_words = extract_layout_tokens(self.manual_layout_text)
            else:
                editor_pages = build_count_draft_pages(
                    "\n".join(text for _ref, text in self.current_passage.get("verses", [])),
                    self.font_path_var.get(),
                    int(self.font_size_var.get()),
                    int(self.line_width_var.get()),
                    default_lines_per_page,
                )
                self.manual_layout_text = serialize_count_layout_pages(editor_pages, default_lines_per_page)
                source_words = extract_source_words_from_verses(self.current_passage.get("verses", []))
            self.manual_layout_path = str(layout_path)
            self.update_active_layout_label()
        else:
            if not self.manual_layout_path:
                chosen_path = filedialog.askopenfilename(
                    title="בחר קובץ Layout",
                    initialdir=str(tora_order_dir),
                    filetypes=[("Layout text", "*.txt"), ("All files", "*.*")],
                )
                if not chosen_path:
                    return
                self.manual_layout_path = chosen_path
                self.update_active_layout_label()
            self.manual_layout_text = Path(self.manual_layout_path).read_text(encoding="utf-8")
            source_words = extract_layout_tokens(self.manual_layout_text)
            parsed_count_pages, parsed_lines_per_page = parse_count_layout_pages(self.manual_layout_text, default_lines_per_page)
            if parsed_count_pages is not None:
                editor_pages = parsed_count_pages
                default_lines_per_page = parsed_lines_per_page
            else:
                editor_pages = build_count_pages_from_layout_text(self.manual_layout_text, default_lines_per_page)

        dialog = tk.Toplevel(self.window)
        dialog.title("Manual Torah Layout")
        dialog.transient(self.window)
        dialog.grab_set()
        dialog.geometry("1420x860")

        lines_per_page = default_lines_per_page
        current_page_index = tk.IntVar(value=0)
        preview_image_ref = {"image": None}
        line_count_var = tk.StringVar(value=str(lines_per_page))
        page_status_var = tk.StringVar()
        preview_status_var = tk.StringVar(value="תצוגה מקדימה של העמוד הנבחר")
        preview_label: Optional[ttk.Label] = None
        preview_holder = {"widget": None}
        row_widgets: List[Tuple[tk.StringVar, tk.StringVar, tk.StringVar]] = []
        row_entries: List[Tuple[tk.Entry, tk.Entry, tk.Entry]] = []
        active_cell = {"row": 0, "col": 1}
        preview_after_id = {"value": None}

        frame = ttk.Frame(dialog, padding=12)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(0, weight=3)
        frame.columnconfigure(1, weight=4)
        frame.rowconfigure(1, weight=1)

        help_text = (
            "מכניסים רק מספרי מילים בכל שורה. המערכת ממשיכה ברצף מהמילה הראשונה של הקטע, "
            "ומחלקת את המילים לעמודות R / C / L לפי הכמויות שתכתוב."
        )
        ttk.Label(frame, text=help_text, wraplength=1350, justify="right").grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 8))

        preview_frame = ttk.LabelFrame(frame, text="תצוגה מקדימה", padding=10)
        preview_frame.grid(row=1, column=0, sticky="nsew", padx=(0, 8))
        preview_frame.columnconfigure(0, weight=1)
        preview_frame.rowconfigure(0, weight=1)
        preview_label = ttk.Label(preview_frame, anchor="n")
        preview_label.grid(row=0, column=0, sticky="nsew")
        ttk.Label(preview_frame, textvariable=preview_status_var, anchor="center").grid(row=1, column=0, sticky="ew", pady=(8, 0))
        preview_holder["widget"] = preview_label

        editor_frame = ttk.LabelFrame(frame, text="עמוד שורות R / C / L", padding=10)
        editor_frame.grid(row=1, column=1, sticky="nsew")
        editor_frame.columnconfigure(0, weight=1)
        editor_frame.rowconfigure(1, weight=1)

        toolbar = ttk.Frame(editor_frame)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        for col in range(9):
            toolbar.columnconfigure(col, weight=0)
        toolbar.columnconfigure(8, weight=1)

        ttk.Label(toolbar, text="שורות בעמוד").grid(row=0, column=0, sticky="w")
        ttk.Entry(toolbar, textvariable=line_count_var, width=6).grid(row=0, column=1, sticky="w", padx=(6, 10))
        ttk.Label(toolbar, textvariable=page_status_var).grid(row=0, column=2, sticky="w", padx=(0, 10))

        grid_wrap = ttk.Frame(editor_frame)
        grid_wrap.grid(row=1, column=0, sticky="nsew")
        grid_wrap.columnconfigure(0, weight=1)
        grid_wrap.rowconfigure(0, weight=1)

        canvas = tk.Canvas(grid_wrap, highlightthickness=0)
        canvas.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(grid_wrap, orient="vertical", command=canvas.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        canvas.configure(yscrollcommand=scroll.set)

        rows_frame = ttk.Frame(canvas)
        rows_window = canvas.create_window((0, 0), window=rows_frame, anchor="nw")

        def update_scroll_region(_event=None) -> None:
            canvas.configure(scrollregion=canvas.bbox("all"))

        def sync_rows_width(_event=None) -> None:
            canvas.itemconfigure(rows_window, width=canvas.winfo_width())

        rows_frame.bind("<Configure>", update_scroll_region)
        canvas.bind("<Configure>", sync_rows_width)

        def make_blank_page(line_count: int) -> List[LayoutCountRow]:
            return [LayoutCountRow() for _ in range(line_count)]

        def copy_page_rows(page_rows: Sequence[LayoutCountRow], target_count: int) -> List[LayoutCountRow]:
            copied = [LayoutCountRow(line.right_count, line.center_count, line.left_count) for line in page_rows[:target_count]]
            while len(copied) < target_count:
                copied.append(LayoutCountRow())
            return copied

        def collect_rows_from_widgets() -> None:
            if not row_widgets or current_page_index.get() >= len(editor_pages):
                return
            page_rows = editor_pages[current_page_index.get()]
            for row_index, (left_var, center_var, right_var) in enumerate(row_widgets):
                page_rows[row_index] = LayoutCountRow(
                    right_count=parse_optional_non_negative_int(right_var.get()),
                    center_count=parse_optional_non_negative_int(center_var.get()),
                    left_count=parse_optional_non_negative_int(left_var.get()),
                )

        def update_page_status() -> None:
            page_status_var.set(f"עמוד {current_page_index.get() + 1} מתוך {len(editor_pages)}")

        def schedule_preview() -> None:
            if preview_after_id["value"] is not None:
                dialog.after_cancel(preview_after_id["value"])
            preview_after_id["value"] = dialog.after(160, refresh_preview)

        def render_page_rows() -> None:
            nonlocal row_widgets, row_entries
            for child in rows_frame.winfo_children():
                child.destroy()
            row_widgets = []
            row_entries = []

            ttk.Label(rows_frame, text="#", anchor="center").grid(row=0, column=0, sticky="ew", padx=2, pady=(0, 4))
            ttk.Label(rows_frame, text="L", anchor="center").grid(row=0, column=1, sticky="ew", padx=2, pady=(0, 4))
            ttk.Label(rows_frame, text="C", anchor="center").grid(row=0, column=2, sticky="ew", padx=2, pady=(0, 4))
            ttk.Label(rows_frame, text="R", anchor="center").grid(row=0, column=3, sticky="ew", padx=2, pady=(0, 4))
            rows_frame.columnconfigure(1, weight=1)
            rows_frame.columnconfigure(2, weight=1)
            rows_frame.columnconfigure(3, weight=1)

            page_rows = copy_page_rows(editor_pages[current_page_index.get()], max(int(line_count_var.get() or "42"), 1))
            editor_pages[current_page_index.get()] = page_rows
            for row_index, line in enumerate(page_rows, start=1):
                ttk.Label(rows_frame, text=str(row_index), anchor="center").grid(row=row_index, column=0, sticky="ew", padx=2, pady=2)
                left_var = tk.StringVar(value=str(line.left_count or ""))
                center_var = tk.StringVar(value=str(line.center_count or ""))
                right_var = tk.StringVar(value=str(line.right_count or ""))
                for var in (left_var, center_var, right_var):
                    var.trace_add("write", lambda *_args: schedule_preview())
                left_entry = ttk.Entry(rows_frame, textvariable=left_var, justify="center")
                center_entry = ttk.Entry(rows_frame, textvariable=center_var, justify="center")
                right_entry = ttk.Entry(rows_frame, textvariable=right_var, justify="center")
                left_entry.grid(row=row_index, column=1, sticky="ew", padx=2, pady=2)
                center_entry.grid(row=row_index, column=2, sticky="ew", padx=2, pady=2)
                right_entry.grid(row=row_index, column=3, sticky="ew", padx=2, pady=2)
                left_entry.bind("<FocusIn>", lambda _event, r=row_index - 1: active_cell.update({"row": r, "col": 0}))
                center_entry.bind("<FocusIn>", lambda _event, r=row_index - 1: active_cell.update({"row": r, "col": 1}))
                right_entry.bind("<FocusIn>", lambda _event, r=row_index - 1: active_cell.update({"row": r, "col": 2}))
                row_widgets.append((left_var, center_var, right_var))
                row_entries.append((left_entry, center_entry, right_entry))

        def focus_cell(row_index: int, col_index: int) -> None:
            if not row_entries:
                return
            safe_row = max(0, min(row_index, len(row_entries) - 1))
            safe_col = max(0, min(col_index, 2))
            active_cell["row"] = safe_row
            active_cell["col"] = safe_col
            entry = row_entries[safe_row][safe_col]
            entry.focus_set()
            entry.icursor("end")

        def adjust_active_cell(delta: int) -> None:
            if not row_widgets:
                return
            row_index = max(0, min(active_cell["row"], len(row_widgets) - 1))
            col_index = max(0, min(active_cell["col"], 2))
            target_var = row_widgets[row_index][col_index]
            current_value = parse_optional_non_negative_int(target_var.get())
            new_value = max(current_value + delta, 0)
            target_var.set("" if new_value == 0 else str(new_value))
            focus_cell(row_index, col_index)

        def move_to_next_line() -> None:
            if not row_entries:
                return
            next_row = min(active_cell["row"] + 1, len(row_entries) - 1)
            focus_cell(next_row, active_cell["col"])

        def build_page_preview_source() -> str:
            collect_rows_from_widgets()
            page_rows = copy_page_rows(editor_pages[current_page_index.get()], max(int(line_count_var.get() or "42"), 1))
            word_offset = sum(count_row_total(row) for page in editor_pages[:current_page_index.get()] for row in page)
            preview_page, _cursor = build_layout_page_from_count_rows(source_words, page_rows, word_offset)
            return serialize_manual_layout_pages([preview_page])

        def refresh_preview() -> None:
            preview_after_id["value"] = None
            if preview_label is None:
                return
            try:
                preview_source = build_page_preview_source()
                if not preview_source.strip():
                    preview_label.configure(image="")
                    preview_status_var.set("אין עדיין תוכן להצגה")
                    return
                cantillation_color = self.cantillation_color_var.get().strip() if self.highlight_cantillation_var.get() else None
                images, _words = layout_manual_pages(
                    preview_source,
                    self.font_path_var.get(),
                    int(self.font_size_var.get()),
                    int(self.line_width_var.get()),
                    int(self.line_spacing_var.get()),
                    column_gap=int(self.column_gap_var.get() or "80"),
                    cantillation_color=cantillation_color,
                )
                preview = images[0].copy()
                preview_frame.update_idletasks()
                available_width = max((preview_label.winfo_width() or preview_frame.winfo_width() or 620) - 24, 220)
                available_height = max((preview_label.winfo_height() or preview_frame.winfo_height() or 760) - 48, 220)
                preview.thumbnail((available_width, available_height))
                preview_image_ref["image"] = ImageTk.PhotoImage(preview)
                preview_label.configure(image=preview_image_ref["image"])
                preview_status_var.set("תצוגה מקדימה מעודכנת")
            except Exception as exc:
                preview_label.configure(image="")
                preview_status_var.set(f"שגיאת תצוגה: {exc}")

        preview_frame.bind("<Configure>", lambda _event: schedule_preview())

        def switch_page(offset: int) -> None:
            collect_rows_from_widgets()
            new_index = current_page_index.get() + offset
            if 0 <= new_index < len(editor_pages):
                current_page_index.set(new_index)
                update_page_status()
                render_page_rows()
                refresh_preview()

        def add_page() -> None:
            collect_rows_from_widgets()
            editor_pages.append(make_blank_page(max(int(line_count_var.get() or "42"), 1)))
            current_page_index.set(len(editor_pages) - 1)
            update_page_status()
            render_page_rows()
            refresh_preview()

        def remove_page() -> None:
            if len(editor_pages) <= 1:
                return
            collect_rows_from_widgets()
            editor_pages.pop(current_page_index.get())
            current_page_index.set(min(current_page_index.get(), len(editor_pages) - 1))
            update_page_status()
            render_page_rows()
            refresh_preview()

        def apply_line_count() -> None:
            try:
                new_count = max(int(line_count_var.get() or "42"), 1)
            except ValueError:
                messagebox.showerror("Invalid line count", "מספר השורות חייב להיות מספר שלם.", parent=dialog)
                return
            collect_rows_from_widgets()
            for index, page_rows in enumerate(editor_pages):
                editor_pages[index] = copy_page_rows(page_rows, new_count)
            self.layout_lines_per_page_var.set(str(new_count))
            update_page_status()
            render_page_rows()
            refresh_preview()

        def build_draft() -> None:
            try:
                line_count = max(int(line_count_var.get() or "42"), 1)
            except ValueError:
                messagebox.showerror("Invalid line count", "מספר השורות חייב להיות מספר שלם.", parent=dialog)
                return
            source_text = "\n".join(text for _ref, text in self.current_passage.get("verses", [])) if self.current_passage else self.manual_layout_text
            draft_pages = build_count_draft_pages(
                source_text,
                self.font_path_var.get(),
                int(self.font_size_var.get()),
                int(self.line_width_var.get()),
                line_count,
            )
            editor_pages.clear()
            editor_pages.extend(draft_pages)
            self.layout_lines_per_page_var.set(str(line_count))
            current_page_index.set(0)
            update_page_status()
            render_page_rows()
            refresh_preview()

        def save_layout() -> None:
            collect_rows_from_widgets()
            normalized_pages = [copy_page_rows(page_rows, max(int(line_count_var.get() or "42"), 1)) for page_rows in editor_pages]
            serialized = serialize_count_layout_pages(normalized_pages, max(int(line_count_var.get() or "42"), 1))
            self.manual_layout_text = serialized
            self.layout_lines_per_page_var.set(str(max(int(line_count_var.get() or "42"), 1)))
            Path(self.manual_layout_path).write_text(self.manual_layout_text + "\n", encoding="utf-8")
            self.update_active_layout_label()
            self.set_status(f"Layout saved: {Path(self.manual_layout_path).name}")

        nav = ttk.Frame(toolbar)
        nav.grid(row=0, column=3, columnspan=6, sticky="e")
        ttk.Button(nav, text="-", command=lambda: adjust_active_cell(-1), width=3).grid(row=0, column=0, padx=(0, 6))
        ttk.Button(nav, text="+", command=lambda: adjust_active_cell(1), width=3).grid(row=0, column=1, padx=(0, 6))
        ttk.Button(nav, text="שורה הבאה", command=move_to_next_line).grid(row=0, column=2, padx=(0, 6))
        ttk.Button(nav, text="החל שורות", command=apply_line_count).grid(row=0, column=3, padx=(0, 6))
        ttk.Button(nav, text="בנה טיוטה אוטומטית", command=build_draft).grid(row=0, column=4, padx=(0, 6))
        ttk.Button(nav, text="שמור Layout", command=save_layout).grid(row=0, column=5, padx=(0, 6))
        ttk.Button(nav, text="עמוד קודם", command=lambda: switch_page(-1)).grid(row=0, column=6, padx=(0, 6))
        ttk.Button(nav, text="עמוד הבא", command=lambda: switch_page(1)).grid(row=0, column=7, padx=(0, 6))
        ttk.Button(nav, text="הוסף עמוד", command=add_page).grid(row=0, column=8, padx=(0, 6))
        ttk.Button(nav, text="מחק עמוד", command=remove_page).grid(row=0, column=9)

        buttons = ttk.Frame(frame)
        buttons.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        buttons.columnconfigure(0, weight=1)

        def save_layout_and_close() -> None:
            save_layout()
            dialog.destroy()

        ttk.Button(buttons, text="שמור וסגור", command=save_layout_and_close).grid(row=0, column=1, padx=(6, 0))
        ttk.Button(buttons, text="סגור", command=dialog.destroy).grid(row=0, column=2, padx=(6, 0))

        update_page_status()
        render_page_rows()
        focus_cell(0, 1)
        refresh_preview()

    def open_audio_quality(self) -> None:
        source_audio = self.audio_path_var.get().strip()
        if not source_audio:
            messagebox.showerror("Missing audio", "Record or import an audio file first.")
            return

        dialog = tk.Toplevel(self.window)
        dialog.title("איכות קול")
        dialog.transient(self.window)
        dialog.grab_set()
        dialog.geometry("520x260")

        status_var = tk.StringVar(value="אפשר לנקות רעשי רקע ולבחור באיזו גרסה להשתמש.")
        current_var = tk.StringVar(value=f"נבחר כרגע: {Path(source_audio).name}")

        frame = ttk.Frame(dialog, padding=12)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(0, weight=1)

        ttk.Label(frame, text="ניהול איכות הקלטה", font=("Segoe UI", 12, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(frame, textvariable=current_var, wraplength=470).grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Label(frame, textvariable=status_var, wraplength=470).grid(row=2, column=0, sticky="w", pady=(6, 12))

        button_grid = ttk.Frame(frame)
        button_grid.grid(row=3, column=0, sticky="ew")
        for col in range(2):
            button_grid.columnconfigure(col, weight=1)

        def play_variant(path: str) -> None:
            self.player.load(path)
            self.player.play()
            status_var.set(f"מנגן: {Path(path).name}")

        def clean_audio() -> None:
            try:
                directories = build_output_directories(self.output_dir_var.get())
                cleaned_path = directories["audio"] / f"{self.build_export_name()}_cleaned.wav"
                self.recorder.clean_voice_audio(source_audio, str(cleaned_path))
                self.cleaned_audio_path = str(cleaned_path)
                status_var.set("נוצרה גרסה נקייה. אפשר להשוות ולבחור.")
            except Exception as exc:
                messagebox.showerror("Audio cleaning failed", str(exc), parent=dialog)

        def use_original() -> None:
            self.audio_path_var.set(source_audio)
            self.recording_session_path = source_audio
            current_var.set(f"נבחר כרגע: {Path(source_audio).name}")
            status_var.set("הגרסה המקורית נבחרה.")

        def use_cleaned() -> None:
            if not self.cleaned_audio_path or not Path(self.cleaned_audio_path).exists():
                messagebox.showerror("Missing cleaned audio", "צריך קודם ליצור גרסה נקייה.", parent=dialog)
                return
            self.audio_path_var.set(self.cleaned_audio_path)
            self.recording_session_path = self.cleaned_audio_path
            current_var.set(f"נבחר כרגע: {Path(self.cleaned_audio_path).name}")
            status_var.set("הגרסה הנקייה נבחרה.")

        def play_cleaned() -> None:
            if not self.cleaned_audio_path or not Path(self.cleaned_audio_path).exists():
                messagebox.showerror("Missing cleaned audio", "צריך קודם ליצור גרסה נקייה.", parent=dialog)
                return
            play_variant(self.cleaned_audio_path)

        ttk.Button(button_grid, text="נקה רעשי רקע", command=clean_audio).grid(row=0, column=0, sticky="ew", padx=(0, 6), pady=(0, 8))
        ttk.Button(button_grid, text="נגן מקור", command=lambda: play_variant(source_audio)).grid(row=0, column=1, sticky="ew", padx=(6, 0), pady=(0, 8))
        ttk.Button(button_grid, text="נגן נקי", command=play_cleaned).grid(row=1, column=0, sticky="ew", padx=(0, 6), pady=(0, 8))
        ttk.Button(button_grid, text="השתמש במקור", command=use_original).grid(row=1, column=1, sticky="ew", padx=(6, 0), pady=(0, 8))
        ttk.Button(button_grid, text="השתמש בנקי", command=use_cleaned).grid(row=2, column=0, sticky="ew", padx=(0, 6))
        ttk.Button(button_grid, text="סגור", command=dialog.destroy).grid(row=2, column=1, sticky="ew", padx=(6, 0))

    def refresh_audio_devices(self) -> None:
        devices = self.recorder.list_audio_devices() if self.recorder.available else []
        self.device_combo["values"] = devices
        if devices:
            self.device_var.set(devices[0])
        else:
            self.device_var.set("")

    def start_recording(self) -> None:
        if not self.generated_audio_path:
            directories = build_output_directories(self.output_dir_var.get())
            self.generated_audio_path = str(directories["audio"] / f"{self.build_export_name()}.wav")
        if not self.device_var.get():
            messagebox.showerror("Missing microphone", "No audio input device was found. You can still import an existing audio file.")
            return
        try:
            self.stop_audio()
            Path(self.generated_audio_path).unlink(missing_ok=True)
            self.recording_session_path = self.generated_audio_path
            self.cleaned_audio_path = ""
            self.recording_saved_seconds = 0.0
            self.recording_segment_index = 0
            self.recording_progress_var.set(0.0)
            self.recording_elapsed_var.set("00:00")
            self._start_recording_segment(reset_status=True)
            self.recording_status_var.set("Recording now...")
            self.set_status("Recording in progress...")
        except Exception as exc:
            self.recording_status_var.set("Recording failed")
            messagebox.showerror("Recording failed", str(exc))

    def pause_recording(self) -> None:
        try:
            if not self.recorder.is_recording:
                return
            output = self.recorder.stop_recording()
            self._merge_recording_segment(output)
            self._stop_recording_timer()
            self.recording_status_var.set("Recording paused")
            self.set_status("Recording paused")
        except Exception as exc:
            self.recording_status_var.set("Recording failed")
            messagebox.showerror("Pause recording failed", str(exc))

    def resume_recording(self) -> None:
        if self.recorder.is_recording:
            return
        if not self.recording_session_path:
            self.start_recording()
            return
        try:
            self._start_recording_segment(reset_status=False)
            self.recording_status_var.set("Recording now...")
            self.set_status("Recording resumed")
        except Exception as exc:
            self.recording_status_var.set("Recording failed")
            messagebox.showerror("Resume recording failed", str(exc))

    def rewind_recording(self) -> None:
        try:
            rewind_seconds = float(self.rewind_seconds_var.get() or "0")
        except ValueError:
            messagebox.showerror("Invalid rewind", "Enter rewind seconds as a number.")
            return
        if rewind_seconds <= 0:
            return
        if self.recorder.is_recording:
            self.pause_recording()
        if not self.recording_session_path or not Path(self.recording_session_path).exists():
            return

        try:
            current_duration = self.recorder.probe_duration(self.recording_session_path)
            target_duration = max(current_duration - rewind_seconds, 0.0)
            if target_duration <= 0:
                Path(self.recording_session_path).unlink(missing_ok=True)
                self.recording_saved_seconds = 0.0
                self.audio_path_var.set("")
            else:
                with NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                    temp_path = temp_file.name
                self.recorder.trim_audio(self.recording_session_path, temp_path, target_duration)
                shutil.move(temp_path, self.recording_session_path)
                self.recording_saved_seconds = self.recorder.probe_duration(self.recording_session_path)
                self.audio_path_var.set(self.recording_session_path)
            self._refresh_recording_display()
            self.recording_status_var.set("Recording rewound")
            self.set_status(f"Rewound {rewind_seconds:.1f} seconds")
        except Exception as exc:
            messagebox.showerror("Rewind failed", str(exc))

    def stop_recording(self) -> None:
        try:
            if self.recorder.is_recording:
                output = self.recorder.stop_recording()
                self._merge_recording_segment(output)
            self._stop_recording_timer()
            final_path = self.recording_session_path
            if final_path and Path(final_path).exists():
                self.audio_path_var.set(final_path)
                load_error = None
                for _ in range(5):
                    try:
                        self.player.load(final_path)
                        load_error = None
                        break
                    except Exception as exc:
                        load_error = exc
                        time.sleep(0.3)
                if load_error is not None:
                    self.set_status("Recording saved, but preview load was delayed")
                else:
                    self.set_status("Recording stopped")
                self.recording_status_var.set("Recording saved")
            else:
                self.recording_status_var.set("Not recording")
                self.set_status("Recording stopped")
            self._refresh_recording_display()
        except Exception as exc:
            self.recording_status_var.set("Recording failed")
            messagebox.showerror("Stop recording failed", str(exc))

    def import_audio(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("Audio files", "*.wav *.mp3 *.m4a"), ("All files", "*.*")])
        if path:
            directories = build_output_directories(self.output_dir_var.get())
            suffix = Path(path).suffix or ".wav"
            imported_path = directories["audio"] / f"{self.build_export_name()}{suffix}"
            if Path(path).resolve() != imported_path.resolve():
                shutil.copyfile(path, imported_path)
            self.audio_path_var.set(str(imported_path))
            self.player.load(str(imported_path))
            self.recording_session_path = str(imported_path)
            self.generated_audio_path = str(imported_path)
            self.cleaned_audio_path = ""
            try:
                self.recording_saved_seconds = self.recorder.probe_duration(str(imported_path))
            except Exception:
                self.recording_saved_seconds = 0.0
            self._refresh_recording_display()
            self.set_status("Audio imported")

    def play_audio(self) -> None:
        audio_path = self.audio_path_var.get().strip()
        if not audio_path:
            messagebox.showerror("Missing audio", "Record or import an audio file first.")
            return
        self.player.load(audio_path)
        self.player.play()
        self.set_status("Playing audio")

    def pause_audio(self) -> None:
        self.player.pause()
        self.set_status("Audio paused")

    def stop_audio(self) -> None:
        self.player.stop()
        self.set_status("Audio stopped")

    def save_generated_image_copy(self) -> None:
        if not self.generated_image_path:
            messagebox.showerror("Missing image", "Generate the image first.")
            return
        directories = build_output_directories(self.output_dir_var.get())
        export_stem = self.build_export_name()
        path = directories["image"] / f"{export_stem}.png"
        if Path(self.generated_image_path).resolve() != path.resolve():
            shutil.copyfile(self.generated_image_path, path)
            self.generated_image_path = str(path)
        self.set_status(f"Image saved: {path.name}")

    def save_audio_copy(self) -> None:
        audio_path = self.audio_path_var.get().strip()
        if not audio_path:
            messagebox.showerror("Missing audio", "Record or import an audio file first.")
            return
        directories = build_output_directories(self.output_dir_var.get())
        export_stem = self.build_export_name()
        suffix = Path(audio_path).suffix or ".wav"
        path = directories["audio"] / f"{export_stem}{suffix}"
        if Path(audio_path).resolve() != path.resolve():
            shutil.copyfile(audio_path, path)
            self.audio_path_var.set(str(path))
            self.recording_session_path = str(path)
        self.set_status(f"Audio saved: {path.name}")

    def create_static_video(self) -> None:
        if not self.generated_image_path:
            messagebox.showerror("Missing image", "Generate the image first.")
            return
        audio_path = self.audio_path_var.get().strip()
        if not audio_path:
            messagebox.showerror("Missing audio", "Record or import an audio file first.")
            return

        def task() -> None:
            directories = build_output_directories(self.output_dir_var.get())
            export_stem = self.build_export_name()
            output_path = directories["video"] / f"{export_stem}_static.mp4"
            progress_callback = lambda value, text: self.window.after(0, lambda: self.set_progress(value, text))
            render_static_video(self.generated_image_path, audio_path, str(output_path), progress_callback=progress_callback)

        self.progress_var.set(0.0)
        self.run_in_background(task, "Static video created")

    def create_highlighted_video(self) -> None:
        audio_path = self.audio_path_var.get().strip()
        if not audio_path:
            messagebox.showerror("Missing audio", "Record or import an audio file first.")
            return
        if not self.generated_image_path or not self.generated_layout_words:
            messagebox.showerror("Missing text layout", "Highlighted video requires an image generated from the text layout.")
            return

        def task() -> None:
            directories = build_output_directories(self.output_dir_var.get())
            export_stem = self.build_export_name()

            def progress_callback(value: float, text: str) -> None:
                self.window.after(0, lambda: self.set_progress(value, text))

            progress_callback(0.05, "Transcribing recorded audio...")
            whisper_result, synced_words = build_synced_words_from_layout(
                self.generated_layout_words,
                audio_path,
                model_name=self.model_name_var.get().strip() or "small",
                progress_callback=progress_callback,
            )
            self.synced_words = synced_words
            try:
                transition_duration = float(self.transition_duration_var.get() or "0.35")
            except ValueError:
                transition_duration = 0.35
            style = RenderStyle()

            if self.separate_slide_videos_var.get() and len(self.generated_slide_paths) > 1:
                slide_count = len(self.generated_slide_paths)
                for slide_index, slide_path in enumerate(self.generated_slide_paths):
                    slide_words = [word for word in synced_words if word.slide_index == slide_index]
                    if not slide_words:
                        continue
                    progress_callback(
                        0.8 + ((slide_index / max(slide_count, 1)) * 0.18),
                        f"Rendering slide video {slide_index + 1}/{slide_count}...",
                    )
                    output_path = directories["video"] / f"{export_stem}_{slide_index + 1}.mp4"
                    render_slide_segment_video(
                        image_path=slide_path,
                        audio_path=audio_path,
                        synced_words=slide_words,
                        output_path=str(output_path),
                        style=style,
                    )
                progress_callback(1.0, "Separate slide videos created")
                return

            output_path = directories["video"] / f"{export_stem}_highlighted.mp4"
            progress_callback(0.8, "Rendering highlighted video...")
            render_video(
                image_path=(self.generated_slide_paths[0] if self.generated_slide_paths else self.generated_image_path),
                audio_path=audio_path,
                synced_words=synced_words,
                output_path=str(output_path),
                style=style,
                progress_callback=progress_callback,
                slide_image_paths=self.generated_slide_paths or None,
                transition_duration=transition_duration,
            )

        self.progress_var.set(0.0)
        self.run_in_background(task, "Highlighted video created")

    def on_close(self) -> None:
        try:
            if self.recorder.is_recording:
                self.recorder.stop_recording()
        except Exception:
            pass
        self._stop_recording_timer()
        self.player.close()
        self.temp_dir.cleanup()
        self.window.destroy()

    def _start_recording_segment(self, reset_status: bool) -> None:
        self.recording_segment_index += 1
        base_dir = Path(self.temp_dir.name)
        base_dir.mkdir(parents=True, exist_ok=True)
        self.recording_segment_path = str(base_dir / f"recording_segment_{self.recording_segment_index:03d}.wav")
        self.recorder.start_recording(self.device_var.get(), self.recording_segment_path)
        self.recording_started_at = time.monotonic()
        if reset_status:
            self.audio_path_var.set(self.recording_session_path)
        self._start_recording_timer()

    def _merge_recording_segment(self, segment_path: str) -> None:
        if not segment_path or not Path(segment_path).exists():
            return
        if not self.recording_session_path:
            self.recording_session_path = self.generated_audio_path or segment_path
        if Path(self.recording_session_path).resolve() == Path(segment_path).resolve():
            self.recording_saved_seconds = self.recorder.probe_duration(self.recording_session_path)
            self.audio_path_var.set(self.recording_session_path)
            return
        if not Path(self.recording_session_path).exists():
            shutil.move(segment_path, self.recording_session_path)
        else:
            with NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                temp_path = temp_file.name
            self.recorder.concat_audio_files([self.recording_session_path, segment_path], temp_path)
            shutil.move(temp_path, self.recording_session_path)
            Path(segment_path).unlink(missing_ok=True)
        self.recording_saved_seconds = self.recorder.probe_duration(self.recording_session_path)
        self.audio_path_var.set(self.recording_session_path)
        self._refresh_recording_display()

    def _start_recording_timer(self) -> None:
        self._stop_recording_timer()

        def tick() -> None:
            self._refresh_recording_display()
            if self.recorder.is_recording:
                self.recording_update_after = self.window.after(250, tick)
            else:
                self.recording_update_after = None

        tick()

    def _stop_recording_timer(self) -> None:
        if self.recording_update_after is not None:
            self.window.after_cancel(self.recording_update_after)
            self.recording_update_after = None

    def _refresh_recording_display(self) -> None:
        live_elapsed = max(time.monotonic() - self.recording_started_at, 0.0) if self.recorder.is_recording else 0.0
        total_seconds = self.recording_saved_seconds + live_elapsed
        display_max = max(total_seconds + 5.0, 30.0)
        self.recording_progress_var.set((total_seconds / display_max) * 100.0 if display_max else 0.0)
        self.recording_elapsed_var.set(self._format_clock(total_seconds))

    @staticmethod
    def _format_clock(total_seconds: float) -> str:
        seconds = max(int(total_seconds), 0)
        minutes, seconds = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)
        if hours:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return f"{minutes:02d}:{seconds:02d}"
