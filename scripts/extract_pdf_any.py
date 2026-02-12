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


def extract_with_pdfplumber(pdf_path: str, max_pages: int, max_pairs: int, max_text_preview_chars: int) -> Dict:
    import pdfplumber  # type: ignore

    pages: List[Dict] = []
    all_pairs: List[Dict[str, str]] = []
    text_preview_chunks: List[str] = []
    table_count = 0
    lines_scanned = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:max_pages]:
            raw_page_text = str(page.extract_text() or "")
            normalized_lines = [normalize(line) for line in raw_page_text.splitlines()]
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
    return {
        "ok": True,
        "backend_used": "pdfplumber",
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


def extract_with_docling(pdf_path: str, max_pairs: int, max_text_preview_chars: int) -> Dict:
    from docling.document_converter import DocumentConverter  # type: ignore

    converter = DocumentConverter()
    converted = converter.convert(pdf_path)
    document = getattr(converted, "document", converted)

    text_preview = ""
    if hasattr(document, "export_to_text"):
        text_preview = str(document.export_to_text() or "")
    else:
        text_preview = str(document or "")

    pairs = extract_pairs_from_text(text_preview, max_pairs)
    deduped_pairs = dedupe_pairs(pairs, max_pairs)
    return {
        "ok": True,
        "backend_used": "docling",
        "pairs": deduped_pairs,
        "text_preview": text_preview[:max_text_preview_chars],
        "pages": [],
        "meta": {
            "pages_scanned": 0,
            "lines_scanned": len(text_preview.splitlines()),
            "tables_found": 0,
            "pairs_before_dedupe": len(pairs),
            "pairs_after_dedupe": len(deduped_pairs),
        },
    }


def parse_backend(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in {"auto", "docling", "pdfplumber"}:
        return token
    return "auto"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract structured key/value candidates from PDF text using docling/pdfplumber."
    )
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--backend", default="auto", help="auto|docling|pdfplumber")
    parser.add_argument("--max-pages", type=int, default=60)
    parser.add_argument("--max-text-preview-chars", type=int, default=20000)
    parser.add_argument("--max-pairs", type=int, default=5000)
    args = parser.parse_args()

    backend = parse_backend(args.backend)
    max_pages = max(1, int(args.max_pages))
    max_text_preview_chars = max(1000, int(args.max_text_preview_chars))
    max_pairs = max(100, int(args.max_pairs))

    attempted = []
    payload = None

    if backend in {"auto", "docling"}:
        attempted.append("docling")
        try:
            payload = extract_with_docling(args.pdf, max_pairs, max_text_preview_chars)
        except Exception as exc:
            if backend == "docling":
                payload = {
                    "ok": False,
                    "backend_used": "docling",
                    "error": f"docling_failed: {exc}",
                    "pairs": [],
                    "text_preview": "",
                    "pages": [],
                }
            else:
                payload = None

    if payload is None and backend in {"auto", "pdfplumber"}:
        attempted.append("pdfplumber")
        try:
            payload = extract_with_pdfplumber(args.pdf, max_pages, max_pairs, max_text_preview_chars)
        except Exception as exc:
            payload = {
                "ok": False,
                "backend_used": "pdfplumber",
                "error": f"pdfplumber_failed: {exc}",
                "pairs": [],
                "text_preview": "",
                "pages": [],
            }

    if payload is None:
        payload = {
            "ok": False,
            "backend_used": "none",
            "error": "no_backend_available",
            "pairs": [],
            "text_preview": "",
            "pages": [],
        }

    payload["backend_requested"] = backend
    payload["backend_attempted"] = attempted
    write_json(args.out, payload)
    print(
        json.dumps(
            {
                "ok": bool(payload.get("ok")),
                "pairs": len(payload.get("pairs", [])),
                "backend_used": payload.get("backend_used"),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
