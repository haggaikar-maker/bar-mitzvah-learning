"""Background word-alignment worker backed by the existing Text2Video Whisper code."""

import argparse
import hashlib
import json
import os
import platform
import re
import signal
import sys
import tempfile
import time
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

import requests


BOOK_NAMES = {
    1: "Genesis",
    2: "Exodus",
    3: "Leviticus",
    4: "Numbers",
    5: "Deuteronomy",
}

PARASHA_ORDER = [
    "בראשית", "נח", "לך לך", "וירא", "חיי שרה", "תולדות", "ויצא", "וישלח",
    "וישב", "מקץ", "ויגש", "ויחי", "שמות", "וארא", "בא", "בשלח", "יתרו",
    "משפטים", "תרומה", "תצוה", "כי תשא", "ויקהל", "פקודי", "ויקרא", "צו",
    "שמיני", "תזריע", "מצורע", "אחרי מות", "קדושים", "אמור", "בהר", "בחוקותי",
    "במדבר", "נשא", "בהעלותך", "שלח לך", "קרח", "חקת", "בלק", "פנחס", "מטות",
    "מסעי", "דברים", "ואתחנן", "עקב", "ראה", "שופטים", "כי תצא", "כי תבוא",
    "נצבים", "וילך", "האזינו", "וזאת הברכה",
]


def normalize_hebrew_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    return "".join(char for char in normalized if char.isalnum())


@lru_cache(maxsize=1)
def load_torah_index(data_path: str):
    root = Path(data_path)
    verses = []
    markers = []
    page_files = sorted((root / "pages" / "torah").glob("*.json"), key=lambda path: int(path.stem))
    for page_path in page_files:
        page = json.loads(page_path.read_text(encoding="utf-8"))
        for row in page:
            row_verses = row.get("verses") or []
            for verse in row_verses:
                ref = (int(verse["book"]), int(verse["chapter"]), int(verse["verse"]))
                if not verses or verses[-1] != ref:
                    verses.append(ref)
            if row_verses:
                aliyah_start = (int(row_verses[0]["book"]), int(row_verses[0]["chapter"]), int(row_verses[0]["verse"]))
                for aliyah in row.get("aliyot") or []:
                    standard = aliyah.get("standard")
                    if isinstance(standard, int) and 1 <= standard <= 8:
                        markers.append((standard, aliyah_start))
    return verses, markers


def get_aliyah_refs(data_path: Path, parasha_name: str, aliyah_number: int):
    names = {normalize_hebrew_name(name): index for index, name in enumerate(PARASHA_ORDER)}
    parasha_index = names.get(normalize_hebrew_name(parasha_name))
    if parasha_index is None:
        raise ValueError(f"לא נמצאה התאמה לפרשה '{parasha_name}' בנתוני העליות.")

    verses, markers = load_torah_index(str(data_path.resolve()))

    if len([marker for marker in markers if marker[0] == 1]) != len(PARASHA_ORDER):
        raise ValueError("מספר תחילות הפרשיות בנתוני Tikkun לא תואם לרשימת פרשות התורה.")

    start_markers = [i for i, marker in enumerate(markers) if marker[0] == 1]
    portion_start = start_markers[parasha_index]
    portion_end = start_markers[parasha_index + 1] if parasha_index + 1 < len(start_markers) else len(markers)
    selected_markers = markers[portion_start:portion_end]
    marker_number = aliyah_number
    if aliyah_number == 7 and not any(marker[0] == 7 for marker in selected_markers):
        # The Tikkun source labels the final weekly aliyah as 8 in two portions.
        marker_number = 8
    selected = next((i for i, marker in enumerate(selected_markers) if marker[0] == marker_number), None)
    if selected is None:
        raise ValueError(f"לא נמצאה עלייה {aliyah_number} לפרשת {parasha_name}.")

    start_ref = selected_markers[selected][1]
    if aliyah_number == 7:
        # The final weekly aliyah includes the Maftir passage. Marker 8 is
        # useful for exposing Maftir separately, but must not truncate aliyah 7.
        next_start = markers[portion_end][1] if portion_end < len(markers) else None
    else:
        next_start = selected_markers[selected + 1][1] if selected + 1 < len(selected_markers) else (
            markers[portion_end][1] if portion_end < len(markers) else None
        )
    start_index = verses.index(start_ref)
    end_index = verses.index(next_start) - 1 if next_start else len(verses) - 1
    end_ref = verses[max(start_index, end_index)]
    if end_ref[0] not in BOOK_NAMES:
        raise ValueError("העלייה שנבחרה אינה נמצאת בחומש.")
    return start_ref, end_ref


