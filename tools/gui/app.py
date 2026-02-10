import json
import os
import subprocess
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import streamlit as st


def resolve_repo_root() -> Path:
    env_root = str(os.environ.get("SPEC_FACTORY_ROOT", "")).strip()
    if env_root:
        root = Path(env_root).resolve()
        if root.exists():
            return root
    return Path(__file__).resolve().parents[2]


REPO_ROOT = resolve_repo_root()
OUTPUT_ROOT = (REPO_ROOT / os.environ.get("LOCAL_OUTPUT_ROOT", "out")).resolve()
HELPER_ROOT = REPO_ROOT / "helper_files"
CATEGORIES_ROOT = REPO_ROOT / "categories"
FINAL_ROOT = OUTPUT_ROOT / "final"
EVENTS_PATH = OUTPUT_ROOT / "_runtime" / "events.jsonl"
GUI_PROCESS_LOG_PATH = OUTPUT_ROOT / "_runtime" / "gui_process.log"
QUEUE_ROOT = OUTPUT_ROOT / "_queue"
QUEUE_ROOT_LEGACY = OUTPUT_ROOT / "specs" / "outputs" / "_queue"
RUNS_ROOT = OUTPUT_ROOT / "runs"
RUNS_ROOT_LEGACY = OUTPUT_ROOT / "specs" / "outputs"
BILLING_ROOT = OUTPUT_ROOT / "_billing"
BILLING_ROOT_LEGACY = OUTPUT_ROOT / "specs" / "outputs" / "_billing"
LEARNING_ROOT = OUTPUT_ROOT / "_learning"
LEARNING_ROOT_LEGACY = OUTPUT_ROOT / "specs" / "outputs" / "_learning"
COMPONENT_ROOT = OUTPUT_ROOT / "_components"
UNKNOWN = {"", "unk", "unknown", "na", "n/a", "none", "null"}

EVENT_MEANINGS = {
    "queue_transition": "Product changed queue state (pending/running/complete/exhausted).",
    "run_started": "Pipeline run started for the selected product.",
    "helper_files_context_loaded": "Helper files were loaded and matched against the product identity.",
    "helper_supportive_fill_applied": "Known supportive helper values were injected for missing fields.",
    "discovery_results_reranked": "Search/discovery results were reranked for best candidates.",
    "source_discovery_only": "Source was discovered but not fetched (planning/discovery step only).",
    "source_fetch_started": "A source URL fetch has started.",
    "source_processed": "A fetched source was parsed and candidate fields were extracted.",
    "source_fetch_failed": "A fetch failed (timeout, blocked, network, parser, etc).",
    "llm_call_started": "LLM call started (plan/extract/validate/summary).",
    "llm_call_usage": "LLM token/cost usage was recorded.",
    "llm_call_completed": "LLM call returned successfully.",
    "llm_call_failed": "LLM call failed for the configured provider.",
    "openai_call_failed": "Legacy event name from old runs; for deepseek runs, use llm_call_failed.",
    "llm_discovery_planner_failed": "LLM discovery planner failed; deterministic fallback used.",
    "llm_extract_failed": "LLM extraction failed; deterministic extraction still continues.",
    "llm_extract_skipped_budget": "LLM extraction skipped because the current budget/call limit was reached.",
    "llm_extract_skipped_source": "LLM extraction skipped for non-extractable source (search/robots/4xx/etc).",
    "llm_summary_failed": "LLM summary writing failed; pipeline summary fallback used.",
    "field_decision": "Final per-field decision accepted/rejected/unknown.",
    "round_completed": "A run round ended.",
    "run_completed": "Run finished and outputs were written.",
    "max_run_seconds_reached": "Run hit max runtime guard and stopped early."
}

PIPELINE_STAGE_DEFS = [
    ("queued", "Queued", {"queue_transition", "run_started"}),
    ("helper", "Helper Matched", {"helper_files_context_loaded"}),
    ("discover", "Discovery Planned", {"discovery_results_reranked", "source_discovery_only"}),
    ("fetch", "Sources Fetching", {"source_fetch_started"}),
    ("extract", "Extraction", {"source_processed", "field_decision"}),
    ("llm", "LLM Reasoning", {"llm_call_started", "llm_call_completed", "llm_call_usage"}),
    ("round", "Round Complete", {"round_completed"}),
    ("complete", "Run Complete", {"run_completed"})
]


def norm(value) -> str:
    return " ".join(str(value or "").strip().split())


def token(value) -> str:
    return norm(value).lower()


def slug(value) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value or "")).strip("-").replace("--", "-")


def clean_variant(value) -> str:
    text = norm(value)
    return "" if token(text) in UNKNOWN else text


def known(value) -> bool:
    return token(value) not in UNKNOWN


def read_json(path: Path, default=None):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def read_jsonl(path: Path, limit: int = 1000):
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows[-limit:]


def read_tail_lines(path: Path, limit: int = 300):
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            lines = handle.readlines()
        return [line.rstrip("\n") for line in lines[-limit:]]
    except Exception:
        return []


def effective_queue_root() -> Path:
    return QUEUE_ROOT if QUEUE_ROOT.exists() else QUEUE_ROOT_LEGACY


def effective_billing_root() -> Path:
    return BILLING_ROOT if BILLING_ROOT.exists() else BILLING_ROOT_LEGACY


def effective_learning_root() -> Path:
    return LEARNING_ROOT if LEARNING_ROOT.exists() else LEARNING_ROOT_LEGACY


