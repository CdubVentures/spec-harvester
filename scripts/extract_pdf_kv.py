#!/usr/bin/env python3
import argparse
import json
import re
from typing import Dict, List, Sequence, Tuple


def normalize(value: str) -> str:
    text = value or ""
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_line_pair(line: str) -> Tuple[str, str]:
    normalized = normalize(line)
    if not normalized:
        return "", ""

    separators = [":", " - ", " = ", "\t"]
    for sep in separators:
        if sep in normalized:
            left, right = normalized.split(sep, 1)
            return normalize(left), normalize(right)

    return "", ""


def pair_is_valid(key: str, value: str) -> bool:
    if not key or not value:
        return False
    if len(key) < 2 or len(key) > 120:
        return False
    if len(value) > 800:
        return False
    if not re.search(r"[a-zA-Z0-9]", key):
        return False
    if not re.search(r"[a-zA-Z0-9]", value):
        return False
    return True


def extract_pairs_from_text(text: str, limit: int) -> List[Dict[str, str]]:
    pairs: List[Dict[str, str]] = []
    for raw_line in str(text or "").splitlines():
        key, value = parse_line_pair(raw_line)
        if pair_is_valid(key, value):
            pairs.append({"key": key, "value": value})
            if len(pairs) >= limit:
                break
    return pairs


def extract_pairs_from_table(table: Sequence[Sequence[str]], limit: int) -> List[Dict[str, str]]:
    pairs: List[Dict[str, str]] = []
    for row in table or []:
        cells = [normalize(cell or "") for cell in row or []]
        cells = [cell for cell in cells if cell]
        if len(cells) < 2:
            continue

        key = cells[0]
        value = " | ".join(cells[1:])
        if pair_is_valid(key, value):
            pairs.append({"key": key, "value": value})
            if len(pairs) >= limit:
                break
    return pairs


def dedupe_pairs(pairs: List[Dict[str, str]], limit: int) -> List[Dict[str, str]]:
    seen = set()
    out: List[Dict[str, str]] = []

    for pair in pairs:
        key = normalize(pair.get("key", ""))
        value = normalize(pair.get("value", ""))
        signature = (key.lower(), value.lower())
        if signature in seen:
            continue
        seen.add(signature)
        out.append({"key": key, "value": value})
        if len(out) >= limit:
            break

    return out


def write_json(path: str, payload: Dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract structured key/value candidates from PDF text and tables."
    )
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-pages", type=int, default=60)
    parser.add_argument("--max-text-preview-chars", type=int, default=20000)
    parser.add_argument("--max-pairs", type=int, default=5000)
    args = parser.parse_args()

    max_pages = max(1, int(args.max_pages))
    max_text_preview_chars = max(1000, int(args.max_text_preview_chars))
    max_pairs = max(100, int(args.max_pairs))

    try:
        import pdfplumber  # type: ignore
    except Exception as exc:
        payload = {
            "ok": False,
            "error": f"pdfplumber_not_available: {exc}",
            "pairs": [],
            "text_preview": "",
            "pages": [],
        }
        write_json(args.out, payload)
        print(json.dumps({"ok": False, "pairs": 0}))
        return 0

    pages: List[Dict] = []
    all_pairs: List[Dict[str, str]] = []
    text_preview_chunks: List[str] = []
    table_count = 0
    lines_scanned = 0

    try:
        with pdfplumber.open(args.pdf) as pdf:
            for page in pdf.pages[:max_pages]:
                raw_page_text = str(page.extract_text() or "")
                normalized_lines = [
                    normalize(line) for line in raw_page_text.splitlines()
                ]
                normalized_lines = [line for line in normalized_lines if line]
                page_text = "\n".join(normalized_lines)
                lines_scanned += len(normalized_lines)
                pages.append(
                    {
                        "page_number": page.page_number,
                        "text": page_text[:3000],
                    }
                )

                if page_text:
                    text_pairs = extract_pairs_from_text(page_text, max_pairs)
                    all_pairs.extend(text_pairs)
                    text_preview_chunks.append(page_text)

                try:
                    tables = page.extract_tables() or []
                except Exception:
                    tables = []

                table_count += len(tables)
                for table in tables:
                    table_pairs = extract_pairs_from_table(table, max_pairs)
                    all_pairs.extend(table_pairs)
                    if len(all_pairs) >= max_pairs * 2:
                        break
                if len(all_pairs) >= max_pairs * 2:
                    break

        deduped_pairs = dedupe_pairs(all_pairs, max_pairs)
        text_preview = "\n".join(text_preview_chunks)[:max_text_preview_chars]

        payload = {
            "ok": True,
            "pairs": deduped_pairs,
            "text_preview": text_preview,
            "pages": pages,
            "meta": {
                "pages_scanned": len(pages),
                "lines_scanned": lines_scanned,
                "tables_found": table_count,
                "pairs_before_dedupe": len(all_pairs),
                "pairs_after_dedupe": len(deduped_pairs),
            },
        }
    except Exception as exc:
        payload = {
            "ok": False,
            "error": str(exc),
            "pairs": [],
            "text_preview": "",
            "pages": pages,
        }

    write_json(args.out, payload)
    print(
        json.dumps(
            {
                "ok": bool(payload.get("ok")),
                "pairs": len(payload.get("pairs", [])),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
