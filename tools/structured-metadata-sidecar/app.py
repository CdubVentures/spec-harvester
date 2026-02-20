from __future__ import annotations

import hashlib
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

try:
    import extruct  # type: ignore
except Exception:  # pragma: no cover - import guarded for environments without deps
    extruct = None


class StructuredRequest(BaseModel):
    url: str = Field(default="")
    html: str = Field(default="")
    content_type: str = Field(default="text/html")
    max_items_per_surface: int = Field(default=200, ge=1, le=1000)


class StructuredResponse(BaseModel):
    ok: bool
    url: str
    html_hash: str
    surfaces: dict[str, Any]
    stats: dict[str, int]
    errors: list[str]


def _sha256_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _safe_json(value: Any, depth: int = 0, max_depth: int = 10) -> Any:
    if depth >= max_depth:
        return str(value)
    if value is None:
        return None
    if isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            out[str(key)] = _safe_json(item, depth + 1, max_depth)
        return out
    if isinstance(value, (list, tuple, set)):
        return [_safe_json(item, depth + 1, max_depth) for item in value]
    return str(value)


def _limit_rows(rows: Any, cap: int) -> list[Any]:
    if not isinstance(rows, list):
        return []
    return [_safe_json(row) for row in rows[:cap]]


def _merge_opengraph(raw: Any, cap: int) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(raw, dict):
        for key, value in raw.items():
            out[str(key)] = _safe_json(value)
        return out
    if isinstance(raw, list):
        for row in raw[:cap]:
            if isinstance(row, dict):
                for key, value in row.items():
                    token = str(key)
                    if token not in out:
                        out[token] = _safe_json(value)
                    else:
                        prev = out[token]
                        if not isinstance(prev, list):
                            prev = [prev]
                        prev.append(_safe_json(value))
                        out[token] = prev
            elif isinstance(row, (tuple, list)) and len(row) >= 2:
                token = str(row[0])
                val = _safe_json(row[1])
                if token not in out:
                    out[token] = val
                else:
                    prev = out[token]
                    if not isinstance(prev, list):
                        prev = [prev]
                    prev.append(val)
                    out[token] = prev
    return out


def _surface_rows(payload: dict[str, Any], key: str, cap: int) -> list[Any]:
    row = payload.get(key)
    if isinstance(row, list):
        return _limit_rows(row, cap)
    if row is None:
        return []
    return _limit_rows([row], cap)


def _extract_structured(
    *,
    url: str,
    html: str,
    max_items_per_surface: int,
) -> tuple[dict[str, Any], dict[str, int], list[str]]:
    errors: list[str] = []
    if extruct is None:
        return (
            {
                "json_ld": [],
                "microdata": [],
                "rdfa": [],
                "microformats": [],
                "opengraph": {},
                "twitter": {},
            },
            {
                "json_ld_count": 0,
                "microdata_count": 0,
                "rdfa_count": 0,
                "microformats_count": 0,
                "opengraph_count": 0,
                "twitter_count": 0,
            },
            ["extruct_not_installed"],
        )

    raw: dict[str, Any] = {}
    try:
        raw = extruct.extract(  # type: ignore[union-attr]
            html,
            base_url=url or None,
            uniform=True,
            syntaxes=["json-ld", "microdata", "opengraph", "rdfa", "microformat", "twitter"],
        ) or {}
    except Exception as err:  # pragma: no cover - runtime safety path
        errors.append(f"extruct_extract_failed:{type(err).__name__}")

    json_ld = _surface_rows(raw, "json-ld", max_items_per_surface)
    microdata = _surface_rows(raw, "microdata", max_items_per_surface)
    rdfa = _surface_rows(raw, "rdfa", max_items_per_surface)

    microformats = _surface_rows(raw, "microformat", max_items_per_surface)
    if not microformats:
        microformats = _surface_rows(raw, "microformats", max_items_per_surface)

    opengraph = _merge_opengraph(raw.get("opengraph"), max_items_per_surface)
    twitter = _merge_opengraph(raw.get("twitter"), max_items_per_surface)

    surfaces = {
        "json_ld": json_ld,
        "microdata": microdata,
        "rdfa": rdfa,
        "microformats": microformats,
        "opengraph": opengraph,
        "twitter": twitter,
    }
    stats = {
        "json_ld_count": len(json_ld),
        "microdata_count": len(microdata),
        "rdfa_count": len(rdfa),
        "microformats_count": len(microformats),
        "opengraph_count": len(opengraph.keys()),
        "twitter_count": len(twitter.keys()),
    }
    return surfaces, stats, errors


app = FastAPI(title="SpecFactory Structured Metadata Sidecar", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "structured-metadata-sidecar",
        "extruct_available": extruct is not None,
    }


@app.post("/extract/structured", response_model=StructuredResponse)
def extract_structured(payload: StructuredRequest) -> StructuredResponse:
    html = str(payload.html or "")
    url = str(payload.url or "")
    html_hash = _sha256_text(html)
    content_type = str(payload.content_type or "").lower()

    if "html" not in content_type and html.strip() == "":
        surfaces = {
            "json_ld": [],
            "microdata": [],
            "rdfa": [],
            "microformats": [],
            "opengraph": {},
            "twitter": {},
        }
        stats = {
            "json_ld_count": 0,
            "microdata_count": 0,
            "rdfa_count": 0,
            "microformats_count": 0,
            "opengraph_count": 0,
            "twitter_count": 0,
        }
        return StructuredResponse(
            ok=True,
            url=url,
            html_hash=html_hash,
            surfaces=surfaces,
            stats=stats,
            errors=["skip_non_html_payload"],
        )

    surfaces, stats, errors = _extract_structured(
        url=url,
        html=html,
        max_items_per_surface=payload.max_items_per_surface,
    )
    return StructuredResponse(
        ok=True,
        url=url,
        html_hash=html_hash,
        surfaces=surfaces,
        stats=stats,
        errors=errors,
    )