def run_root_paths(category: str, pid: str, run_id: str):
    return {
        "new": RUNS_ROOT / category / pid / run_id,
        "legacy_logs": RUNS_ROOT_LEGACY / category / pid / "runs" / run_id / "logs",
    }


def read_run_bundle(category: str, pid: str, run_id: str):
    if not category or not pid or not run_id:
        return {}
    roots = run_root_paths(category, pid, run_id)
    summary_detailed = read_json(roots["legacy_logs"] / "summary.json", {})
    summary_compact = read_json(roots["new"] / "summary.json", {})
    spec = read_json(roots["new"] / "spec.json", {})
    provenance = read_json(roots["new"] / "provenance.json", {})
    traffic_light = read_json(roots["new"] / "traffic_light.json", {})
    if not spec:
        normalized = read_json(roots["legacy_logs"] / "normalized.json", {})
        spec = normalized.get("fields", {}) if isinstance(normalized, dict) else {}
    return {
        "exists": bool(summary_detailed or summary_compact or spec),
        "run_id": run_id,
        "summary": summary_detailed if summary_detailed else summary_compact,
        "summary_compact": summary_compact,
        "summary_detailed": summary_detailed,
        "spec": spec,
        "provenance": provenance,
        "traffic_light": traffic_light,
        "paths": roots,
    }


def normalize_summary(summary):
    return summary if isinstance(summary, dict) else {}


def schema_field_order(schema: dict):
    field_order = list((schema or {}).get("field_order", []) or [])
    editorial = set((schema or {}).get("editorial_fields", []) or [])
    return [field for field in field_order if field not in editorial]


def live_field_decisions(events, allowed_fields):
    out = {}
    allowed = set(allowed_fields or [])
    for event in events:
        if str(event.get("event", "")) != "field_decision":
            continue
        field = str(event.get("field", "")).strip()
        if not field:
            continue
        if allowed and field not in allowed:
            continue
        out[field] = {
            "value": event.get("value", "unk"),
            "decision": event.get("decision", ""),
            "unknown_reason": event.get("unknown_reason", ""),
            "confidence": float(event.get("confidence", 0) or 0),
            "traffic_color": str(event.get("traffic_color", "")).lower(),
            "traffic_reason": event.get("traffic_reason", ""),
            "evidence_count": int(event.get("evidence_count", 0) or 0),
        }
    return out


def choose_display_value(field, spec_row, live_row):
    if known(spec_row):
        return spec_row
    if live_row and known(live_row.get("value")):
        return live_row.get("value")
    return spec_row


def latest_event(events, event_name: str):
    for event in reversed(events or []):
        if str(event.get("event", "")) == event_name:
            return event
    return {}


def build_live_helper_llm_snapshot(events):
    helper_loaded = latest_event(events, "helper_files_context_loaded")
    helper_fill = latest_event(events, "helper_supportive_fill_applied")
    budget_block = latest_event(events, "llm_extract_skipped_budget")
    llm_started_events = [event for event in (events or []) if str(event.get("event", "")) == "llm_call_started"]
    llm_usage_events = [event for event in (events or []) if str(event.get("event", "")) == "llm_call_usage"]

    provider = "n/a"
    if llm_usage_events:
        provider = str(llm_usage_events[-1].get("provider", "")).strip() or provider
    if provider == "n/a" and llm_started_events:
        provider = str(llm_started_events[-1].get("provider", "")).strip() or provider

    live_helper = {
        "active_filtering_match": bool(helper_loaded.get("active_match")),
        "supportive_match_count": int(helper_loaded.get("supportive_matches", 0) or 0),
        "supportive_file_count": int(helper_loaded.get("supportive_files", 0) or 0),
        "seed_urls_from_active_count": int(helper_loaded.get("helper_seed_urls", 0) or 0),
        "supportive_fields_filled_count": int(helper_fill.get("fields_filled", 0) or 0),
        "supportive_fields_filled_by_method": helper_fill.get("fields_filled_by_method", {}) or {},
    }
    live_llm = {
        "provider": provider,
        "call_count_run": int(len(llm_started_events)),
        "cost_usd_run": float(sum(float(event.get("cost_usd", 0) or 0) for event in llm_usage_events)),
        "budget": {
            "blocked_reason": str(budget_block.get("reason", "")).strip() or None
        }
    }
    return live_helper, live_llm


def merge_display_helper_info(summary_helper, live_helper):
    base = dict(summary_helper or {})
    live = dict(live_helper or {})
    if "active_filtering_match" not in base:
        base["active_filtering_match"] = live.get("active_filtering_match", False)
    base["supportive_match_count"] = max(
        int(base.get("supportive_match_count", 0) or 0),
        int(live.get("supportive_match_count", 0) or 0),
    )
    base["supportive_fields_filled_count"] = max(
        int(base.get("supportive_fields_filled_count", 0) or 0),
        int(live.get("supportive_fields_filled_count", 0) or 0),
    )
    if not base.get("supportive_fields_filled_by_method") and live.get("supportive_fields_filled_by_method"):
        base["supportive_fields_filled_by_method"] = live.get("supportive_fields_filled_by_method")
    return base


def merge_display_llm_info(summary_llm, live_llm):
    base = dict(summary_llm or {})
    live = dict(live_llm or {})
    if not str(base.get("provider", "")).strip() or str(base.get("provider", "")).strip().lower() in {"n/a", "unknown"}:
        base["provider"] = live.get("provider", "n/a")
    base["call_count_run"] = max(
        int(base.get("call_count_run", 0) or 0),
        int(live.get("call_count_run", 0) or 0),
    )
    base["cost_usd_run"] = max(
        float(base.get("cost_usd_run", 0) or 0),
        float(live.get("cost_usd_run", 0) or 0),
    )
    budget = dict(base.get("budget", {}) or {})
    if not budget.get("blocked_reason"):
        live_reason = ((live.get("budget", {}) or {}).get("blocked_reason"))
        if live_reason:
            budget["blocked_reason"] = live_reason
    if budget:
        base["budget"] = budget
    return base