def get_maftir_refs(data_path: Path, parasha_name: str):
    names = {normalize_hebrew_name(name): index for index, name in enumerate(PARASHA_ORDER)}
    parasha_index = names.get(normalize_hebrew_name(parasha_name))
    if parasha_index is None:
        raise ValueError(f"לא נמצאה התאמה לפרשה '{parasha_name}' בנתוני העליות.")

    verses, markers = load_torah_index(str(data_path.resolve()))
    start_markers = [i for i, marker in enumerate(markers) if marker[0] == 1]
    portion_start = start_markers[parasha_index]
    portion_end = start_markers[parasha_index + 1] if parasha_index + 1 < len(start_markers) else len(markers)
    selected_markers = markers[portion_start:portion_end]
    maftir_marker = next((marker for marker in selected_markers if marker[0] == 8), None)

    if portion_end < len(markers):
        end_index = verses.index(markers[portion_end][1]) - 1
    else:
        end_index = len(verses) - 1
    if maftir_marker:
        start_index = verses.index(maftir_marker[1])
    else:
        # Some terminal portions have no explicit marker 8; use their final
        # three verses as the traditional Maftir repeat.
        start_index = max(verses.index(selected_markers[-1][1]), end_index - 2)
    if start_index > end_index:
        raise ValueError(f"לא נמצא טווח מפטיר תקין לפרשת {parasha_name}.")
    return verses[start_index], verses[end_index]


def ref_to_text(ref):
    book, chapter, verse = ref
    return f"{BOOK_NAMES[book]} {chapter}:{verse}"


