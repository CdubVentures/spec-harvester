import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path

import streamlit as st


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_ROOT = os.environ.get("LOCAL_OUTPUT_ROOT", "out")
OUTPUT_ROOT = (REPO_ROOT / DEFAULT_OUTPUT_ROOT).resolve()
EVENTS_PATH = OUTPUT_ROOT / "_runtime" / "events.jsonl"
FINAL_ROOT = OUTPUT_ROOT / "final"
LEGACY_QUEUE_ROOT = OUTPUT_ROOT / "specs" / "outputs" / "_queue"
MODERN_QUEUE_ROOT = OUTPUT_ROOT / "_queue"
LEGACY_BILLING_ROOT = OUTPUT_ROOT / "specs" / "outputs" / "_billing"
MODERN_BILLING_ROOT = OUTPUT_ROOT / "_billing"
COMPONENT_ROOT = OUTPUT_ROOT / "_components"
LEARNING_ROOT_LEGACY = OUTPUT_ROOT / "specs" / "outputs" / "_learning"
LEARNING_ROOT_MODERN = OUTPUT_ROOT / "_learning"


def read_json(path: Path, default=None):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def read_jsonl(path: Path, limit: int = 500):
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows[-limit:]


def list_final_products():
    rows = []
    if not FINAL_ROOT.exists():
        return rows
    for category_dir in FINAL_ROOT.iterdir():
        if not category_dir.is_dir():
            continue
        for brand_dir in category_dir.iterdir():
            if not brand_dir.is_dir():
                continue
            for model_dir in brand_dir.iterdir():
                if not model_dir.is_dir():
                    continue
                summary_path = model_dir / "summary.json"
                if summary_path.exists():
                    rows.append(
                        {
                            "category": category_dir.name,
                            "brand": brand_dir.name,
                            "model": model_dir.name,
                            "variant": "",
                            "path": model_dir,
                            "summary": read_json(summary_path, {}),
                        }
                    )
                for variant_dir in model_dir.iterdir():
                    if not variant_dir.is_dir():
                        continue
                    summary_path = variant_dir / "summary.json"
                    if summary_path.exists():
                        rows.append(
                            {
                                "category": category_dir.name,
                                "brand": brand_dir.name,
                                "model": model_dir.name,
                                "variant": variant_dir.name,
                                "path": variant_dir,
                                "summary": read_json(summary_path, {}),
                            }
                        )
    return rows


def queue_root():
    if MODERN_QUEUE_ROOT.exists():
        return MODERN_QUEUE_ROOT
    return LEGACY_QUEUE_ROOT


def billing_root():
    if MODERN_BILLING_ROOT.exists():
        return MODERN_BILLING_ROOT
    return LEGACY_BILLING_ROOT


def learning_root():
    if LEARNING_ROOT_MODERN.exists():
        return LEARNING_ROOT_MODERN
    return LEARNING_ROOT_LEGACY


def load_queue_state(category: str):
    root = queue_root()
    return read_json(root / category / "state.json", {"products": {}})


def current_month():
    return datetime.utcnow().strftime("%Y-%m")


def monthly_billing():
    root = billing_root()
    return read_json(root / "monthly" / f"{current_month()}.json", {})


def component_counts():
    files = {
        "sensors": COMPONENT_ROOT / "sensors.jsonl",
        "switches": COMPONENT_ROOT / "switches.jsonl",
        "encoders": COMPONENT_ROOT / "encoders.jsonl",
        "mcus": COMPONENT_ROOT / "mcus.jsonl",
    }
    out = {}
    for name, file_path in files.items():
        out[name] = len(read_jsonl(file_path, limit=10_000))
    return out


def run_cli_async(args):
    cmd = ["node", "src/cli/spec.js"] + args
    return subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def ensure_proc_state():
    if "proc" not in st.session_state:
        st.session_state.proc = None
    if "proc_log" not in st.session_state:
        st.session_state.proc_log = []


def poll_process_output():
    proc = st.session_state.proc
    if not proc:
        return
    if proc.stdout:
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            st.session_state.proc_log.append(line.rstrip())
            st.session_state.proc_log = st.session_state.proc_log[-400:]
    if proc.poll() is not None:
        st.session_state.proc = None


st.set_page_config(page_title="Spec Factory Dashboard", layout="wide")
ensure_proc_state()
poll_process_output()

st.title("Spec Factory Dashboard")
st.caption(f"Repo: {REPO_ROOT}")
st.caption(f"Output root: {OUTPUT_ROOT}")