@st.cache_data(ttl=30, show_spinner=False)
def list_categories():
    names = set()
    for root in (HELPER_ROOT, CATEGORIES_ROOT):
        if root.exists():
            for item in root.iterdir():
                if item.is_dir():
                    names.add(item.name)
    return sorted(names)


@st.cache_data(ttl=30, show_spinner=False)
def load_schema(category: str):
    return read_json(CATEGORIES_ROOT / category / "schema.json", {})


@st.cache_data(ttl=30, show_spinner=False)
def load_active_filtering(category: str):
    path = HELPER_ROOT / category / "models-and-schema" / "activeFiltering.json"
    payload = read_json(path, [])
    out = []
    if not isinstance(payload, list):
        return out
    for idx, row in enumerate(payload):
        if not isinstance(row, dict):
            continue
        brand = norm(row.get("brand"))
        model = norm(row.get("model"))
        if not brand or not model:
            continue
        out.append(
            {
                "brand": brand,
                "model": model,
                "variant": clean_variant(row.get("variant")),
                "id": row.get("id", idx),
                "raw": row,
            }
        )
    return out


def iter_supportive_nodes(payload):
    stack = [payload]
    while stack:
        current = stack.pop()
        if isinstance(current, list):
            for item in current:
                if isinstance(item, dict):
                    yield item
                elif isinstance(item, list):
                    stack.append(item)
        elif isinstance(current, dict):
            for key in ("data", "items", "rows", "results", "products", "records"):
                child = current.get(key)
                if isinstance(child, (list, dict)):
                    stack.append(child)
            yield current


@st.cache_data(ttl=60, show_spinner=False)
def load_supportive(category: str):
    folder = HELPER_ROOT / category / "accurate-supportive-product-information"
    files = {}
    records = []
    if not folder.exists():
        return {"files": files, "records": records}
    for json_file in sorted(folder.glob("*.json")):
        payload = read_json(json_file, None)
        if payload is None:
            continue
        count = 0
        seen = set()
        for node in iter_supportive_nodes(payload):
            brand = (
                norm(node.get("brand"))
                or norm((node.get("general__brand_names") or [""])[0])
                or norm(node.get("general__brand_name"))
            )
            model = norm(node.get("model")) or norm(node.get("general__model"))
            variant = clean_variant(node.get("variant") or node.get("general__variant"))
            if not brand or not model:
                continue
            key = (token(brand), token(model), token(variant), str(node.get("id", node.get("general__id", ""))))
            if key in seen:
                continue
            seen.add(key)
            count += 1
            records.append(
                {
                    "brand": brand,
                    "model": model,
                    "variant": variant,
                    "source_file": json_file.name,
                    "raw": node,
                }
            )
        files[json_file.name] = count
    return {"files": files, "records": records}


@st.cache_data(ttl=10, show_spinner=False)
def list_final_rows(category: str):
    rows = []
    root = FINAL_ROOT / category
    if not root.exists():
        return rows
    for brand_dir in root.iterdir():
        if not brand_dir.is_dir():
            continue
        for model_dir in brand_dir.iterdir():
            if not model_dir.is_dir():
                continue
            candidates = [model_dir] + [d for d in model_dir.iterdir() if d.is_dir()]
            for path in candidates:
                summary_path = path / "summary.json"
                if not summary_path.exists():
                    continue
                summary = read_json(summary_path, {})
                meta = read_json(path / "meta.json", {})
                identity = (meta or {}).get("canonical_identity", {})
                rows.append(
                    {
                        "brand": norm(identity.get("brand")) or brand_dir.name,
                        "model": norm(identity.get("model")) or model_dir.name,
                        "variant": clean_variant(identity.get("variant")) or (path.name if path != model_dir else ""),
                        "path": path,
                        "summary": summary,
                    }
                )
    return rows


@st.cache_data(ttl=5, show_spinner=False)
def load_queue(category: str):
    return read_json(effective_queue_root() / category / "state.json", {"products": {}})


@st.cache_data(ttl=5, show_spinner=False)
def load_billing_month():
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    return read_json(effective_billing_root() / "monthly" / f"{month}.json", {})


@st.cache_data(ttl=15, show_spinner=False)
def load_field_availability(category: str):
    return read_json(effective_learning_root() / category / "field_availability.json", {})


def product_id(category: str, brand: str, model: str, variant: str):
    parts = [category, brand, model]
    if clean_variant(variant):
        parts.append(clean_variant(variant))
    return slug("-".join(parts))


def filter_events_for_product(events, category: str, pid: str):
    filtered = []
    for event in events:
        if str(event.get("category", "")) != category:
            continue
        event_pid = str(event.get("productId", ""))
        if event_pid != pid:
            continue
        filtered.append(event)
    return filtered


def latest_run_id(events, pid: str = ""):
    normalized_pid = str(pid or "")
    if normalized_pid:
        for event in reversed(events):
            if str(event.get("productId", "")) != normalized_pid:
                continue
            run_id = str(event.get("runId", "")).strip()
            if run_id:
                return run_id
    for event in reversed(events):
        run_id = str(event.get("runId", "")).strip()
        if run_id:
            return run_id
    return ""


