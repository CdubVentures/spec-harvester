#!/usr/bin/env python3
import argparse
import json
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple


def normalize(value: str) -> str:
    text = value or ""
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_backend(value: str) -> str:
    token = normalize(str(value or "")).lower()
    if token in {"auto", "pdfplumber", "pymupdf", "camelot", "tabula", "legacy"}:
        return token
    return "auto"


def normalize_ocr_backend(value: str) -> str:
    token = normalize(str(value or "")).lower()
    if token in {"auto", "none", "tesseract", "paddleocr"}:
        return token
    return "auto"


def parse_bool_token(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    token = normalize(str(value)).lower()
    if token in {"1", "true", "yes", "on"}:
        return True
    if token in {"0", "false", "no", "off"}:
        return False
    return default


def module_available(module_name: str) -> bool:
    try:
        __import__(module_name)
        return True
    except Exception:
        return False


def detect_available_backends() -> Dict[str, bool]:
    return {
        "pdfplumber": module_available("pdfplumber"),
        "pymupdf": module_available("fitz"),
        "camelot": module_available("camelot"),
        "tabula": module_available("tabula")
    }


def infer_unit_hint(key: str, value: str) -> str:
    token = f"{key} {value}".lower()
    if re.search(r"\b(?:dpi|cpi)\b", token):
        return "dpi"
    if re.search(r"\b(?:hz|khz)\b", token):
        return "hz"
    if re.search(r"\b(?:mm|cm|inch|inches|in)\b|\"", token):
        return "mm"
    if re.search(r"\b(?:g|gram|grams|kg|lb|lbs|pound|pounds|oz)\b", token):
        return "g"
    if re.search(r"\bmah\b", token):
        return "mah"
    if re.search(r"\b(?:hour|hours|hr|hrs|min|mins|minute|minutes)\b", token):
        return "h"
    return ""


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
    if len(key) < 2 or len(key) > 160:
        return False
    if len(value) > 1200:
        return False
    if not re.search(r"[a-zA-Z0-9]", key):
        return False
    if not re.search(r"[a-zA-Z0-9]", value):
        return False
    return True


def build_pair_record(
    *,
    key: str,
    value: str,
    page_number: int,
    surface: str,
    backend: str,
    row_index: int,
    table_id: str = "",
    section_header: str = "",
    column_header: str = "",
    bbox: Optional[Dict[str, float]] = None,
    ocr_confidence: Optional[float] = None,
    ocr_low_confidence: bool = False,
) -> Dict[str, Any]:
    normalized_key = normalize(key)
    normalized_value = normalize(value)
    requested_surface = normalize(surface).lower()
    if requested_surface in {"pdf_table", "scanned_pdf_ocr_table"}:
        surface_token = requested_surface
    elif requested_surface in {"pdf_kv", "scanned_pdf_ocr_kv"}:
        surface_token = requested_surface
    else:
        surface_token = "pdf_kv"
    page = max(1, int(page_number or 1))
    row = max(1, int(row_index or 1))
    table_token = normalize(table_id)

    if surface_token == "pdf_table":
        path = f"pdf.page[{page}].table[{table_token or f't{page}'}].row[{row}]"
    elif surface_token == "scanned_pdf_ocr_table":
        path = f"scanned_pdf.page[{page}].table[{table_token or f't{page}'}].row[{row}]"
    elif surface_token == "scanned_pdf_ocr_kv":
        path = f"scanned_pdf.page[{page}].kv[{row}]"
    else:
        path = f"pdf.page[{page}].kv[{row}]"

    if surface_token == "pdf_table":
        row_id = f"pdf_{page:02d}.tr_{row:04d}"
    elif surface_token == "scanned_pdf_ocr_table":
        row_id = f"sc_pdf_{page:02d}.ocr_tr_{row:04d}"
    elif surface_token == "scanned_pdf_ocr_kv":
        row_id = f"sc_pdf_{page:02d}.ocr_kv_{row:04d}"
    else:
        row_id = f"pdf_{page:02d}.kv_{row:04d}"

    return {
        "key": normalized_key,
        "value": normalized_value,
        "raw_key": key,
        "raw_value": value,
        "normalized_key": normalized_key,
        "normalized_value": normalized_value,
        "table_id": table_token or None,
        "row_id": row_id,
        "section_header": normalize(section_header) or None,
        "column_header": normalize(column_header) or None,
        "unit_hint": infer_unit_hint(normalized_key, normalized_value) or None,
        "surface": surface_token,
        "path": path,
        "page": page,
        "bbox": bbox if bbox and isinstance(bbox, dict) else None,
        "backend": normalize_backend(backend) if normalize_backend(backend) != "auto" else normalize(str(backend or "")).lower(),
        "ocr_confidence": float(ocr_confidence) if ocr_confidence is not None else None,
        "ocr_low_confidence": bool(ocr_low_confidence),
    }


def extract_pairs_from_text(
    *,
    text: str,
    limit: int,
    page_number: int,
    backend: str,
    start_index: int = 0,
    surface: str = "pdf_kv",
    ocr_confidence: Optional[float] = None,
    ocr_low_confidence: bool = False,
) -> Tuple[List[Dict[str, Any]], int]:
    pairs: List[Dict[str, Any]] = []
    row_index = max(0, int(start_index or 0))
    for raw_line in str(text or "").splitlines():
        key, value = parse_line_pair(raw_line)
        if pair_is_valid(key, value):
            row_index += 1
            pairs.append(
                build_pair_record(
                    key=key,
                    value=value,
                    page_number=page_number,
                    surface=surface,
                    backend=backend,
                    row_index=row_index,
                    ocr_confidence=ocr_confidence,
                    ocr_low_confidence=ocr_low_confidence,
                )
            )
            if len(pairs) >= limit:
                break
    return pairs, row_index


def extract_pairs_from_table(
    *,
    table: Sequence[Sequence[str]],
    limit: int,
    page_number: int,
    backend: str,
    table_id: str,
    start_index: int = 0,
    surface: str = "pdf_table",
    ocr_confidence: Optional[float] = None,
    ocr_low_confidence: bool = False,
) -> Tuple[List[Dict[str, Any]], int]:
    pairs: List[Dict[str, Any]] = []
    row_index = max(0, int(start_index or 0))
    for row in table or []:
        cells = [normalize(cell or "") for cell in row or []]
        cells = [cell for cell in cells if cell]
        if len(cells) < 2:
            continue

        key = cells[0]
        value = " | ".join(cells[1:])
        if pair_is_valid(key, value):
            row_index += 1
            pairs.append(
                build_pair_record(
                    key=key,
                    value=value,
                    page_number=page_number,
                    surface=surface,
                    backend=backend,
                    row_index=row_index,
                    table_id=table_id,
                    ocr_confidence=ocr_confidence,
                    ocr_low_confidence=ocr_low_confidence,
                )
            )
            if len(pairs) >= limit:
                break
    return pairs, row_index


def dedupe_pairs(pairs: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []

    for pair in pairs:
        key = normalize(str(pair.get("normalized_key") or pair.get("key") or ""))
        value = normalize(str(pair.get("normalized_value") or pair.get("value") or ""))
        signature = (key.lower(), value.lower())
        if not key or not value:
            continue
        if signature in seen:
            continue
        seen.add(signature)
        out.append(pair)
        if len(out) >= limit:
            break

    return out


def split_pairs_by_surface(pairs: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    table_pairs = []
    kv_pairs = []
    for pair in pairs:
        surface = normalize(str(pair.get("surface") or "")).lower()
        if surface in {"pdf_table", "scanned_pdf_ocr_table"}:
            table_pairs.append(pair)
        else:
            kv_pairs.append(pair)
    return kv_pairs, table_pairs


def fingerprint_with_pdfplumber(pdf_path: str, max_pages: int) -> Dict[str, Any]:
    import pdfplumber  # type: ignore

    pages_scanned = 0
    tables_found = 0
    lines_scanned = 0
    text_chars = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:max_pages]:
            pages_scanned += 1
            page_text = str(page.extract_text() or "")
            normalized_lines = [normalize(line) for line in page_text.splitlines()]
            normalized_lines = [line for line in normalized_lines if line]
            lines_scanned += len(normalized_lines)
            text_chars += len("\n".join(normalized_lines))
            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []
            tables_found += len(tables)

    table_density = (tables_found / pages_scanned) if pages_scanned > 0 else 0.0
    return {
        "pages_scanned": pages_scanned,
        "tables_found": tables_found,
        "lines_scanned": lines_scanned,
        "text_chars": text_chars,
        "table_density": round(table_density, 6),
        "avg_chars_per_page": round((text_chars / pages_scanned), 2) if pages_scanned > 0 else 0.0,
    }


def fingerprint_with_pymupdf(pdf_path: str, max_pages: int) -> Dict[str, Any]:
    import fitz  # type: ignore

    pages_scanned = 0
    lines_scanned = 0
    text_chars = 0

    doc = fitz.open(pdf_path)
    try:
        for idx in range(min(max_pages, len(doc))):
            pages_scanned += 1
            page = doc[idx]
            page_text = str(page.get_text("text") or "")
            normalized_lines = [normalize(line) for line in page_text.splitlines()]
            normalized_lines = [line for line in normalized_lines if line]
            lines_scanned += len(normalized_lines)
            text_chars += len("\n".join(normalized_lines))
    finally:
        doc.close()

    return {
        "pages_scanned": pages_scanned,
        "tables_found": 0,
        "lines_scanned": lines_scanned,
        "text_chars": text_chars,
        "table_density": 0.0,
        "avg_chars_per_page": round((text_chars / pages_scanned), 2) if pages_scanned > 0 else 0.0,
    }


def choose_backend(
    requested_backend: str,
    available: Dict[str, bool],
    fingerprint: Dict[str, Any],
) -> Dict[str, Any]:
    requested = normalize_backend(requested_backend)
    pages_scanned = int(fingerprint.get("pages_scanned") or 0)
    tables_found = int(fingerprint.get("tables_found") or 0)
    table_density = float(fingerprint.get("table_density") or 0.0)

    ranked = []
    if table_density >= 0.35:
        ranked.append("camelot")
    ranked.extend(["pdfplumber", "pymupdf", "tabula"])
    deduped_ranked = []
    seen = set()
    for token in ranked:
        if token in seen:
            continue
        seen.add(token)
        deduped_ranked.append(token)

    def first_available() -> str:
        for token in deduped_ranked:
            if bool(available.get(token)):
                return token
        return "legacy"

    if requested != "auto":
        if requested == "legacy":
            return {
                "requested": requested,
                "selected": "legacy",
                "fallback_used": False,
                "reason": "requested_legacy",
                "table_density": round(table_density, 6),
                "pages_scanned": pages_scanned,
                "tables_found": tables_found,
            }
        if bool(available.get(requested)):
            return {
                "requested": requested,
                "selected": requested,
                "fallback_used": False,
                "reason": f"requested_{requested}",
                "table_density": round(table_density, 6),
                "pages_scanned": pages_scanned,
                "tables_found": tables_found,
            }
        fallback = first_available()
        return {
            "requested": requested,
            "selected": fallback,
            "fallback_used": True,
            "reason": f"requested_unavailable_fallback_{fallback}",
            "table_density": round(table_density, 6),
            "pages_scanned": pages_scanned,
            "tables_found": tables_found,
        }

    selected = first_available()
    reason = "auto_no_backend_available"
    if selected == "camelot" and table_density >= 0.35:
        reason = "auto_table_dense"
    elif selected in {"pdfplumber", "pymupdf", "tabula"}:
        reason = f"auto_{selected}"

    return {
        "requested": requested,
        "selected": selected,
        "fallback_used": False,
        "reason": reason,
        "table_density": round(table_density, 6),
        "pages_scanned": pages_scanned,
        "tables_found": tables_found,
    }


def detect_available_ocr_backends() -> Dict[str, bool]:
    return {
        "tesseract": module_available("pytesseract") and module_available("PIL") and module_available("fitz"),
        "paddleocr": module_available("paddleocr") and module_available("fitz"),
    }


def choose_ocr_backend(requested_backend: str, available: Dict[str, bool]) -> Dict[str, Any]:
    requested = normalize_ocr_backend(requested_backend)
    ranked = ["tesseract", "paddleocr"]

    def first_available() -> str:
        for token in ranked:
            if bool(available.get(token)):
                return token
        return "none"

    if requested == "none":
        return {
            "requested": requested,
            "selected": "none",
            "fallback_used": False,
            "reason": "requested_none",
        }

    if requested in {"tesseract", "paddleocr"}:
        if bool(available.get(requested)):
            return {
                "requested": requested,
                "selected": requested,
                "fallback_used": False,
                "reason": f"requested_{requested}",
            }
        fallback = first_available()
        return {
            "requested": requested,
            "selected": fallback,
            "fallback_used": fallback != "none",
            "reason": (
                f"requested_unavailable_fallback_{fallback}"
                if fallback != "none"
                else "requested_unavailable_no_backend"
            ),
        }

    selected = first_available()
    return {
        "requested": requested,
        "selected": selected,
        "fallback_used": False,
        "reason": f"auto_{selected}" if selected != "none" else "auto_no_backend_available",
    }


def should_route_to_scanned_ocr(
    *,
    fingerprint: Dict[str, Any],
    pairs_after_dedupe: int,
    min_chars_per_page: int,
    min_lines_per_page: int,
) -> Dict[str, Any]:
    pages_scanned = max(1, int(fingerprint.get("pages_scanned") or 0))
    text_chars = max(0, int(fingerprint.get("text_chars") or 0))
    lines_scanned = max(0, int(fingerprint.get("lines_scanned") or 0))
    chars_per_page = float(text_chars) / float(pages_scanned)
    lines_per_page = float(lines_scanned) / float(pages_scanned)
    near_empty_text = chars_per_page <= float(max(0, min_chars_per_page)) or lines_per_page <= float(max(0, min_lines_per_page))
    low_pair_yield = int(pairs_after_dedupe or 0) <= max(6, pages_scanned * 2)
    scanned_pdf_detected = bool(near_empty_text and low_pair_yield)
    return {
        "scanned_pdf_detected": scanned_pdf_detected,
        "chars_per_page": round(chars_per_page, 4),
        "lines_per_page": round(lines_per_page, 4),
        "pairs_after_dedupe": int(pairs_after_dedupe or 0),
    }


def extract_with_tesseract_ocr(
    *,
    pdf_path: str,
    max_pages: int,
    max_pairs: int,
    max_text_preview_chars: int,
    min_confidence: float,
) -> Dict[str, Any]:
    import fitz  # type: ignore
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore

    pages: List[Dict[str, Any]] = []
    all_pairs: List[Dict[str, Any]] = []
    kv_pairs: List[Dict[str, Any]] = []
    table_pairs: List[Dict[str, Any]] = []
    text_preview_chunks: List[str] = []
    lines_scanned = 0
    kv_cursor = 0
    confidence_sum = 0.0
    confidence_samples = 0
    low_confidence_pairs = 0
    threshold = max(0.0, min(1.0, float(min_confidence)))

    doc = fitz.open(pdf_path)
    try:
        for idx in range(min(max_pages, len(doc))):
            page = doc[idx]
            page_number = idx + 1
            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            mode = "RGB" if int(getattr(pix, "n", 0) or 0) >= 3 else "L"
            image = Image.frombytes(mode, [pix.width, pix.height], pix.samples)

            raw_page_text = str(pytesseract.image_to_string(image) or "")
            normalized_lines = [normalize(line) for line in raw_page_text.splitlines()]
            normalized_lines = [line for line in normalized_lines if line]
            page_text = "\n".join(normalized_lines)
            lines_scanned += len(normalized_lines)
            pages.append(
                {
                    "page_number": page_number,
                    "text": page_text[:3000],
                    "char_count": len(page_text),
                }
            )
            if page_text:
                text_preview_chunks.append(page_text)

            page_confidence = None
            try:
                ocr_data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
                conf_rows = ocr_data.get("conf") if isinstance(ocr_data, dict) else []
                conf_values: List[float] = []
                for raw in conf_rows or []:
                    token = normalize(str(raw or ""))
                    if not token or token == "-1":
                        continue
                    try:
                        conf = float(token)
                    except Exception:
                        continue
                    if conf < 0:
                        continue
                    normalized_conf = max(0.0, min(1.0, conf / 100.0))
                    conf_values.append(normalized_conf)
                if conf_values:
                    page_confidence = float(sum(conf_values) / len(conf_values))
                    confidence_sum += float(sum(conf_values))
                    confidence_samples += len(conf_values)
            except Exception:
                page_confidence = None

            row_low_confidence = bool(page_confidence is not None and page_confidence < threshold)
            if page_text:
                text_rows, kv_cursor = extract_pairs_from_text(
                    text=page_text,
                    limit=max_pairs,
                    page_number=page_number,
                    backend="tesseract",
                    start_index=kv_cursor,
                    surface="scanned_pdf_ocr_kv",
                    ocr_confidence=page_confidence,
                    ocr_low_confidence=row_low_confidence,
                )
                kv_pairs.extend(text_rows)
                all_pairs.extend(text_rows)
                if row_low_confidence:
                    low_confidence_pairs += len(text_rows)
            if len(all_pairs) >= max_pairs * 3:
                break
    finally:
        doc.close()

    text_preview = "\n".join(text_preview_chunks)[:max_text_preview_chars]
    confidence_avg = (confidence_sum / confidence_samples) if confidence_samples > 0 else 0.0
    return {
        "pairs": all_pairs,
        "kv_pairs": kv_pairs,
        "table_pairs": table_pairs,
        "text_preview": text_preview,
        "pages": pages,
        "meta": {
            "pages_scanned": len(pages),
            "lines_scanned": lines_scanned,
            "tables_found": 0,
            "pairs_before_dedupe": len(all_pairs),
            "kv_pairs_before_dedupe": len(kv_pairs),
            "table_pairs_before_dedupe": 0,
            "backend": "tesseract",
            "ocr_confidence_avg": round(float(confidence_avg), 6),
            "ocr_confidence_samples": int(confidence_samples),
            "ocr_low_confidence_pairs": int(low_confidence_pairs),
        },
    }


def extract_with_pdfplumber(
    *,
    pdf_path: str,
    max_pages: int,
    max_pairs: int,
    max_text_preview_chars: int,
) -> Dict[str, Any]:
    import pdfplumber  # type: ignore

    pages: List[Dict[str, Any]] = []
    all_pairs: List[Dict[str, Any]] = []
    kv_pairs: List[Dict[str, Any]] = []
    table_pairs: List[Dict[str, Any]] = []
    text_preview_chunks: List[str] = []
    table_count = 0
    lines_scanned = 0
    kv_cursor = 0
    table_cursor = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:max_pages]:
            raw_page_text = str(page.extract_text() or "")
            normalized_lines = [normalize(line) for line in raw_page_text.splitlines()]
            normalized_lines = [line for line in normalized_lines if line]
            page_text = "\n".join(normalized_lines)
            lines_scanned += len(normalized_lines)
            page_number = int(page.page_number or 1)

            pages.append(
                {
                    "page_number": page_number,
                    "text": page_text[:3000],
                    "char_count": len(page_text),
                }
            )

            if page_text:
                text_rows, kv_cursor = extract_pairs_from_text(
                    text=page_text,
                    limit=max_pairs,
                    page_number=page_number,
                    backend="pdfplumber",
                    start_index=kv_cursor,
                )
                kv_pairs.extend(text_rows)
                all_pairs.extend(text_rows)
                text_preview_chunks.append(page_text)

            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []

            table_count += len(tables)
            for table_index, table in enumerate(tables):
                table_rows, table_cursor = extract_pairs_from_table(
                    table=table,
                    limit=max_pairs,
                    page_number=page_number,
                    backend="pdfplumber",
                    table_id=f"p{page_number}_t{table_index + 1}",
                    start_index=table_cursor,
                )
                table_pairs.extend(table_rows)
                all_pairs.extend(table_rows)
                if len(all_pairs) >= max_pairs * 3:
                    break
            if len(all_pairs) >= max_pairs * 3:
                break

    text_preview = "\n".join(text_preview_chunks)[:max_text_preview_chars]
    return {
        "pairs": all_pairs,
        "kv_pairs": kv_pairs,
        "table_pairs": table_pairs,
        "text_preview": text_preview,
        "pages": pages,
        "meta": {
            "pages_scanned": len(pages),
            "lines_scanned": lines_scanned,
            "tables_found": table_count,
            "pairs_before_dedupe": len(all_pairs),
            "kv_pairs_before_dedupe": len(kv_pairs),
            "table_pairs_before_dedupe": len(table_pairs),
            "backend": "pdfplumber",
        }
    }


def extract_with_pymupdf(
    *,
    pdf_path: str,
    max_pages: int,
    max_pairs: int,
    max_text_preview_chars: int,
) -> Dict[str, Any]:
    import fitz  # type: ignore

    pages: List[Dict[str, Any]] = []
    all_pairs: List[Dict[str, Any]] = []
    kv_pairs: List[Dict[str, Any]] = []
    text_preview_chunks: List[str] = []
    lines_scanned = 0
    kv_cursor = 0

    doc = fitz.open(pdf_path)
    try:
        for idx in range(min(max_pages, len(doc))):
            page = doc[idx]
            page_number = idx + 1
            raw_page_text = str(page.get_text("text") or "")
            normalized_lines = [normalize(line) for line in raw_page_text.splitlines()]
            normalized_lines = [line for line in normalized_lines if line]
            page_text = "\n".join(normalized_lines)
            lines_scanned += len(normalized_lines)
            pages.append(
                {
                    "page_number": page_number,
                    "text": page_text[:3000],
                    "char_count": len(page_text),
                }
            )
            if not page_text:
                continue
            text_rows, kv_cursor = extract_pairs_from_text(
                text=page_text,
                limit=max_pairs,
                page_number=page_number,
                backend="pymupdf",
                start_index=kv_cursor,
            )
            kv_pairs.extend(text_rows)
            all_pairs.extend(text_rows)
            text_preview_chunks.append(page_text)
            if len(all_pairs) >= max_pairs * 3:
                break
    finally:
        doc.close()

    text_preview = "\n".join(text_preview_chunks)[:max_text_preview_chars]
    return {
        "pairs": all_pairs,
        "kv_pairs": kv_pairs,
        "table_pairs": [],
        "text_preview": text_preview,
        "pages": pages,
        "meta": {
            "pages_scanned": len(pages),
            "lines_scanned": lines_scanned,
            "tables_found": 0,
            "pairs_before_dedupe": len(all_pairs),
            "kv_pairs_before_dedupe": len(kv_pairs),
            "table_pairs_before_dedupe": 0,
            "backend": "pymupdf",
        }
    }


def extract_with_camelot(
    *,
    pdf_path: str,
    max_pages: int,
    max_pairs: int,
    max_text_preview_chars: int,
) -> Dict[str, Any]:
    import camelot  # type: ignore

    page_expr = f"1-{max_pages}"
    tables = camelot.read_pdf(pdf_path, pages=page_expr, flavor="lattice")

    pages: List[Dict[str, Any]] = []
    all_pairs: List[Dict[str, Any]] = []
    table_pairs: List[Dict[str, Any]] = []
    text_preview_chunks: List[str] = []
    table_cursor = 0
    pages_seen = set()

    for idx, table in enumerate(tables):
        df = getattr(table, "df", None)
        rows = []
        if df is not None:
            try:
                rows = df.values.tolist()
            except Exception:
                rows = []
        page_value = normalize(str(getattr(table, "page", "") or ""))
        page_number = int(page_value) if page_value.isdigit() else 1
        pages_seen.add(page_number)
        table_rows, table_cursor = extract_pairs_from_table(
            table=rows,
            limit=max_pairs,
            page_number=page_number,
            backend="camelot",
            table_id=f"p{page_number}_t{idx + 1}",
            start_index=table_cursor,
        )
        table_pairs.extend(table_rows)
        all_pairs.extend(table_rows)

        table_preview_lines: List[str] = []
        for row in rows[:20]:
            cells = [normalize(str(cell or "")) for cell in row]
            cells = [cell for cell in cells if cell]
            if cells:
                table_preview_lines.append(" | ".join(cells))
        if table_preview_lines:
            text_preview_chunks.append("\n".join(table_preview_lines))

        if len(all_pairs) >= max_pairs * 3:
            break

    for page_number in sorted(list(pages_seen))[:max_pages]:
        pages.append(
            {
                "page_number": int(page_number),
                "text": "",
                "char_count": 0,
            }
        )

    text_preview = "\n".join(text_preview_chunks)[:max_text_preview_chars]
    return {
        "pairs": all_pairs,
        "kv_pairs": [],
        "table_pairs": table_pairs,
        "text_preview": text_preview,
        "pages": pages,
        "meta": {
            "pages_scanned": len(pages),
            "lines_scanned": 0,
            "tables_found": len(tables),
            "pairs_before_dedupe": len(all_pairs),
            "kv_pairs_before_dedupe": 0,
            "table_pairs_before_dedupe": len(table_pairs),
            "backend": "camelot",
        }
    }


def build_attempt_order(selected_backend: str, available: Dict[str, bool]) -> List[str]:
    order = [selected_backend]
    for token in ["pdfplumber", "pymupdf", "camelot", "tabula"]:
        if token == selected_backend:
            continue
        if bool(available.get(token)):
            order.append(token)
    deduped = []
    seen = set()
    for token in order:
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return deduped


def write_json(path: str, payload: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract structured key/value candidates from PDF text and tables."
    )
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--backend", default="auto")
    parser.add_argument("--max-pages", type=int, default=60)
    parser.add_argument("--max-text-preview-chars", type=int, default=20000)
    parser.add_argument("--max-pairs", type=int, default=5000)
    parser.add_argument("--enable-scanned-ocr", default="0")
    parser.add_argument("--scanned-ocr-backend", default="auto")
    parser.add_argument("--scanned-ocr-max-pages", type=int, default=8)
    parser.add_argument("--scanned-ocr-max-pairs", type=int, default=1200)
    parser.add_argument("--scanned-ocr-min-chars-per-page", type=int, default=45)
    parser.add_argument("--scanned-ocr-min-lines-per-page", type=int, default=3)
    parser.add_argument("--scanned-ocr-min-confidence", type=float, default=0.55)
    args = parser.parse_args()

    max_pages = max(1, int(args.max_pages))
    max_text_preview_chars = max(1000, int(args.max_text_preview_chars))
    max_pairs = max(100, int(args.max_pairs))
    requested_backend = normalize_backend(args.backend)
    enable_scanned_ocr = parse_bool_token(args.enable_scanned_ocr, False)
    requested_scanned_ocr_backend = normalize_ocr_backend(args.scanned_ocr_backend)
    scanned_ocr_max_pages = max(1, int(args.scanned_ocr_max_pages))
    scanned_ocr_max_pairs = max(50, int(args.scanned_ocr_max_pairs))
    scanned_ocr_min_chars_per_page = max(0, int(args.scanned_ocr_min_chars_per_page))
    scanned_ocr_min_lines_per_page = max(0, int(args.scanned_ocr_min_lines_per_page))
    scanned_ocr_min_confidence = max(0.0, min(1.0, float(args.scanned_ocr_min_confidence)))

    available = detect_available_backends()
    available_ocr = detect_available_ocr_backends()

    fingerprint: Dict[str, Any] = {
        "pages_scanned": 0,
        "tables_found": 0,
        "lines_scanned": 0,
        "text_chars": 0,
        "table_density": 0.0,
        "avg_chars_per_page": 0.0,
    }

    fingerprint_errors: List[str] = []
    if available.get("pdfplumber"):
        try:
            fingerprint = fingerprint_with_pdfplumber(args.pdf, max_pages)
        except Exception as exc:
            fingerprint_errors.append(f"pdfplumber_fingerprint_failed:{exc}")
    elif available.get("pymupdf"):
        try:
            fingerprint = fingerprint_with_pymupdf(args.pdf, max_pages)
        except Exception as exc:
            fingerprint_errors.append(f"pymupdf_fingerprint_failed:{exc}")

    backend_choice = choose_backend(requested_backend, available, fingerprint)
    selected_backend = normalize_backend(str(backend_choice.get("selected") or "legacy"))
    attempts = build_attempt_order(selected_backend, available)

    extraction: Optional[Dict[str, Any]] = None
    extraction_error = ""
    used_backend = selected_backend

    for backend in attempts:
        try:
            if backend == "pdfplumber":
                extraction = extract_with_pdfplumber(
                    pdf_path=args.pdf,
                    max_pages=max_pages,
                    max_pairs=max_pairs,
                    max_text_preview_chars=max_text_preview_chars,
                )
            elif backend == "pymupdf":
                extraction = extract_with_pymupdf(
                    pdf_path=args.pdf,
                    max_pages=max_pages,
                    max_pairs=max_pairs,
                    max_text_preview_chars=max_text_preview_chars,
                )
            elif backend == "camelot":
                extraction = extract_with_camelot(
                    pdf_path=args.pdf,
                    max_pages=max_pages,
                    max_pairs=max_pairs,
                    max_text_preview_chars=max_text_preview_chars,
                )
            else:
                extraction = None
            if extraction is not None:
                used_backend = backend
                break
        except Exception as exc:
            extraction_error = str(exc)
            continue

    if extraction is None:
        payload = {
            "ok": False,
            "error": extraction_error or "no_pdf_backend_available",
            "backend": {
                "requested": requested_backend,
                "selected": "legacy",
                "fallback_used": True,
                "reason": "no_backend_available",
                "attempts": attempts,
                "available": available,
            },
            "pairs": [],
            "kv_pairs": [],
            "table_pairs": [],
            "ocr_pairs": [],
            "ocr_kv_pairs": [],
            "ocr_table_pairs": [],
            "ocr_text_preview": "",
            "text_preview": "",
            "pages": [],
            "meta": {
                "pages_scanned": 0,
                "lines_scanned": 0,
                "tables_found": 0,
                "pairs_before_dedupe": 0,
                "pairs_after_dedupe": 0,
                "kv_pairs_count": 0,
                "table_pairs_count": 0,
                "pdf_fingerprint": fingerprint,
                "scanned_pdf_detected": False,
                "scanned_pdf_ocr_enabled": bool(enable_scanned_ocr),
                "scanned_pdf_ocr_attempted": False,
                "scanned_pdf_ocr_backend_requested": requested_scanned_ocr_backend,
                "scanned_pdf_ocr_backend_selected": "none",
                "scanned_pdf_ocr_backend_fallback_used": False,
                "scanned_pdf_ocr_pair_count": 0,
                "scanned_pdf_ocr_kv_pair_count": 0,
                "scanned_pdf_ocr_table_pair_count": 0,
                "scanned_pdf_ocr_confidence_avg": 0.0,
                "scanned_pdf_ocr_low_confidence_pairs": 0,
                "scanned_pdf_ocr_error": "",
            },
            "errors": fingerprint_errors,
        }
        write_json(args.out, payload)
        print(json.dumps({"ok": False, "pairs": 0}))
        return 0

    raw_pairs = extraction.get("pairs") or []
    deduped_pairs = dedupe_pairs(raw_pairs, max_pairs)
    kv_pairs, table_pairs = split_pairs_by_surface(deduped_pairs)

    text_preview = normalize(str(extraction.get("text_preview") or ""))
    text_preview = text_preview[:max_text_preview_chars]

    extraction_meta = extraction.get("meta") if isinstance(extraction.get("meta"), dict) else {}
    pages = extraction.get("pages") if isinstance(extraction.get("pages"), list) else []
    scan_route = should_route_to_scanned_ocr(
        fingerprint=fingerprint,
        pairs_after_dedupe=len(deduped_pairs),
        min_chars_per_page=scanned_ocr_min_chars_per_page,
        min_lines_per_page=scanned_ocr_min_lines_per_page,
    )
    scanned_pdf_detected = bool(scan_route.get("scanned_pdf_detected"))
    ocr_choice = choose_ocr_backend(requested_scanned_ocr_backend, available_ocr)
    ocr_attempted = False
    ocr_backend_selected = str(ocr_choice.get("selected") or "none")
    ocr_backend_requested = str(ocr_choice.get("requested") or requested_scanned_ocr_backend)
    ocr_backend_fallback_used = bool(ocr_choice.get("fallback_used"))
    ocr_backend_reason = str(ocr_choice.get("reason") or "")
    ocr_error = ""
    ocr_pairs: List[Dict[str, Any]] = []
    ocr_kv_pairs: List[Dict[str, Any]] = []
    ocr_table_pairs: List[Dict[str, Any]] = []
    ocr_text_preview = ""
    ocr_confidence_avg = 0.0
    ocr_low_confidence_pairs = 0
    if bool(enable_scanned_ocr) and scanned_pdf_detected:
        ocr_attempted = True
        if ocr_backend_selected == "paddleocr":
            if bool(available_ocr.get("tesseract")):
                ocr_backend_selected = "tesseract"
                ocr_backend_fallback_used = True
                ocr_backend_reason = "paddleocr_not_implemented_fallback_tesseract"
            else:
                ocr_error = "paddleocr_not_implemented"
        if ocr_backend_selected == "none":
            ocr_error = ocr_error or "ocr_backend_unavailable"
        elif ocr_backend_selected == "tesseract":
            try:
                ocr_extraction = extract_with_tesseract_ocr(
                    pdf_path=args.pdf,
                    max_pages=scanned_ocr_max_pages,
                    max_pairs=scanned_ocr_max_pairs,
                    max_text_preview_chars=max_text_preview_chars,
                    min_confidence=scanned_ocr_min_confidence,
                )
                ocr_raw_pairs = ocr_extraction.get("pairs") if isinstance(ocr_extraction.get("pairs"), list) else []
                ocr_pairs = dedupe_pairs(ocr_raw_pairs, scanned_ocr_max_pairs)
                ocr_kv_pairs, ocr_table_pairs = split_pairs_by_surface(ocr_pairs)
                ocr_text_preview = normalize(str(ocr_extraction.get("text_preview") or ""))[:max_text_preview_chars]
                ocr_meta = ocr_extraction.get("meta") if isinstance(ocr_extraction.get("meta"), dict) else {}
                ocr_confidence_avg = float(ocr_meta.get("ocr_confidence_avg") or 0.0)
                ocr_low_confidence_pairs = int(ocr_meta.get("ocr_low_confidence_pairs") or 0)
            except Exception as exc:
                ocr_error = str(exc)
        else:
            ocr_error = ocr_error or f"unsupported_ocr_backend:{ocr_backend_selected}"

    payload = {
        "ok": True,
        "backend": {
            "requested": requested_backend,
            "selected": used_backend,
            "fallback_used": bool(backend_choice.get("fallback_used") or used_backend != selected_backend),
            "reason": str(backend_choice.get("reason") or ""),
            "attempts": attempts,
            "available": available,
        },
        "pairs": deduped_pairs,
        "kv_pairs": kv_pairs,
        "table_pairs": table_pairs,
        "ocr_pairs": ocr_pairs,
        "ocr_kv_pairs": ocr_kv_pairs,
        "ocr_table_pairs": ocr_table_pairs,
        "ocr_text_preview": ocr_text_preview,
        "text_preview": text_preview,
        "pages": pages,
        "meta": {
            "pages_scanned": int(extraction_meta.get("pages_scanned") or len(pages)),
            "lines_scanned": int(extraction_meta.get("lines_scanned") or 0),
            "tables_found": int(extraction_meta.get("tables_found") or 0),
            "pairs_before_dedupe": int(extraction_meta.get("pairs_before_dedupe") or len(raw_pairs)),
            "pairs_after_dedupe": len(deduped_pairs),
            "kv_pairs_count": len(kv_pairs),
            "table_pairs_count": len(table_pairs),
            "backend_requested": requested_backend,
            "backend_selected": used_backend,
            "backend_fallback_used": bool(backend_choice.get("fallback_used") or used_backend != selected_backend),
            "backend_reason": str(backend_choice.get("reason") or ""),
            "pdf_fingerprint": fingerprint,
            "scanned_pdf_detected": scanned_pdf_detected,
            "scanned_pdf_chars_per_page": float(scan_route.get("chars_per_page") or 0.0),
            "scanned_pdf_lines_per_page": float(scan_route.get("lines_per_page") or 0.0),
            "scanned_pdf_ocr_enabled": bool(enable_scanned_ocr),
            "scanned_pdf_ocr_attempted": bool(ocr_attempted),
            "scanned_pdf_ocr_backend_requested": ocr_backend_requested,
            "scanned_pdf_ocr_backend_selected": ocr_backend_selected,
            "scanned_pdf_ocr_backend_fallback_used": bool(ocr_backend_fallback_used),
            "scanned_pdf_ocr_backend_reason": ocr_backend_reason,
            "scanned_pdf_ocr_pair_count": len(ocr_pairs),
            "scanned_pdf_ocr_kv_pair_count": len(ocr_kv_pairs),
            "scanned_pdf_ocr_table_pair_count": len(ocr_table_pairs),
            "scanned_pdf_ocr_confidence_avg": float(ocr_confidence_avg),
            "scanned_pdf_ocr_low_confidence_pairs": int(ocr_low_confidence_pairs),
            "scanned_pdf_ocr_error": str(ocr_error or ""),
        },
        "errors": fingerprint_errors,
    }

    if extraction_error:
        payload.setdefault("errors", []).append(extraction_error)
    if ocr_error:
        payload.setdefault("errors", []).append(f"scanned_pdf_ocr:{ocr_error}")

    write_json(args.out, payload)
    print(
        json.dumps(
            {
                "ok": bool(payload.get("ok")),
                "pairs": len(payload.get("pairs", [])),
                "backend": used_backend,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
