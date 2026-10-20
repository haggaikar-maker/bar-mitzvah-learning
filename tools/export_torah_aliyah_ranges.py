"""Export the Text2Video Tikkun aliyah ranges for use by the web preview."""

import json
import sys
from pathlib import Path

from text_sync_worker import PARASHA_ORDER, get_aliyah_refs, get_maftir_refs, ref_to_text


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python export_torah_aliyah_ranges.py <Text2Video path> <output.json>")
    text2video_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    ranges = {
        parasha: {
            str(aliyah): {
                "start": ref_to_text(start),
                "end": ref_to_text(end),
            }
            for aliyah in range(1, 8)
            for start, end in [get_aliyah_refs(text2video_path / "tikkun_data", parasha, aliyah)]
        }
        for parasha in PARASHA_ORDER
    }
    maftir_ranges = {
        parasha: {
            "start": ref_to_text(start),
            "end": ref_to_text(end),
        }
        for parasha in PARASHA_ORDER
        for start, end in [get_maftir_refs(text2video_path / "tikkun_data", parasha)]
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "export const torahAliyahRanges = " + json.dumps(ranges, ensure_ascii=False, indent=2) + " as const\n\n"
        + "export const torahMaftirRanges = " + json.dumps(maftir_ranges, ensure_ascii=False, indent=2) + " as const\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