def filter_events_for_run(events, run_id: str):
    if not run_id:
        return events
    keep = []
    for event in events:
        value = str(event.get("runId", "")).strip()
        if value in {"", run_id}:
            keep.append(event)
    return keep


def pipeline_stage_status(events):
    counts = Counter(str(event.get("event", "")) for event in events)
    done = []
    weights = [10, 12, 12, 16, 16, 16, 9, 9]
    score = 0.0
    for idx, (stage_key, label, stage_events) in enumerate(PIPELINE_STAGE_DEFS):
        reached = any(counts.get(event_name, 0) > 0 for event_name in stage_events)
        done.append(
            {
                "stage_key": stage_key,
                "label": label,
                "reached": reached,
                "events": sorted(stage_events),
            }
        )
        if reached:
            score += weights[idx]

    score = min(100.0, max(0.0, score))
    return {
        "stages": done,
        "counts": counts,
        "progress_pct": score
    }


def event_rows_with_help(counts: Counter):
    rows = []
    for event_name, count in counts.most_common():
        rows.append(
            {
                "event": event_name,
                "count": int(count),
                "meaning": EVENT_MEANINGS.get(event_name, "No tooltip defined yet."),
            }
        )
    return rows


def build_catalog(category: str):
    active = load_active_filtering(category)
    supportive = load_supportive(category)
    finals = list_final_rows(category)
    queue = load_queue(category)

    rows = {}

    def put(brand, model, variant):
        key = (token(brand), token(model), token(variant))
        if key not in rows:
            rows[key] = {
                "brand": brand,
                "model": model,
                "variant": variant,
                "in_active": False,
                "supportive_hits": 0,
                "supportive_files": set(),
                "has_final": False,
                "validated": False,
                "confidence": 0.0,
                "completeness_required": 0.0,
                "final_path": "",
                "queue_status": "",
            }
        return rows[key]

    for row in active:
        entry = put(row["brand"], row["model"], row["variant"])
        entry["in_active"] = True

    for row in supportive["records"]:
        entry = put(row["brand"], row["model"], row["variant"])
        entry["supportive_hits"] += 1
        entry["supportive_files"].add(row["source_file"])

    for row in finals:
        entry = put(row["brand"], row["model"], row["variant"])
        entry["has_final"] = True
        entry["validated"] = bool(row["summary"].get("validated", False))
        entry["confidence"] = float(row["summary"].get("confidence", 0) or 0)
        entry["completeness_required"] = float(row["summary"].get("completeness_required", 0) or 0)
        entry["final_path"] = str(row["path"])

    qmap = {
        norm(v.get("productId")): norm(v.get("status"))
        for v in (queue.get("products", {}) or {}).values()
        if isinstance(v, dict)
    }
    for entry in rows.values():
        pid = product_id(category, entry["brand"], entry["model"], entry["variant"])
        entry["queue_status"] = qmap.get(pid, "")
        entry["product_id"] = pid
        entry["supportive_files"] = sorted(entry["supportive_files"])

    out = sorted(rows.values(), key=lambda r: (token(r["brand"]), token(r["model"]), token(r["variant"])))
    return {"rows": out, "active": active, "supportive": supportive, "queue": queue}


def find_bundle(category: str, brand: str, model: str, variant: str):
    base = FINAL_ROOT / slug(category) / slug(brand) / slug(model)
    candidates = []
    variant_clean = clean_variant(variant)
    if variant_clean and (base / slug(variant_clean) / "summary.json").exists():
        candidates.append(base / slug(variant_clean))
    if (base / "summary.json").exists():
        candidates.append(base)
    if base.exists():
        for child in base.iterdir():
            if child.is_dir() and (child / "summary.json").exists():
                candidates.append(child)
    if not candidates:
        return {"exists": False}
    best = sorted(
        candidates,
        key=lambda p: (
            float((read_json(p / "summary.json", {}) or {}).get("completeness_required", 0)),
            float((read_json(p / "summary.json", {}) or {}).get("confidence", 0)),
        ),
        reverse=True,
    )[0]
    meta = read_json(best / "meta.json", {})
    run_id = str((meta or {}).get("runId", "")).strip()
    pid = str((meta or {}).get("productId", "")).strip()
    debug_summary = {}
    if run_id and pid:
        run_bundle = read_run_bundle(category, pid, run_id)
        debug_summary = normalize_summary(run_bundle.get("summary"))

    return {
        "exists": True,
        "path": best,
        "spec": read_json(best / "spec.json", {}),
        "summary": read_json(best / "summary.json", {}),
        "provenance": read_json(best / "provenance.json", {}),
        "traffic_light": read_json(best / "traffic_light.json", {}),
        "meta": meta,
        "run_id": run_id,
        "product_id": pid,
        "debug_summary": debug_summary,
    }


def ensure_proc_state():
    if "proc" not in st.session_state:
        st.session_state.proc = None
    if "proc_handle" not in st.session_state:
        st.session_state.proc_handle = None
    if "proc_log" not in st.session_state:
        st.session_state.proc_log = []
    if "proc_log_path" not in st.session_state:
        st.session_state.proc_log_path = str(GUI_PROCESS_LOG_PATH)
    if "last_cmd" not in st.session_state:
        st.session_state.last_cmd = ""
    if "auto_refresh" not in st.session_state:
        st.session_state.auto_refresh = True


def poll_proc():
    proc = st.session_state.proc
    log_path = Path(st.session_state.proc_log_path)
    st.session_state.proc_log = read_tail_lines(log_path, 400)
    if not proc:
        return
    if proc.poll() is not None:
        st.session_state.proc = None
        handle = st.session_state.proc_handle
        if handle:
            try:
                handle.flush()
                handle.close()
            except Exception:
                pass
            st.session_state.proc_handle = None


