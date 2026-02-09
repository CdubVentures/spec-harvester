#!/usr/bin/env python3
import argparse
import json
import re


def normalize(text: str) -> str:
    text = text or ""
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_pairs_from_text(text: str):
    pairs = []
    for raw_line in text.splitlines():
        line = normalize(raw_line)
        if not line:
            continue
        if ":" in line:
            left, right = line.split(":", 1)
        elif " - " in line:
            left, right = line.split(" - ", 1)
        else:
            continue

        key = normalize(left)
        value = normalize(right)
        if key and value:
            pairs.append({"key": key, "value": value})

    return pairs


def main():
    parser = argparse.ArgumentParser(description="Extract approximate key/value pairs from PDF text/tables.")
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    pages = []
    full_text = []
    pairs = []

    try:
        import pdfplumber  # type: ignore
    except Exception as exc:
        payload = {
            "ok": False,
            "error": f"pdfplumber_not_available: {exc}",
            "pairs": []
        }
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
        print(json.dumps(payload))
        return 0

    try:
        with pdfplumber.open(args.pdf) as pdf:
            for page in pdf.pages[:40]:
                text = normalize(page.extract_text() or "")
                pages.append({
                    "page_number": page.page_number,
                    "text": text[:3000]
                })
                if text:
                    full_text.append(text)
                    pairs.extend(extract_pairs_from_text(text))

                try:
                    tables = page.extract_tables() or []
                except Exception:
                    tables = []

                for table in tables:
                    for row in table or []:
                        cells = [normalize(cell or "") for cell in (row or [])]
                        if len(cells) < 2:
                            continue
                        key = cells[0]
                        value = cells[1]
                        if key and value:
                            pairs.append({"key": key, "value": value})

        payload = {
            "ok": True,
            "pairs": pairs,
            "text_preview": "\n".join(full_text)[:12000],
            "pages": pages
        }
    except Exception as exc:
        payload = {
            "ok": False,
            "error": str(exc),
            "pairs": []
        }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)

    print(json.dumps({
        "ok": payload.get("ok", False),
        "pairs": len(payload.get("pairs", []))
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
