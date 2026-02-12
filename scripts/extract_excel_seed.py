#!/usr/bin/env python3
"""Extract field rows and product rows from an XLSX/XLSM data-entry sheet.

This script intentionally uses only Python stdlib so the Node pipeline can
invoke it without extra dependencies.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"x": NS_MAIN, "r": NS_REL, "p": NS_PKG_REL}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", required=True)
    parser.add_argument("--sheet", default="dataEntry")
    parser.add_argument("--field-label-column", default="B")
    parser.add_argument("--field-row-start", type=int, default=9)
    parser.add_argument("--field-row-end", type=int, default=83)
    parser.add_argument("--brand-row", type=int, default=3)
    parser.add_argument("--model-row", type=int, default=4)
    parser.add_argument("--variant-row", type=int, default=5)
    parser.add_argument("--data-column-start", default="C")
    parser.add_argument("--data-column-end", default="")
    return parser.parse_args()


def col_to_index(col: str) -> int:
    total = 0
    for ch in str(col or "").strip().upper():
        if ch < "A" or ch > "Z":
            raise ValueError(f"invalid column '{col}'")
        total = total * 26 + (ord(ch) - ord("A") + 1)
    if total <= 0:
        raise ValueError(f"invalid column '{col}'")
    return total


def index_to_col(idx: int) -> str:
    if idx <= 0:
        raise ValueError("index must be >= 1")
    out = []
    n = idx
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out.append(chr(ord("A") + rem))
    return "".join(reversed(out))


def split_cell_ref(ref: str) -> Tuple[str, int]:
    m = re.match(r"^([A-Za-z]+)(\d+)$", str(ref or "").strip())
    if not m:
        raise ValueError(f"invalid cell ref '{ref}'")
    return m.group(1).upper(), int(m.group(2))


def load_workbook_paths(zf: zipfile.ZipFile) -> Dict[str, str]:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib.get("Id"): rel.attrib.get("Target", "")
        for rel in rels.findall("p:Relationship", NS)
    }
    sheets = {}
    sheets_node = wb.find("x:sheets", NS)
    if sheets_node is None:
        return sheets
    for sheet in sheets_node.findall("x:sheet", NS):
        name = sheet.attrib.get("name", "")
        rel_id = sheet.attrib.get(f"{{{NS_REL}}}id", "")
        target = rel_map.get(rel_id, "")
        if not target:
            continue
        if target.startswith("/"):
            target = target[1:]
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheets[name] = target
    return sheets


def load_shared_strings(zf: zipfile.ZipFile) -> List[str]:
    try:
        sst = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []

    out: List[str] = []
    for si in sst.findall("x:si", NS):
        parts = [(node.text or "") for node in si.findall(".//x:t", NS)]
        out.append("".join(parts))
    return out


def sheet_cells(zf: zipfile.ZipFile, sheet_path: str, shared: List[str]) -> Dict[str, str]:
    root = ET.fromstring(zf.read(sheet_path))
    out: Dict[str, str] = {}
    for c in root.findall(".//x:c", NS):
        ref = c.attrib.get("r", "").strip()
        if not ref:
            continue
        t = c.attrib.get("t", "")
        value = ""
        inline = c.find("x:is", NS)
        if inline is not None:
            parts = [(node.text or "") for node in inline.findall(".//x:t", NS)]
            value = "".join(parts)
        else:
            v = c.find("x:v", NS)
            if v is None:
                continue
            raw = v.text or ""
            if t == "s":
                try:
                    value = shared[int(raw)]
                except Exception:
                    value = raw
            else:
                value = raw
        out[ref.upper()] = str(value).strip()
    return out


def build_payload(
    cells: Dict[str, str],
    field_label_col: str,
    field_row_start: int,
    field_row_end: int,
    brand_row: int,
    model_row: int,
    variant_row: int,
    data_col_start: str,
    data_col_end: Optional[str],
) -> Dict[str, object]:
    field_rows = []
    for row_idx in range(field_row_start, field_row_end + 1):
        label = cells.get(f"{field_label_col}{row_idx}", "").strip()
        if not label:
            continue
        field_rows.append(
            {
                "row": row_idx,
                "label": label,
            }
        )

    if not field_rows:
        return {
            "field_rows": [],
            "products": [],
        }

    max_col_seen = col_to_index(data_col_start)
    for ref in cells.keys():
        try:
            col, _row = split_cell_ref(ref)
        except ValueError:
            continue
        max_col_seen = max(max_col_seen, col_to_index(col))

    start_col = col_to_index(data_col_start)
    end_col = col_to_index(data_col_end) if data_col_end else max_col_seen
    end_col = max(start_col, min(end_col, max_col_seen))

    products = []
    for col_idx in range(start_col, end_col + 1):
        col = index_to_col(col_idx)
        brand = cells.get(f"{col}{brand_row}", "").strip()
        model = cells.get(f"{col}{model_row}", "").strip()
        if not brand and not model:
            continue
        variant = cells.get(f"{col}{variant_row}", "").strip() if variant_row > 0 else ""
        values = {}
        for row in field_rows:
            row_idx = int(row["row"])
            label = str(row["label"])
            values[label] = cells.get(f"{col}{row_idx}", "").strip()
        products.append(
            {
                "column": col,
                "brand": brand,
                "model": model,
                "variant": variant,
                "values_by_label": values,
            }
        )

    return {
        "field_rows": field_rows,
        "products": products,
    }


def main() -> int:
    args = parse_args()
    workbook_path = os.path.abspath(args.workbook)
    if not os.path.exists(workbook_path):
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"workbook_not_found: {workbook_path}",
                }
            )
        )
        return 2

    try:
        with zipfile.ZipFile(workbook_path, "r") as zf:
            sheets = load_workbook_paths(zf)
            sheet_path = sheets.get(args.sheet)
            if not sheet_path:
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "error": f"sheet_not_found: {args.sheet}",
                            "sheets": sorted(sheets.keys()),
                        }
                    )
                )
                return 3
            shared = load_shared_strings(zf)
            cells = sheet_cells(zf, sheet_path, shared)
            payload = build_payload(
                cells=cells,
                field_label_col=str(args.field_label_column or "B").strip().upper(),
                field_row_start=int(args.field_row_start),
                field_row_end=int(args.field_row_end),
                brand_row=int(args.brand_row),
                model_row=int(args.model_row),
                variant_row=int(args.variant_row),
                data_col_start=str(args.data_column_start or "C").strip().upper(),
                data_col_end=str(args.data_column_end or "").strip().upper() or None,
            )
    except Exception as exc:  # pragma: no cover
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"parse_failed: {exc}",
                }
            )
        )
        return 4

    output = {
        "ok": True,
        "workbook_path": workbook_path,
        "sheet": args.sheet,
        "field_rows": payload["field_rows"],
        "products": payload["products"],
    }
    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