def start_cli(args):
    proc = st.session_state.proc
    if proc and proc.poll() is None:
        st.warning("A process is already running. Stop it first.")
        return
    st.session_state.last_cmd = "node src/cli/spec.js " + " ".join(args)
    runtime_dir = OUTPUT_ROOT / "_runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    log_path = Path(st.session_state.proc_log_path)
    with log_path.open("w", encoding="utf-8") as log_seed:
        log_seed.write(f"$ {st.session_state.last_cmd}\n")
        log_seed.write(f"Started {datetime.now(timezone.utc).isoformat()}\n")
    try:
        handle = log_path.open("a", encoding="utf-8")
        st.session_state.proc_handle = handle
        st.session_state.proc = subprocess.Popen(
            ["node", "src/cli/spec.js", *args],
            cwd=str(REPO_ROOT),
            stdout=handle,
            stderr=subprocess.STDOUT,
            text=True,
        )
    except Exception as exc:
        st.session_state.proc = None
        if st.session_state.proc_handle:
            try:
                st.session_state.proc_handle.close()
            except Exception:
                pass
            st.session_state.proc_handle = None
        st.session_state.proc_log = [
            f"$ {st.session_state.last_cmd}",
            f"Failed to start process: {exc}",
            "Verify Node.js is installed and accessible in PATH.",
        ]


def stop_cli():
    proc = st.session_state.proc
    if proc:
        try:
            proc.terminate()
        except Exception:
            pass
        st.session_state.proc = None
    handle = st.session_state.proc_handle
    if handle:
        try:
            handle.flush()
            handle.close()
        except Exception:
            pass
        st.session_state.proc_handle = None
    st.session_state.proc_log.append("Process terminated.")


st.set_page_config(page_title="Spec Factory Control Center", layout="wide")
ensure_proc_state()
poll_proc()

categories = list_categories()
if not categories:
    st.error("No category folders found.")
    st.stop()

with st.sidebar:
    st.header("Selection")
    category = st.selectbox(
        "Category",
        categories,
        index=categories.index("mouse") if "mouse" in categories else 0,
        help="Select category from `helper_files/<category>` and `categories/<category>`."
    )
    catalog = build_catalog(category)
    rows = catalog["rows"]
    if not rows:
        st.warning("No products found in helper/final data.")
        st.stop()

    active_rows = [r for r in rows if r["in_active"]] or rows
    brands = sorted({r["brand"] for r in active_rows})
    brand = st.selectbox(
        "Brand",
        brands,
        help="Brand list is merged from active targets, supportive helper files, queue state, and final outputs."
    )
    models = sorted({r["model"] for r in active_rows if r["brand"] == brand})
    model = st.selectbox("Model", models, help="Model target from helper catalog/final results.")
    variants = sorted(
        {clean_variant(r["variant"]) for r in active_rows if r["brand"] == brand and r["model"] == model},
        key=lambda v: (v != "", token(v))
    )
    variant_label = st.selectbox(
        "Variant",
        ["(none)" if v == "" else v for v in variants],
        help="Use variant when the same model has multiple editions; improves identity validation."
    )
    variant = "" if variant_label == "(none)" else variant_label

    st.header("Run")
    mode = st.selectbox(
        "Accuracy Mode",
        ["aggressive", "balanced"],
        help="`aggressive` increases search breadth and crawl depth for higher field coverage at higher cost/time."
    )
    profile = st.selectbox(
        "Run Profile",
        ["fast", "standard", "thorough"],
        index=2,
        help="`fast` quick pass, `standard` balanced, `thorough` highest effort."
    )
    rounds = st.number_input("Max Rounds", min_value=1, max_value=20, value=2, step=1)
    local = st.checkbox("Local Mode", value=True, help="Use local-first storage paths.")
    dry_run = st.checkbox("Dry Run", value=False, help="Plan/simulate without full network extraction.")
    st.session_state.auto_refresh = st.checkbox("Auto Refresh While Running", value=st.session_state.auto_refresh)

    args = ["run-ad-hoc", category, brand, model]
    if variant:
        args.append(variant)
    args += ["--until-complete", "--mode", mode, "--max-rounds", str(int(rounds)), "--profile", profile]
    if local:
        args.append("--local")
    if dry_run:
        args.append("--dry-run")
    st.code("node src/cli/spec.js " + " ".join(args), language="bash")

    if st.button(
        "Run Selected Product",
        use_container_width=True,
        help="Runs selected product now, multi-round, until complete/exhausted/limits reached."
    ):
        start_cli(args)
    if st.button(
        "Daemon Once",
        use_container_width=True,
        help="One full scheduler cycle: ingest imports, pick queue items, run processing once."
    ):
        dargs = ["daemon", "--category", category, "--mode", mode, "--once"] + (["--local"] if local else [])
        start_cli(dargs)
    if st.button(
        "Daemon Continuous",
        use_container_width=True,
        help="Always-on loop for category queue. Use Stop Process to halt."
    ):
        dargs = ["daemon", "--category", category, "--mode", mode] + (["--local"] if local else [])
        start_cli(dargs)
    if st.button(
        "Watch Imports Once",
        use_container_width=True,
        help="Scans `imports/<category>/incoming` and converts CSV rows into product jobs once."
    ):
        iargs = ["watch-imports", "--category", category, "--once"] + (["--local"] if local else [])
        start_cli(iargs)
    if st.button("Stop Process", use_container_width=True):
        stop_cli()
    if st.button("Refresh", use_container_width=True):
        st.rerun()

    with st.expander("Run Button Help", expanded=False):
        st.markdown(
            "- `Run Selected Product`: Immediate product run with current mode/profile/round limits.\n"
            "- `Daemon Once`: Ingest + queue + run once, then exit.\n"
            "- `Daemon Continuous`: Keep running queue forever until stopped.\n"
            "- `Watch Imports Once`: Only intake CSVs to queue, no product extraction.\n"
            "- `Auto Refresh While Running`: refreshes the dashboard every ~1.5s so progress updates live."
        )