with st.sidebar:
    st.header("Run Controls")
    category = st.text_input("Category", value="mouse")
    brand = st.text_input("Brand", value="Logitech")
    model = st.text_input("Model", value="G Pro X Superlight 2")
    variant = st.text_input("Variant (optional)", value="")
    mode = st.selectbox("Mode", ["aggressive", "balanced"], index=0)

    if st.button("Run One Product (Until Complete)", use_container_width=True):
        args = [
            "run-ad-hoc",
            category,
            brand,
            model,
            "--until-complete",
            "--mode",
            mode,
            "--local",
        ]
        if variant.strip():
            args.insert(4, variant.strip())
        st.session_state.proc = run_cli_async(args)
        st.session_state.proc_log = [f"Started: {' '.join(args)}"]

    if st.button("Run Daemon Once", use_container_width=True):
        args = ["daemon", "--category", category, "--mode", mode, "--once", "--local"]
        st.session_state.proc = run_cli_async(args)
        st.session_state.proc_log = [f"Started: {' '.join(args)}"]

    if st.button("Run Daemon (Continuous)", use_container_width=True):
        args = ["daemon", "--category", category, "--mode", mode, "--local"]
        st.session_state.proc = run_cli_async(args)
        st.session_state.proc_log = [f"Started: {' '.join(args)}"]

    if st.button("Stop Active Process", use_container_width=True):
        proc = st.session_state.proc
        if proc:
            proc.terminate()
            st.session_state.proc = None
            st.session_state.proc_log.append("Process terminated by user.")

    if st.button("Refresh", use_container_width=True):
        st.rerun()

col1, col2 = st.columns([2, 1])

with col1:
    st.subheader("Live Runtime Events")
    event_rows = read_jsonl(EVENTS_PATH, limit=1200)
    if not event_rows:
        st.info("No runtime events yet. Start a run to populate _runtime/events.jsonl.")
    else:
        tail_count = st.slider("Tail events", 20, 500, 120, 20)
        tail_rows = event_rows[-tail_count:]
        st.dataframe(tail_rows, use_container_width=True, height=350)

    st.subheader("Active Process Output")
    st.code("\n".join(st.session_state.proc_log[-200:]) or "No process output yet.", language="text")

    st.subheader("Queue Snapshot")
    queue_state = load_queue_state(category)
    products = list((queue_state or {}).get("products", {}).values())
    products.sort(key=lambda row: (row.get("status", ""), row.get("productId", "")))
    st.write(f"Products in queue for `{category}`: {len(products)}")
    st.dataframe(products[:200], use_container_width=True, height=320)

with col2:
    st.subheader("Monthly Billing")
    billing = monthly_billing() or {}
    totals = (billing or {}).get("totals", {})
    st.metric("Cost (USD)", f"{float(totals.get('cost_usd', 0)):.6f}")
    st.metric("Calls", int(totals.get("calls", 0)))
    st.metric("Prompt Tokens", int(totals.get("prompt_tokens", 0)))
    st.metric("Completion Tokens", int(totals.get("completion_tokens", 0)))

    st.subheader("Learning Artifacts")
    learning_dir = learning_root() / category
    learning_files = [
        "field_lexicon.json",
        "constraints.json",
        "field_yield.json",
        "identity_grammar.json",
        "query_templates.json",
        "stats.json",
    ]
    learning_rows = []
    for name in learning_files:
        p = learning_dir / name
        learning_rows.append(
            {
                "file": name,
                "exists": p.exists(),
                "size_bytes": p.stat().st_size if p.exists() else 0,
                "updated_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat() if p.exists() else "",
            }
        )
    st.dataframe(learning_rows, use_container_width=True, height=220)

    st.subheader("Component Library")
    counts = component_counts()
    st.json(counts)

st.subheader("Final Outputs")
final_rows = list_final_products()
if not final_rows:
    st.info("No final outputs yet.")
else:
    table = []
    for row in final_rows:
        summary = row.get("summary", {})
        table.append(
            {
                "category": row["category"],
                "brand": row["brand"],
                "model": row["model"],
                "variant": row["variant"],
                "validated": bool(summary.get("validated", False)),
                "confidence": float(summary.get("confidence", 0)),
                "completeness_required": float(summary.get("completeness_required", 0)),
                "path": str(row["path"]),
            }
        )
    st.dataframe(table, use_container_width=True, height=260)

st.caption("Tip: enable auto-refresh with your browser or click Refresh while a run is active.")
time.sleep(0.05)
