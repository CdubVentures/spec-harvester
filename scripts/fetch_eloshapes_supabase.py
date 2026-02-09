#!/usr/bin/env python3
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


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
    return urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment)
    )


def parse_content_range(value: str) -> Optional[int]:
    token = str(value or "").strip()
    if "/" not in token:
        return None
    total = token.split("/")[-1]
    if total in ("*", ""):
        return None
    try:
        parsed = int(total)
    except Exception:
        return None
    return parsed if parsed >= 0 else None


def decode_rows(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            return [row for row in payload.get("data") if isinstance(row, dict)]
        return [payload]
    return []


def fetch_page_once(
    url: str,
    anon_key: str,
    start: int,
    end: int,
    timeout_seconds: int
) -> Tuple[List[Dict[str, Any]], str, int]:
    req = urllib.request.Request(url)
    req.add_header("apikey", anon_key)
    req.add_header("Authorization", f"Bearer {anon_key}")
    req.add_header("Range", f"{start}-{end}")
    req.add_header("Prefer", "count=exact")
    req.add_header("Accept", "application/json")

    with urllib.request.urlopen(req, timeout=timeout_seconds) as res:
        body = res.read().decode("utf-8", errors="replace")
        status = int(getattr(res, "status", 200))
        content_range = str(res.headers.get("Content-Range", ""))
        payload = json.loads(body)
        rows = decode_rows(payload)
        return rows, content_range, status


def fetch_page_with_retry(
    url: str,
    anon_key: str,
    start: int,
    end: int,
    timeout_seconds: int,
    max_retries: int,
    retry_base_ms: int,
    verbose: bool
) -> Tuple[List[Dict[str, Any]], str, int]:
    delay = max(0.05, retry_base_ms / 1000.0)
    attempt = 0

    while True:
        try:
            return fetch_page_once(url, anon_key, start, end, timeout_seconds)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
            if attempt >= max_retries:
                raise exc
            attempt += 1
            sleep_for = delay * (2 ** (attempt - 1))
            if verbose:
                sys.stderr.write(
                    f"[fetch_eloshapes_supabase] retry attempt={attempt} "
                    f"range={start}-{end} sleep_s={sleep_for:.2f}\n"
                )
            time.sleep(sleep_for)


def row_matches(row: Dict[str, Any], required_tokens: List[str]) -> bool:
    if not required_tokens:
        return True
    haystack = normalize_token(json.dumps(row, ensure_ascii=True))
    return all(token in haystack for token in required_tokens)


def write_json(path: str, payload: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def sanitize_error_message(message: str, anon_key: str) -> str:
    if not anon_key:
        return message
    return str(message or "").replace(anon_key, "[redacted]")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch EloShapes Supabase PostgREST rows with Range pagination and filtering."
    )
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--anon-key", required=True)
    parser.add_argument("--brand", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--variant", default="")
    parser.add_argument("--page-size", type=int, default=1000)
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--max-rows", type=int, default=50000)
    parser.add_argument("--request-delay-ms", type=int, default=120)
    parser.add_argument("--timeout-seconds", type=int, default=30)
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--retry-base-ms", type=int, default=250)
    parser.add_argument("--out", required=True)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    started_at = time.time()
    url = make_url(args.endpoint)
    page_size = max(1, int(args.page_size))
    max_pages = max(1, int(args.max_pages))
    max_rows = max(1, int(args.max_rows))
    request_delay_s = max(0.0, float(args.request_delay_ms) / 1000.0)
    timeout_seconds = max(1, int(args.timeout_seconds))
    max_retries = max(0, int(args.max_retries))
    retry_base_ms = max(10, int(args.retry_base_ms))

    required_tokens = [
        token
        for token in [
            normalize_token(args.brand),
            normalize_token(args.model),
            normalize_token(args.variant),
        ]
        if token
    ]

    rows: List[Dict[str, Any]] = []
    page_trace: List[Dict[str, Any]] = []
    total_count_reported: Optional[int] = None

    try:
        for page_index in range(max_pages):
            start = page_index * page_size
            end = start + page_size - 1

            page_rows, content_range, status = fetch_page_with_retry(
                url=url,
                anon_key=args.anon_key,
                start=start,
                end=end,
                timeout_seconds=timeout_seconds,
                max_retries=max_retries,
                retry_base_ms=retry_base_ms,
                verbose=args.verbose,
            )

            page_trace.append(
                {
                    "page_index": page_index,
                    "range_start": start,
                    "range_end": end,
                    "status": status,
                    "rows": len(page_rows),
                    "content_range": content_range,
                }
            )

            maybe_total = parse_content_range(content_range)
            if maybe_total is not None:
                total_count_reported = maybe_total

            if not page_rows:
                break

            rows.extend(page_rows)

            if len(rows) >= max_rows:
                rows = rows[:max_rows]
                break

            if len(page_rows) < page_size:
                break

            if total_count_reported is not None and len(rows) >= total_count_reported:
                break

            if request_delay_s > 0:
                time.sleep(request_delay_s)

    except Exception as exc:
        payload = {
            "ok": False,
            "endpoint": args.endpoint,
            "error": sanitize_error_message(str(exc), args.anon_key),
            "fetched_pages": len(page_trace),
            "total_rows": len(rows),
            "matched_rows": 0,
            "rows": [],
            "page_trace": page_trace,
            "elapsed_ms": int((time.time() - started_at) * 1000),
        }
        write_json(args.out, payload)
        print(
            json.dumps(
                {
                    "ok": False,
                    "fetched_pages": payload["fetched_pages"],
                    "total_rows": payload["total_rows"],
                }
            )
        )
        return 1

    matched = [row for row in rows if row_matches(row, required_tokens)]
    payload = {
        "ok": True,
        "endpoint": args.endpoint,
        "fetched_pages": len(page_trace),
        "total_rows": len(rows),
        "matched_rows": len(matched),
        "total_count_reported": total_count_reported,
        "page_size": page_size,
        "max_pages": max_pages,
        "max_rows": max_rows,
        "request_delay_ms": int(args.request_delay_ms),
        "rows": matched,
        "page_trace": page_trace,
        "elapsed_ms": int((time.time() - started_at) * 1000),
    }
    write_json(args.out, payload)

    print(
        json.dumps(
            {
                "ok": True,
                "matched_rows": len(matched),
                "fetched_pages": len(page_trace),
                "elapsed_ms": payload["elapsed_ms"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