st.title("Spec Factory Control Center")
st.caption(f"Repo: `{REPO_ROOT}` | Output: `{OUTPUT_ROOT}`")

bundle = find_bundle(category, brand, model, variant)
schema = load_schema(category)
fields = schema_field_order(schema)
critical = set(schema.get("critical_fields", []))
pid = product_id(category, brand, model, variant)
events = read_jsonl(EVENTS_PATH, limit=4000)
events_for_product = filter_events_for_product(events, category, pid)
latest_selected_run = latest_run_id(events_for_product, pid=pid)
events_for_selected_run = filter_events_for_run(events_for_product, latest_selected_run)
run_bundle = read_run_bundle(category, pid, latest_selected_run)
active_summary = normalize_summary(run_bundle.get("summary"))
if not active_summary:
    active_summary = normalize_summary(bundle.get("debug_summary", {})) or normalize_summary(bundle.get("summary", {}))
active_spec = run_bundle.get("spec", {}) if run_bundle else {}
spec = active_spec if active_spec else (bundle.get("spec", {}) if bundle.get("exists") else {})
active_traffic = run_bundle.get("traffic_light", {}) if run_bundle else {}
traffic_map = (active_traffic or bundle.get("traffic_light", {}) or {}).get("by_field", {})
reasoning = normalize_summary(active_summary.get("field_reasoning", {}))
live_decisions = live_field_decisions(events_for_selected_run, fields)

tab1, tab2, tab3, tab4 = st.tabs(["Overview", "Selected Product", "Live Runtime", "Billing & Learning"])

with tab1:
    monthly = load_billing_month() or {}
    totals = monthly.get("totals", {})
    targets = sum(1 for r in rows if r["in_active"])
    finals = sum(1 for r in rows if r["has_final"])
    validated = sum(1 for r in rows if r["has_final"] and r["validated"])
    coverage = finals / targets if targets else 0
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Target Products", targets)
    c2.metric("Final Outputs", finals)
    c3.metric("Validated", validated)
    c4.metric("Coverage", f"{coverage * 100:.1f}%")
    c5.metric("Monthly Cost USD", f"{float(totals.get('cost_usd', 0)):.6f}")
    st.progress(coverage, text=f"Final coverage across helper targets: {coverage * 100:.1f}%")
    table = []
    for r in rows:
        state = "validated" if r["has_final"] and r["validated"] else ("partial" if r["has_final"] else (r["queue_status"] or "target_only"))
        table.append(
            {
                "brand": r["brand"],
                "model": r["model"],
                "variant": r["variant"],
                "state": state,
                "active_target": r["in_active"],
                "supportive_hits": r["supportive_hits"],
                "confidence": r["confidence"],
                "completeness_required": r["completeness_required"],
            }
        )
    st.dataframe(table, use_container_width=True, height=420)

