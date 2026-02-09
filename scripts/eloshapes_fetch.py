#!/usr/bin/env python3
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request


def normalize_token(value: str) -> str:
    value = value or ""
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return value.strip()


def make_url(endpoint: str) -> str:
    parsed = urllib.parse.urlparse(endpoint)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    if "select" not in query:
        query["select"] = ["*"]
    new_query = urllib.parse.urlencode(query, doseq=True)
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))


def fetch_page(url: str, anon_key: str, start: int, end: int):
    req = urllib.request.Request(url)
    req.add_header("apikey", anon_key)
    req.add_header("Authorization", f"Bearer {anon_key}")
    req.add_header("Range", f"{start}-{end}")
    req.add_header("Prefer", "count=exact")
    req.add_header("Accept", "application/json")

    with urllib.request.urlopen(req, timeout=30) as res:
        body = res.read().decode("utf-8", errors="replace")
        content_range = res.headers.get("Content-Range", "")
        data = json.loads(body)
        return data, content_range


def row_matches(row, brand_token: str, model_token: str, variant_token: str) -> bool:
    haystack = normalize_token(json.dumps(row, ensure_ascii=True))
    if brand_token and brand_token not in haystack:
        return False
    if model_token and model_token not in haystack:
        return False
    if variant_token and variant_token not in haystack:
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="EloShapes Supabase PostgREST fetcher")
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--anon-key", required=True)
    parser.add_argument("--brand", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--variant", default="")
    parser.add_argument("--page-size", type=int, default=1000)
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    url = make_url(args.endpoint)
    page_size = max(1, args.page_size)
    max_pages = max(1, args.max_pages)

    rows = []
    total_count = None
    fetched_pages = 0

    for page_index in range(max_pages):
        start = page_index * page_size
        end = start + page_size - 1
        try:
            page_rows, content_range = fetch_page(url, args.anon_key, start, end)
        except Exception as exc:
            result = {
                "ok": False,
                "error": str(exc),
                "endpoint": args.endpoint,
                "fetched_pages": fetched_pages,
                "rows": rows,
            }
            with open(args.out, "w", encoding="utf-8") as fh:
                json.dump(result, fh, indent=2)
            print(json.dumps(result))
            return 1

        fetched_pages += 1

        if content_range and "/" in content_range:
            try:
                total_count = int(content_range.split("/")[-1])
            except Exception:
                total_count = None

        if not page_rows:
            break

        rows.extend(page_rows)

        if len(page_rows) < page_size:
            break

        if total_count is not None and len(rows) >= total_count:
            break

        time.sleep(0.1)

    brand_token = normalize_token(args.brand)
    model_token = normalize_token(args.model)
    variant_token = normalize_token(args.variant)

    filtered = [row for row in rows if row_matches(row, brand_token, model_token, variant_token)]

    result = {
        "ok": True,
        "endpoint": args.endpoint,
        "fetched_pages": fetched_pages,
        "total_rows": len(rows),
        "matched_rows": len(filtered),
        "rows": filtered,
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)

    print(json.dumps({
        "ok": True,
        "matched_rows": len(filtered),
        "fetched_pages": fetched_pages
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