def worker_request_headers(secret: str) -> dict[str, str]:
    headers = {"x-text-sync-worker-secret": secret}
    vercel_bypass = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET", "").strip()
    if vercel_bypass:
        headers["x-vercel-protection-bypass"] = vercel_bypass
    return headers


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as audio_file:
        for chunk in iter(lambda: audio_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def update_job(site_url: str, secret: str, job_id: str, **payload: Any):
    response = requests.patch(
        f"{site_url.rstrip('/')}/api/text-sync-worker/jobs/{job_id}",
        json=payload,
        headers=worker_request_headers(secret),
        timeout=120,
    )
    response.raise_for_status()


@lru_cache(maxsize=1)
def load_shared_tikkun_layout():
    """Read the same raw Tikkun rows and TOC used by the teacher's passage preview."""
    data_path = Path(__file__).resolve().parents[1] / "src" / "data" / "tikkun-torah-layout.json"
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    lines = {}
    stream = []
    first_token_by_line = {}

    def tokenize(raw_text: str) -> list[str]:
        cleaned = re.sub(r"#\([^)]*\)|#\[[^\]]*\]", " ", raw_text)
        cleaned = re.sub(r"[A-Za-z0-9_/\\|~`=*+<>]+", " ", cleaned)
        return [word.strip("\"'׳״,;|׀") for word in cleaned.split() if normalize_hebrew_name(word)]

    for page_number, page_rows in enumerate(payload["pages"], start=1):
        for row_number, source_row in enumerate(page_rows, start=1):
            raw_groups = source_row.get("text") or []
            segments = []
            for group in raw_groups:
                raw_parts = group if isinstance(group, list) else [group]
                for raw_part in raw_parts:
                    words = tokenize(str(raw_part or ""))
                    if words:
                        segments.append(words)
            lines[(page_number, row_number)] = {
                "segments": segments,
                "is_petucha": bool(source_row.get("isPetucha")),
            }
            for segment_index, words in enumerate(segments):
                for token_index, word in enumerate(words):
                    first_token_by_line.setdefault((page_number, row_number), len(stream))
                    normalized = "".join(
                        char for char in unicodedata.normalize("NFKD", word)
                        if "\u05d0" <= char <= "\u05ea" and not unicodedata.category(char).startswith("M")
                    )
                    stream.append({
                        "page": page_number,
                        "row": row_number,
                        "segment": segment_index,
                        "token": token_index,
                        "text": word,
                        "normalized": normalized,
                        "ends_verse": "׃" in word,
                    })
    return payload["toc"], lines, stream, first_token_by_line


def build_tikkun_word_layout(passage: dict[str, Any], source_tokens: list[str], normalize_word: Any, torah_builder: Any):
    """Map timed source words onto the same TOC-anchored Tikkun rows as the preview."""
    def word_key(value: str) -> str:
        normalized = normalize_word(value)
        return "".join(char for char in normalized if "\u05d0" <= char <= "\u05ea")

    if not source_tokens:
        raise ValueError("Tikkun layout cannot be built: the Sefaria passage has no words.")
    verse_refs = passage.get("verses", [])
    book_id = torah_builder.TIKKUN_TORAH_BOOK_IDS.get(str(passage.get("book", "") or "").strip())
    if not book_id or not verse_refs:
        raise ValueError("Tikkun layout cannot be built: unsupported Torah book or missing verse references.")

    toc, full_lines, stream, first_by_line = load_shared_tikkun_layout()
    first_ref = torah_builder.parse_passage_ref(verse_refs[0][0])
    last_ref = torah_builder.parse_passage_ref(verse_refs[-1][0])
    if not first_ref or not last_ref:
        raise ValueError("Tikkun layout cannot be built: could not parse the first or last Sefaria verse reference.")

    def verse_start(chapter: int, verse: int, verse_text: str) -> int | None:
        location = toc.get(str(book_id), {}).get(str(chapter), {}).get(str(verse))
        if not location:
            raise ValueError(f"Tikkun TOC has no location for verse {chapter}:{verse}.")
        key = (int(location["p"]), int(location["l"]))
        hint = first_by_line.get(key)
        line_indexes = [index for index, item in enumerate(stream) if (item["page"], item["row"]) == key]
        if hint is None or not line_indexes:
            raise ValueError(f"Tikkun TOC points to an empty row for verse {chapter}:{verse}.")
        target_words = [word_key(word) for word in re.split(r"\s+", verse_text.strip()) if word_key(word)]
        target = target_words[0] if target_words else ""
        if target:
            for index in line_indexes:
                candidate = stream[index]["normalized"]
                if candidate == target or candidate.startswith(target):
                    return index
        for index in line_indexes:
            if stream[index]["ends_verse"]:
                return index + 1
        return hint

    passage_start = verse_start(first_ref[1], first_ref[2], verse_refs[0][1])
    end_verse_start = verse_start(last_ref[1], last_ref[2], verse_refs[-1][1])
    if passage_start is None or end_verse_start is None or end_verse_start < passage_start:
        raise ValueError(
            "Tikkun verse range is reversed or incomplete: "
            f"start {first_ref[1]}:{first_ref[2]}, end {last_ref[1]}:{last_ref[2]}."
        )
    end_token = next((index for index in range(end_verse_start, len(stream)) if stream[index]["ends_verse"]), None)
    if end_token is None or end_token < passage_start:
        raise ValueError(
            f"Tikkun row stream has no sof-pasuk marker after end verse {last_ref[1]}:{last_ref[2]}."
        )

    selected_records = stream[passage_start:end_token + 1]
    row_keys = list(dict.fromkeys((record["page"], record["row"]) for record in selected_records))
    flattened = []
    for row_position, (page_number, row_index) in enumerate(row_keys):
        line = full_lines.get((page_number, row_index))
        if not line:
            raise ValueError(f"Tikkun row data missing for page {page_number}, row {row_index}.")
        selected_by_segment = {}
        for record in selected_records:
            if (record["page"], record["row"]) == (page_number, row_index):
                selected_by_segment.setdefault(record["segment"], []).append(record)

        final_row = row_position == len(row_keys) - 1
        final_record = selected_records[-1] if final_row else None
        final_segment_partial = bool(
            final_record and final_record["token"] < len(line["segments"][final_record["segment"]]) - 1
        )
        align_final_row_right = final_segment_partial and len(line["segments"]) == 1
        segment_names = [
            "right" if len(line["segments"]) == 1 and (line["is_petucha"] or align_final_row_right)
            else "center" if len(line["segments"]) == 1
            else "right" if index == 0
            else "left" if index == len(line["segments"]) - 1
            else "center"
            for index in range(len(line["segments"]))
        ]
        row_mode = "segments" if len(line["segments"]) > 1 else (
            "right" if line["is_petucha"] or align_final_row_right else "justify"
        )
        padding = {"right": {"before": [], "after": []}, "center": {"before": [], "after": []}, "left": {"before": [], "after": []}}
        row_start = len(flattened)
        for segment_index, words in enumerate(line["segments"]):
            name = segment_names[segment_index]
            selected_segment = selected_by_segment.get(segment_index, [])
            if selected_segment:
                first_token = min(record["token"] for record in selected_segment)
                last_token = max(record["token"] for record in selected_segment)
                if not align_final_row_right:
                    padding[name]["before"] = words[:first_token]
                    padding[name]["after"] = words[last_token + 1:]
                for record in selected_segment:
                    flattened.append({
                        "text": record["text"], "page": page_number, "column": 0,
                        "row": row_index, "segment": name, "rowMode": row_mode,
                    })
            else:
                padding[name]["before"] = words

        if len(flattened) == row_start:
            raise ValueError(f"Tikkun passage selection produced an empty row at page {page_number}, row {row_index}.")
        flattened[row_start]["layoutPadding"] = padding
        if line["is_petucha"]:
            flattened[-1]["breakAfter"] = "open"
        if row_position and page_number != row_keys[row_position - 1][0]:
            flattened[row_start]["pageBreakBefore"] = True

    mapped = []
    source_index = 0
    layout_index = 0
    while source_index < len(source_tokens) and layout_index < len(flattened):
        source_group = [source_tokens[source_index]]
        layout_group = [flattened[layout_index]]
        source_norm = word_key(source_group[0])
        layout_norm = word_key(layout_group[0]["text"])
        while source_norm != layout_norm:
            if source_norm.startswith(layout_norm):
                layout_index += 1
                if layout_index >= len(flattened):
                    raise ValueError(
                        "Tikkun layout ended before the current source word could be matched: "
                        f"source word {source_index + 1} ({source_tokens[source_index]!r})."
                    )
                layout_group.append(flattened[layout_index])
                layout_norm += word_key(flattened[layout_index]["text"])
            elif layout_norm.startswith(source_norm):
                source_index += 1
                if source_index >= len(source_tokens):
                    raise ValueError(
                        "Tikkun text mismatch: source token ended while matching "
                        f"{layout_group[-1]['text']!r} at layout word {layout_index + 1}."
                    )
                source_group.append(source_tokens[source_index])
                source_norm += word_key(source_tokens[source_index])
            else:
                current = flattened[layout_index]
                verse_context = ", ".join(
                    f"{ref[1]}:{ref[2]}" for ref in verse_refs[:2]
                )
                raise ValueError(
                    "Tikkun text mismatch at "
                    f"source word {source_index + 1}/{len(source_tokens)} "
                    f"({source_tokens[source_index]!r}, key={source_norm!r}) vs "
                    f"layout word {layout_index + 1}/{len(flattened)} "
                    f"({current['text']!r}, key={layout_norm!r}), "
                    f"page {current['page']} row {current['row']}; "
                    f"reading starts at {verse_context}."
                )

        first = layout_group[0]
        spans_regions = any(
            (item["page"], item["row"], item["segment"])
            != (first["page"], first["row"], first["segment"])
            for item in layout_group
        )
        if spans_regions and len(source_group) != 1:
            raise ValueError(
                "Multiple Sefaria words map across multiple Tikkun layout regions: "
                f"source word {source_index + 1} ({source_tokens[source_index]!r})."
            )
        layout_fragments = []
        if spans_regions:
            for item in layout_group:
                fragment = {
                    key: value
                    for key, value in item.items()
                    if key in {
                        "text", "page", "column", "row", "segment", "rowMode",
                        "layoutPadding", "pageBreakBefore", "breakAfter",
                    }
                }
                layout_fragments.append(fragment)
        page_break = any(item.get("pageBreakBefore") for item in layout_group)
        break_after = layout_group[-1].get("breakAfter")
        for source_offset, source_token in enumerate(source_group):
            mapped_token = {
                key: value
                for key, value in first.items()
                if key not in {"layoutPadding", "pageBreakBefore", "breakAfter"}
            }
            mapped_token["text"] = source_token
            if source_offset == 0:
                if "layoutPadding" in first:
                    mapped_token["layoutPadding"] = first["layoutPadding"]
                if page_break:
                    mapped_token["pageBreakBefore"] = True
                if layout_fragments:
                    mapped_token["layoutFragments"] = layout_fragments
            if break_after and source_offset == len(source_group) - 1:
                mapped_token["breakAfter"] = break_after
            mapped.append({
                **mapped_token,
            })
        source_index += 1
        layout_index += 1

    if source_index != len(source_tokens) or layout_index != len(flattened):
        source_left = source_tokens[source_index] if source_index < len(source_tokens) else "<end>"
        layout_left = flattened[layout_index]["text"] if layout_index < len(flattened) else "<end>"
        raise ValueError(
            "Tikkun/Sefaria word counts diverged after alignment: "
            f"source {source_index}/{len(source_tokens)} (next {source_left!r}), "
            f"layout {layout_index}/{len(flattened)} (next {layout_left!r})."
        )
    return mapped


def process_job(site_url: str, secret: str, job: dict[str, Any], text2video_path: Path):
    sys.path.insert(0, str(text2video_path))
    from builder_pipeline import fetch_passage_from_sefaria, layout_text_image
    from sync_core import extract_timed_words, normalize_word, sync_words, transcribe_audio
    import torah_builder
    from torah_builder import build_tikkun_layout_pages_for_passage

    job_id = job["id"]
    update_job(site_url, secret, job_id, status="processing", progressPercent=5)
    if all(job.get(key) for key in ("sourceBook", "startChapter", "startVerse", "endChapter", "endVerse")):
        book_name = job["sourceBook"]
        start_chapter, start_verse = int(job["startChapter"]), int(job["startVerse"])
        end_chapter, end_verse = int(job["endChapter"]), int(job["endVerse"])
    else:
        # Backward compatibility for jobs queued before explicit references were stored.
        start_ref, end_ref = get_aliyah_refs(
            text2video_path / "tikkun_data",
            job["parashaName"],
            int(job["aliyahNumber"]),
        )
        book_name = BOOK_NAMES[start_ref[0]]
        start_chapter, start_verse = start_ref[1], start_ref[2]
        end_chapter, end_verse = end_ref[1], end_ref[2]
    passage = fetch_passage_from_sefaria(
        book_name=book_name,
        start_chapter=start_chapter,
        start_verse=start_verse,
        end_chapter=end_chapter,
        end_verse=end_verse,
        include_niqqud=True,
    )
    tikkun_pages = build_tikkun_layout_pages_for_passage(passage, include_niqqud=True) if book_name in BOOK_NAMES.values() else None
    source_tokens = passage["text"].split()
    # Sefaria is canonical for text and punctuation; Whisper only supplies timing.
    _, source_words = layout_text_image(
        passage["text"],
        font_path=str(text2video_path / "StamAshkenazCLM.ttf"),
        font_size=48,
        max_line_width=1050,
        line_spacing=32,
        margin=55,
    )
    semantic_layout = (
        build_tikkun_word_layout(passage, source_tokens, normalize_word, torah_builder)
        if book_name in BOOK_NAMES.values()
        else None
    )
    has_tikkun_layout = semantic_layout is not None
    if semantic_layout is None:
        if book_name in BOOK_NAMES.values():
            raise ValueError(
                "לא הצלחנו להתאים את הקריאה לעימוד Tikkun; לא נשמור עימוד מקורב במקום עימוד ספר התורה. "
                "בדוק את פרטי ההתאמה שמופיעים בשגיאה הטכנית של המשימה."
            )
        # Keep Text2Video's measured line breaks even when a source/Tikkun word differs.
        row_by_y = {}
        semantic_layout = []
        for word in source_words:
            row = row_by_y.setdefault(word.y, len(row_by_y))
            semantic_layout.append({
                "page": 0,
                "column": 0,
                "row": row,
                "segment": "right",
                "rowMode": "right",
            })
    layout_kind = "tikkun-rows" if has_tikkun_layout else "text2video-flow"
    if not source_words:
        raise ValueError("לא הצלחנו לבנות העמדה לטקסט שנבחר.")
    update_job(site_url, secret, job_id, status="processing", progressPercent=20)

    with tempfile.TemporaryDirectory(prefix="text_sync_") as temp_dir:
        suffix = Path(job.get("audioObjectPath", "")).suffix or ".audio"
        audio_path = Path(temp_dir) / f"reading{suffix}"
        with requests.get(job["audioUrl"], stream=True, timeout=180) as response:
            response.raise_for_status()
            with audio_path.open("wb") as audio_file:
                for chunk in response.iter_content(chunk_size=256 * 1024):
                    if chunk:
                        audio_file.write(chunk)

        update_job(site_url, secret, job_id, status="processing", progressPercent=30)
        audio_sha256 = sha256_file(audio_path)
        whisper_model = os.environ.get("TEXT_SYNC_WHISPER_MODEL", "small")
        silence_threshold_db = -40
        transcript = transcribe_audio(
            str(audio_path),
            language="he",
            model_name=whisper_model,
            shift_leading_silence=False,
            silence_thresh=silence_threshold_db,
            progress_callback=None,
        )
        timing_diagnostics = {
            "workerId": os.environ.get("TEXT_SYNC_WORKER_ID") or ("vercel-daemon" if os.environ.get("VERCEL") else "local"),
            "audioSha256": audio_sha256,
            "audioBytes": audio_path.stat().st_size,
            "whisperModel": whisper_model,
            "leadingSilenceSeconds": round(float(transcript.get("leading_silence_seconds", 0.0)), 3),
            "silenceThresholdDb": silence_threshold_db,
            "leadingSilenceCorrectionApplied": bool(transcript.get("leading_silence_correction_applied", False)),
            "pythonVersion": platform.python_version(),
        }
        print(f"Text sync timing diagnostics: {json.dumps(timing_diagnostics, ensure_ascii=False, sort_keys=True)}", flush=True)
        timed_words = extract_timed_words(transcript)
        if not timed_words:
            raise ValueError("Whisper לא זיהה מילים בהקלטה.")
        update_job(site_url, secret, job_id, status="processing", progressPercent=75)

        aligned = sync_words(source_words, timed_words)
        aligned_indexes = {item.index for item in aligned}
        if aligned_indexes != set(range(len(source_tokens))):
            raise ValueError(
                f"התזמון החזיר {len(aligned_indexes)} מתוך {len(source_tokens)} מילות המקור; "
                "לא נשמור תוצאה חלקית."
            )
        tokens = [
            {
                "index": item.index,
                "text": source_tokens[item.index],
                "start": round(max(0.0, item.start), 3),
                "end": round(max(item.start + 0.01, item.end), 3),
                "confidence": round(item.confidence, 3),
                "source": item.source,
                "layoutSource": layout_kind,
                **(semantic_layout[item.index] if semantic_layout else {}),
            }
            for item in aligned
        ]
        ref = f"{book_name} {start_chapter}:{start_verse}-{end_chapter}:{end_verse}"
        result = {
            "ref": ref,
            "text": passage["text"],
            "durationSeconds": round(max((word.end for word in timed_words), default=0.0), 3),
            "alignmentMethod": f"Text2Video Whisper + {layout_kind} layout + sequence alignment",
            "layoutKind": layout_kind,
            "pages": sorted({item["page"] for item in semantic_layout}) if semantic_layout else [],
            "timingDiagnostics": timing_diagnostics,
            "tokens": tokens,
        }
        update_job(site_url, secret, job_id, status="completed", progressPercent=100, result=result, sourceRef=ref)


def main():
    parser = argparse.ArgumentParser(description="Process queued Torah reading alignment jobs using Text2Video Whisper.")
    parser.add_argument("--site-url", default=os.environ.get("TEXT_SYNC_SITE_URL"), help="Main site's base URL; may also be set with TEXT_SYNC_SITE_URL")
    parser.add_argument("--worker-secret", default=os.environ.get("TEXT_SYNC_WORKER_SECRET"), help="Must match TEXT_SYNC_WORKER_SECRET in the site environment")
    parser.add_argument(
        "--text2video-path",
        type=Path,
        default=Path(__file__).resolve().parent / "text-sync-runtime",
        help="Worker runtime directory (defaults to the packaged runtime in this project)",
    )
    parser.add_argument("--poll-seconds", type=float, default=5)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if not args.site_url:
        parser.error("--site-url or TEXT_SYNC_SITE_URL is required")
    if not args.worker_secret:
        parser.error("--worker-secret or TEXT_SYNC_WORKER_SECRET is required")
    site_url = args.site_url.rstrip("/")
    text2video_path = args.text2video_path
    required_runtime_files = (
        "sync_core.py",
        "torah_builder.py",
        "builder_pipeline.py",
        "StamAshkenazCLM.ttf",
        "tikkun_data/tables-of-contents/torah.json",
    )
    missing_runtime_files = [name for name in required_runtime_files if not (text2video_path / name).is_file()]
    if missing_runtime_files:
        raise SystemExit(
            f"Worker runtime is incomplete under {text2video_path}: " + ", ".join(missing_runtime_files)
        )

    shutdown_requested = False

    def request_shutdown(signum, _frame):
        nonlocal shutdown_requested
        if not shutdown_requested:
            print(f"Received signal {signum}; finishing the current job before exiting.", flush=True)
            shutdown_requested = True

    signal.signal(signal.SIGTERM, request_shutdown)
    print(f"Text sync worker started; polling {site_url}.", flush=True)

    while not shutdown_requested:
        try:
            response = requests.post(
                f"{site_url}/api/text-sync-worker/claim",
                headers=worker_request_headers(args.worker_secret),
                timeout=120,
            )
            response.raise_for_status()
            job = response.json().get("job")
            if not job:
                if args.once:
                    return
                time.sleep(max(args.poll_seconds, 1.0))
                continue
            try:
                process_job(site_url, args.worker_secret, job, text2video_path)
                print(f"Job {job.get('id')} completed.", flush=True)
            except Exception as error:
                print(f"Job {job.get('id')} failed: {error}", flush=True)
                try:
                    update_job(site_url, args.worker_secret, job["id"], status="failed", progressPercent=100, errorMessage=str(error))
                except Exception as update_error:
                    print(f"Could not report worker failure: {update_error}", flush=True)
            if args.once:
                return
        except requests.RequestException as error:
            print(f"Worker request failed: {error}", flush=True)
            if args.once:
                raise
            time.sleep(max(args.poll_seconds, 2.0))


if __name__ == "__main__":
    main()