with tab2:
    st.subheader(f"{category} / {brand} / {model}" + (f" / {variant}" if variant else ""))
    st.caption(f"Product ID: `{pid}`")
    has_final_bundle = bool(bundle.get("exists"))
    if has_final_bundle:
        st.caption(f"Final Path: `{bundle.get('path')}`")
    else:
        st.info("No final output bundle found yet. Live run status below will still update.")

    run_focus = latest_selected_run or bundle.get("run_id", "")
    running_now = bool(st.session_state.proc and st.session_state.proc.poll() is None)
    if run_focus:
        st.caption(f"Run focus: `{run_focus}`")
    if running_now:
        st.warning("A CLI process is currently running. Live fields and events update automatically.")

    summary_for_metrics = normalize_summary(active_summary or bundle.get("summary", {}))
    s1, s2, s3, s4 = st.columns(4)
    s1.metric("Validated", "yes" if summary_for_metrics.get("validated") else "no")
    s2.metric("Confidence", f"{float(summary_for_metrics.get('confidence', 0) or 0):.4f}")
    s3.metric("Completeness Required", f"{float(summary_for_metrics.get('completeness_required', 0) or 0):.4f}")
    s4.metric("Coverage Overall", f"{float(summary_for_metrics.get('coverage_overall', 0) or 0):.4f}")

    live_stage = pipeline_stage_status(events_for_selected_run)
    st.progress(
        live_stage["progress_pct"] / 100.0,
        text=f"Live run progress: {live_stage['progress_pct']:.0f}%"
    )
    live_counts = live_stage["counts"]
    p1, p2, p3, p4 = st.columns(4)
    p1.metric("Sources Fetch Started", int(live_counts.get("source_fetch_started", 0)))
    p2.metric("Sources Processed", int(live_counts.get("source_processed", 0)))
    p3.metric("LLM Calls Started", int(live_counts.get("llm_call_started", 0)))
    p4.metric("Field Decisions Logged", int(live_counts.get("field_decision", 0)))

    helper_info = summary_for_metrics.get("helper_files", {}) if isinstance(summary_for_metrics, dict) else {}
    llm_info = summary_for_metrics.get("llm", {}) if isinstance(summary_for_metrics, dict) else {}
    live_helper_info, live_llm_info = build_live_helper_llm_snapshot(events_for_selected_run)
    helper_info = merge_display_helper_info(helper_info, live_helper_info)
    llm_info = merge_display_llm_info(llm_info, live_llm_info)
    st.subheader("Helper + LLM Status")
    h1, h2, h3, h4 = st.columns(4)
    h1.metric(
        "Helper Active Match",
        "yes" if bool(helper_info.get("active_filtering_match")) else "no",
        help="True when activeFiltering brand/model matched the selected product."
    )
    h2.metric(
        "Helper Support Matches",
        int(helper_info.get("supportive_match_count", 0) or 0),
        help="Supportive helper rows matching identity."
    )
    h3.metric(
        "Helper Fields Filled",
        int(helper_info.get("supportive_fields_filled_count", 0) or 0),
        help="Fields filled directly from supportive helper evidence."
    )
    h4.metric(
        "LLM Provider",
        str(llm_info.get("provider", "n/a")),
        help="Configured provider for plan/extract/validate calls."
    )
    l1, l2, l3, l4 = st.columns(4)
    l1.metric("LLM Calls (Run)", int(llm_info.get("call_count_run", 0) or 0))
    l2.metric("LLM Cost (Run USD)", f"{float(llm_info.get('cost_usd_run', 0) or 0):.6f}")
    l3.metric(
        "LLM Failures (Run Events)",
        int(
            sum(
                1
                for event in events_for_selected_run
                if str(event.get("event", "")) in {"llm_call_failed", "openai_call_failed", "llm_extract_failed"}
            )
        ),
    )
    l4.metric(
        "LLM Filled Fields",
        int(llm_info.get("fields_filled_by_llm_count", 0) or 0),
        help="Fields whose accepted provenance includes llm_extract/llm_validate."
    )
    blocked_reason = (
        ((llm_info.get("budget", {}) or {}).get("blocked_reason"))
        if isinstance(llm_info, dict)
        else ""
    )
    st.caption(f"LLM budget block reason: `{blocked_reason or 'none'}`")
    with st.expander("Helper details", expanded=False):
        st.json(helper_info)
    with st.expander("LLM details", expanded=False):
        st.json(llm_info)
    if not summary_for_metrics:
        st.caption("Detailed run summary not found yet; run a product to populate full helper/llm details.")
    helper_filled = helper_info.get("supportive_fields_filled", []) if isinstance(helper_info, dict) else []
    if helper_filled:
        st.caption("Helper-filled fields:")
        st.write(", ".join(helper_filled))

    field_rows = []
    order = fields or sorted(spec.keys())
    for key in order:
        live_row = live_decisions.get(key, {})
        value = choose_display_value(key, spec.get(key, "unk"), live_row)
        trow = traffic_map.get(key, {}) if isinstance(traffic_map, dict) else {}
        rrow = reasoning.get(key, {}) if isinstance(reasoning, dict) else {}
        unknown_reason = rrow.get("unknown_reason", "") if isinstance(rrow, dict) else ""
        if not unknown_reason and value == "unk":
            unknown_reason = live_row.get("unknown_reason", "")
        field_rows.append(
            {
                "field": key,
                "critical": key in critical,
                "status": "Collected" if known(value) else "Unknown",
                "value": value,
                "traffic": (
                    str(trow.get("color", "")).upper()
                    or str(live_row.get("traffic_color", "")).upper()
                    or "N/A"
                ),
                "unknown_reason": unknown_reason,
            }
        )
    known_count = sum(1 for row in field_rows if row["status"] == "Collected")
    crit_total = sum(1 for row in field_rows if row["critical"])
    crit_known = sum(1 for row in field_rows if row["critical"] and row["status"] == "Collected")
    if field_rows:
        p1, p2 = st.columns(2)
        p1.progress(known_count / max(len(field_rows), 1), text=f"Collected fields: {known_count}/{len(field_rows)}")
        p2.progress(crit_known / max(crit_total, 1) if crit_total else 0, text=f"Critical collected: {crit_known}/{crit_total}")
        st.dataframe(field_rows, use_container_width=True, height=520)
        st.caption(f"Unknown reason breakdown: {dict(Counter(row['unknown_reason'] for row in field_rows if row['status'] == 'Unknown'))}")

        availability_artifact = load_field_availability(category) or {}
        availability_fields = availability_artifact.get("fields", {}) if isinstance(availability_artifact, dict) else {}
        availability_rows = []
        expected_missing = 0
        sometimes_missing = 0
        rare_missing = 0
        for row in field_rows:
            f = row["field"]
            availability = availability_fields.get(f, {}) if isinstance(availability_fields, dict) else {}
            klass = str(availability.get("classification", "sometimes"))
            if row["status"] == "Unknown":
                if klass == "expected":
                    expected_missing += 1
                elif klass == "rare":
                    rare_missing += 1
                else:
                    sometimes_missing += 1
            availability_rows.append(
                {
                    "field": f,
                    "availability": klass,
                    "validated_seen": int(availability.get("validated_seen", 0) or 0),
                    "filled_rate_validated": float(availability.get("filled_rate_validated", 0) or 0),
                }
            )
        st.subheader("Field Availability Guidance")
        a1, a2, a3 = st.columns(3)
        a1.metric("Expected Missing", expected_missing, help="Expected fields should usually be found; hunt these first.")
        a2.metric("Sometimes Missing", sometimes_missing)
        a3.metric("Rare Missing", rare_missing, help="Rare fields are often not publicly disclosed.")
        with st.expander("Availability details for this product", expanded=False):
            st.dataframe(availability_rows, use_container_width=True, height=280)

    active_match = next((r for r in catalog["active"] if token(r["brand"]) == token(brand) and token(r["model"]) == token(model)), None)
    if active_match:
        st.subheader("Helper Target Snapshot")
        helper_known = {k: v for k, v in active_match["raw"].items() if k in set(order) and known(v)}
        total_schema_keys = max(len(order), 1)
        st.caption(
            f"activeFiltering populated schema keys: {len(helper_known)}/{total_schema_keys} "
            "(empty values in helper target will not fill specs)."
        )
        st.json(helper_known)

with tab3:
    filtered = events_for_product
    latest_run = latest_selected_run
    filtered_run = events_for_selected_run
    stage = pipeline_stage_status(filtered_run)
    counts = stage["counts"]
    is_running = bool(st.session_state.proc and st.session_state.proc.poll() is None)
    e1, e2, e3, e4 = st.columns(4)
    e1.metric("Events (Current Run)", len(filtered_run))
    e2.metric("Event Types", len(counts))
    e3.metric("Last Event", filtered_run[-1].get("event", "n/a") if filtered_run else "n/a")
    e4.metric("Event Log Bytes", EVENTS_PATH.stat().st_size if EVENTS_PATH.exists() else 0)
    st.caption(f"Run ID focus: `{latest_run or 'n/a'}`")
    st.progress(stage["progress_pct"] / 100.0, text=f"Pipeline Progress: {stage['progress_pct']:.0f}%")
    stage_rows = []
    active_assigned = False
    for item in stage["stages"]:
        if item["reached"]:
            state = "DONE"
        elif is_running and not active_assigned:
            state = "ACTIVE"
            active_assigned = True
        else:
            state = "PENDING"
        stage_rows.append(
            {
                "stage": item["label"],
                "status": state,
                "signals": ", ".join(item["events"]),
            }
        )
    st.dataframe(stage_rows, use_container_width=True, height=240)

    failure_total = sum(
        counts.get(name, 0)
        for name in (
            "llm_call_failed",
            "openai_call_failed",
            "llm_extract_failed",
            "llm_discovery_planner_failed",
            "llm_summary_failed",
            "source_fetch_failed",
        )
    )
    f1, f2, f3, f4 = st.columns(4)
    f1.metric("Fetch Failures", counts.get("source_fetch_failed", 0))
    f2.metric("LLM Failures", counts.get("llm_call_failed", 0) + counts.get("openai_call_failed", 0))
    f3.metric("Extraction Failures", counts.get("llm_extract_failed", 0))
    f4.metric("Total Failure Signals", failure_total)
    if counts.get("openai_call_failed", 0) > 0:
        st.info(
            "Legacy event detected: `openai_call_failed`. New runs now emit provider-aware `llm_call_failed`."
        )

    st.subheader("Event Legend")
    st.dataframe(event_rows_with_help(counts), use_container_width=True, height=260)

    tail = st.slider("Tail Events", min_value=20, max_value=1000, value=160, step=20)
    st.dataframe(filtered_run[-tail:], use_container_width=True, height=320)
    st.subheader("Process Output")
    st.caption(f"Process status: {'RUNNING' if is_running else 'IDLE'}")
    if st.session_state.last_cmd:
        st.caption(f"Last command: `{st.session_state.last_cmd}`")
    st.code("\n".join(st.session_state.proc_log[-260:]) or "No process output yet.", language="text")
    st.subheader("Queue Snapshot")
    qrows = list((catalog["queue"].get("products", {}) or {}).values())
    qrows.sort(key=lambda r: (str(r.get("status", "")), str(r.get("productId", ""))))
    st.dataframe(qrows[:400], use_container_width=True, height=300)

with tab4:
    monthly = load_billing_month() or {}
    totals = monthly.get("totals", {})
    b1, b2, b3, b4 = st.columns(4)
    b1.metric("Cost USD", f"{float(totals.get('cost_usd', 0)):.6f}")
    b2.metric("Calls", int(totals.get("calls", 0)))
    b3.metric("Prompt Tokens", int(totals.get("prompt_tokens", 0)))
    b4.metric("Completion Tokens", int(totals.get("completion_tokens", 0)))
    st.caption("By reason")
    st.json(monthly.get("by_reason", {}))
    st.caption("By model")
    st.json(monthly.get("by_model", {}))
    lroot = effective_learning_root() / category
    lfiles = []
    for name in ["field_lexicon.json", "constraints.json", "field_yield.json", "identity_grammar.json", "query_templates.json", "source_promotions.json", "stats.json"]:
        path = lroot / name
        lfiles.append({"file": name, "exists": path.exists(), "size_bytes": path.stat().st_size if path.exists() else 0, "updated_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat() if path.exists() else ""})
    st.subheader("Learning Artifacts")
    st.dataframe(lfiles, use_container_width=True, height=250)
    st.subheader("Component Library Counts")
    st.json({name: len(read_jsonl(COMPONENT_ROOT / f"{name}.jsonl", limit=10000)) for name in ("sensors", "switches", "encoders", "mcus")})
    st.subheader("Supportive Files")
    st.json(catalog["supportive"]["files"])

st.caption("Use dropdowns from helper targets, run a product, and monitor events/fields/costs in real time.")
if st.session_state.auto_refresh and st.session_state.proc and st.session_state.proc.poll() is None:
    time.sleep(1.5)
    st.rerun()
