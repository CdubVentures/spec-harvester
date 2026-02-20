# PHASE 14 — RUNTIME OPS GUI (REAL‑TIME INSPECTOR + LIVE ADJUSTMENTS)

**Why this exists:** The current Streamlit GUI is already useful for *starting runs* and *seeing high-level progress*, but it does not let a human **observe the full truth** of what the pipeline is doing in real time:
- what queries were issued
- which URLs were selected and why
- what is currently being fetched / parsed / scanned
- what artifacts are being analyzed (DOM, JSON-LD, embedded state, network JSON, PDFs, images)
- what is being sent to each LLM (inputs/attachments) and what came back
- which fields just got filled, and from what source

Phase 14 upgrades the GUI into a **live, evidence-first “Operations Cockpit”** so you can:
- monitor the run like a workstation
- spot issues instantly (bad domains, wrong identity, low-yield sources)
- adjust behavior *while the run is happening* (budgets, blocks, retries, escalation policy)

> This is critical for fine tuning accuracy and performance in Phases 12–13 (Aggressive + Uber Aggressive), because you cannot optimize what you cannot see.

---

## 0) CURRENT GUI ANALYSIS (FROM `tools/gui/app.py` IN THE ZIP)

The current GUI has these good foundations:

### ✅ What it already does well
- **Starts CLI runs** from the GUI (ad-hoc, daemon once, daemon continuous)
- **Live auto-refresh** while a process is running (polls every ~1.5s)
- Uses `out/_runtime/events.jsonl` to render:
  - pipeline stage progress
  - event counts + legend
  - tail view of all events (raw)
  - process stdout log
- Shows a **product queue snapshot** (product-level queue)
- Shows **per-field status** (collected vs unknown) + traffic color in “Selected Product”
- Includes **billing/learning** snapshots
- Includes the **Review Grid** and override workflows (single product)

### ❌ What’s missing (what you’re asking for)
1) **Search visibility**
   - You cannot see *SERP results*, reranking decisions, and “why this URL”.
   - You can’t see the “search frontier” (what has already been tried / failed / cooldowned).

2) **URL queue visibility**
   - There is no live view of:
     - pending URLs to fetch
     - which URL is being fetched right now
     - per-domain throttling/cooldowns
     - repeated 404s and dead-end patterns

3) **Per-source inspection**
   - You can’t preview the page the pipeline is parsing:
     - DOM snapshot, table extraction
     - network JSON list
     - embedded app state
     - PDFs fetched and parsed
     - screenshots/images being used (if any)

4) **LLM transparency**
   - You can’t see:
     - what was sent to each AI call (prompt + evidence attachments)
     - which fields the call was targeting
     - what the model returned
     - whether parse/validation failed

5) **Field fill timeline**
   - The GUI shows final field status, but not **incremental “field gained from source X at time T”**.

6) **Live adjustment controls**
   - Beyond “Stop Process”, you can’t adjust:
     - budgets / max URLs
     - domain blocklist
     - escalation policy (low→high)
     - re-run / requeue actions
     - “pause/resume” in a safe way

---

# 1) MISSION (NON‑NEGOTIABLE)

Build a **real-time runtime GUI** that shows everything a human needs to understand the pipeline:

1) **Search**: queries issued, results, reranking decisions, and what was selected  
2) **Frontier**: URL queue, fetch status, cooldowns, repeated failure patterns  
3) **Inspection**: current page + artifacts (DOM, JSON, PDF, images) being analyzed  
4) **LLM Trace**: inputs/outputs/attachments/target fields per call (redaction safe)  
5) **Field Progress**: fields filled live, by source, with confidence and evidence pointers  
6) **Controls**: live knobs + safe intervention hooks (pause/block/retry/escalate)

---

# 2) DELIVERABLES

## Deliverable 14A — “Live Run Cockpit” Tab (single product)
Add a new major tab inside Streamlit: **Runtime Cockpit**

### Layout (1080p/1440p)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ RUN HEADER                                                                    │
│ [RUNNING/IDLE]  Product: mouse / Razer / Viper V3 Pro  RunId: abc123          │
│ Stage: Fetch(62%)  URLs: 8/25  404s: 2  LLM: 4 calls (low:4 high:0)  Cost:$0.03│
│ Controls: [Pause] [Resume] [Stop] [Requeue] [Block Domain] [Escalate Field]   │
├───────────────────────────┬───────────────────────────┬──────────────────────┤
│ SEARCH (left)             │ CURRENT URL INSPECTOR      │ LLM TRACE (right)    │
│ - queries issued          │ - URL + status + title     │ - call list           │
│ - SERP results + ranking  │ - screenshot preview (opt) │ - selected call detail│
│ - chosen URLs + reasons   │ - DOM/table/json/pdf tabs  │ - prompt preview      │
├───────────────────────────┴───────────────────────────┴──────────────────────┤
│ FIELD PROGRESS (bottom full width)                                            │
│ - live grid: field → value → conf → traffic → last_source → time → reason     │
│ - delta ticker: “+4 fields from rtings.com”                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Required behaviors
- Always show **the “current active URL”** (the latest `source_fetch_started` not yet completed).
- Always show **the last 10 URLs processed** with status + yield.
- Always show **the last 10 LLM calls** with model/provider/purpose and a drilldown.

---

## Deliverable 14B — “Fleet Monitor” Tab (daemon continuous)
A second view designed for 24/7:

- queue length (pending/running/complete/exhausted)
- currently running product
- recent failures (top domains, top status codes)
- throughput metrics (products/hour, avg runtime, cost/day)
- ability to:
  - pause daemon
  - skip current job
  - reprioritize a product
  - bulk “requeue exhausted” if policy changed

---

## Deliverable 14C — Runtime Trace Store (the GUI needs richer data than events alone)
Right now, `events.jsonl` is too small to store:
- SERP payloads
- HTML previews
- network JSON sample snippets
- LLM request/response bodies

We solve this by writing **small “event rows”** + **large “trace blobs”**.

### Directory layout (local mode)
```
out/_runtime/
  events.jsonl                          # small events (already exists)
  traces/
    runs/<runId>/<productId>/
      search/
        query_<hash>.json               # provider results + rerank output
      planner/
        queue_snapshot.json             # next N URLs, blocked hosts, stats
      fetch/
        fetch_<seq>.json                # url/meta + artifact refs
        screenshots/
          fetch_<seq>.webp              # optional
        html_preview/
          fetch_<seq>.html              # truncated preview (e.g. 200kb)
        network_preview/
          fetch_<seq>.json              # top N JSON responses summary
      llm/
        call_<seq>.json                 # prompt/attachments/response (redacted)
      fields/
        field_timeline.jsonl            # incremental updates (small rows)
  control/
    runtime_overrides.json              # live knobs (written by GUI)
```

### Storage principles
- **Events stay tiny** (fast + stable).
- **Traces are bounded** (ring buffer per run: keep last N=30 fetches and last N=50 llm calls).
- **Redaction on by default** for LLM content:
  - show field targets, evidence IDs, token counts
  - hide raw prompt unless “Developer Mode” is enabled

---

## Deliverable 14D — Event Schema Extensions (what to add)
You already have:
- `discovery_query_started/completed`
- `source_fetch_started`
- `source_processed`
- `llm_call_started/completed/usage`

Phase 14 adds *optional* richer event types (still small):

### Search events
- `discovery_serp_written`
  - `{ query, trace_path, result_count }`
- `discovery_urls_selected`
  - `{ selected_count, selected_hosts_top: [...], trace_path }`

### Planner/frontier events
- `planner_queue_snapshot_written`
  - `{ pending_count, blocked_hosts, trace_path }`
- `url_cooldown_applied`
  - `{ url, status, cooldown_seconds, reason }`

### Fetch/artifact events
- `fetch_trace_written`
  - `{ url, status, content_type, trace_path }`
- `artifact_written`
  - `{ kind: "screenshot|html_preview|network_preview|pdf", path }`

### Field progress events (critical)
- `fields_filled_from_source`
  - `{ url, host, filled_fields: [...], count }`
- `field_conflict_detected`
  - `{ field, value_a, value_b, sources: [...] }`

### LLM trace events
- `llm_trace_written`
  - `{ provider, model, purpose, target_fields_count, trace_path }`

---

## Deliverable 14E — Live Controls (adjustments while running)
Introduce a **control file** that the pipeline checks every few seconds.

### File: `out/_runtime/control/runtime_overrides.json`
Example:
```jsonc
{
  "pause": false,
  "max_urls_per_product": 35,
  "max_queries_per_product": 12,
  "blocked_domains": ["example.com", "spamreviews.net"],
  "force_high_fields": ["sensor", "max_dpi"],
  "disable_llm": false,
  "disable_search": false,
  "notes": "Temporarily blocking low-yield domains causing 404s"
}
```

### Pipeline behavior
- every ~3–5 seconds (or between URLs):
  - read this file (best effort)
  - apply overrides without restarting
- if `pause=true`:
  - finish current fetch (or abort safely)
  - stop dequeuing new URLs until pause=false

### GUI controls (buttons)
- Pause / Resume
- Block domain (from current URL host)
- Increase budgets (slider)
- Force escalate a field to `gpt-5-high`
- “Retry last query” / “Replace query”
- “Requeue product with new mode”

---

# 3) RUNTIME GUI FEATURES (WHAT YOU WILL SEE)

## 3A — Search Window (Queries + SERP + Reranking)
Show:
- queries issued (in order)
- provider (google/bing/searxng)
- results count
- **top results table**:
  - rank
  - url
  - host
  - snippet/title
  - rerank score
  - keep/drop reason
- “selected URLs” list with reasons:
  - identity match signal
  - field relevance signal
  - domain yield prior
  - dead-url penalty

**UX**
- click URL to open in browser
- filter by host
- copy query button
- show “already searched” indicator (from frontier memory)

---

## 3B — URL Frontier Window (Fetch Queue + Status)
Show:
- current pending URLs (next N)
- in-flight URL
- completed URLs with status + yield
- status histogram: 200/301/404/429/blocked
- per-domain throttle status (next allowed time)
- repeated 404 patterns (path signature)

**UX**
- click row → opens the “Current URL Inspector”
- button: “block this host”
- button: “cooldown this url now”
- button: “force retry once”

---

## 3C — Current URL Inspector (what page are we inspecting)
Tabs inside inspector:
1) **Overview**
   - url, finalUrl, status, title
   - tier/role (manufacturer/lab/database)
   - identity score + anchor status
2) **Screenshot** (optional)
3) **DOM Preview** (truncated html / readability)
4) **Tables**
   - extracted tables preview
5) **JSON-LD**
6) **Embedded State**
7) **Network JSON**
   - list of captured JSON endpoints
   - top N previews
8) **PDFs**
   - list pdf docs discovered/downloaded
   - preview text snippet

**UX**
- “Open URL”
- “Copy URL”
- “Download HTML preview”
- “Mark as bad source (block)”

---

## 3D — LLM Trace Window (what are we sending to each AI)
List view (last 50 calls):
- ts
- provider (chatmock / gemini / deepseek)
- model (gpt-5-low / gpt-5-high)
- purpose (plan/extract/validate/audit)
- target fields count
- tokens + cost (when available)
- latency
- status (ok/fail)

Detail view (for selected call):
- **Inputs**
  - target fields list
  - evidence refs used
  - attachments:
    - screenshot path (if any)
    - network json sample path
    - pdf text preview path
  - prompt preview (redacted by default)
- **Output**
  - parsed JSON
  - parse errors (if any)
  - “accepted fields” summary

**Important:** Provide a “Developer Mode” toggle to show raw prompt text and raw response. Off by default.

---

## 3E — Field Progress Window (live spec fill + evidence source)
A grid like:
- field
- value (current best)
- confidence
- traffic color
- last_updated_at
- last_source_host
- last_source_url
- method (deterministic / llm_extract / adapter / inference)
- needs_review flag
- unknown_reason / conflict_reason

Below it: “Delta ticker” feed:
- “+3 fields filled from razer.com”
- “Conflict detected: click_latency rtings vs techpowerup”
- “Evidence audit failed for max_dpi → set UNK”

---

# 4) IMPLEMENTATION TASKS (ENGINE + GUI)

## 4A — Add a RuntimeTraceWriter (Node)
Create `src/runtime/runtimeTraceWriter.js` that can:
- write small JSON blobs to `out/_runtime/traces/...`
- enforce ring buffer limits
- return paths for event references

Use it in:
- discovery (`searchDiscovery.js`) to write SERP trace files
- planner (`SourcePlanner`) to write queue snapshots occasionally
- runProduct after fetch to write fetch trace + previews
- openaiClient (and other clients) to write llm traces

---

## 4B — Add incremental field update events
Inside `runProduct.js`, after processing each source:
- compute `filled_fields` (already computed for planner field fill)
- emit `fields_filled_from_source` with:
  - url, host
  - filled_fields list (cap 40)
  - count

Optional: also emit `field_candidate_counts_by_source` for deeper analysis.

---

## 4C — Screenshot capture (optional, gated)
Add config:
- `RUNTIME_CAPTURE_SCREENSHOTS=true`
- `RUNTIME_SCREENSHOT_MODE=last_only|missing_fields_only|every_page`

In PlaywrightFetcher:
- if enabled, `await page.screenshot({ fullPage: true, type: 'webp', quality: 70 })`
- store via RuntimeTraceWriter
- log artifact path

---

## 4D — GUI changes (`tools/gui/app.py`)
Add a new tab: **Runtime Cockpit**
- Use `st.columns` + `st.container` to implement the 3-panel cockpit.
- Add sub-tabs inside the cockpit for:
  - Search
  - Frontier
  - Inspector
  - LLM
  - Fields

Add an “Advanced Controls” expander:
- show + edit `runtime_overrides.json`
- apply changes (write file)
- show last applied at timestamp

---

# 5) ACCEPTANCE CRITERIA

### Visibility
1) You can see **every search query** that ran, and the SERP URLs chosen.  
2) You can see **the URL queue** (pending, in-flight, completed) and status codes in real time.  
3) You can see **what page is being inspected** (URL + preview artifacts; screenshot optional).  
4) You can see **what is sent to each AI call** (at least target fields + evidence refs; raw prompt optional).  
5) You can see **fields filling live** with “last source” attribution.

### Adjustability
6) You can block a domain while running and the system stops using it.  
7) You can pause/resume safely without corrupting outputs.  
8) You can force escalation to `gpt-5-high` for specified fields without restarting.

### Performance Safety
9) Traces are bounded (ring buffer); runtime I/O does not explode disk usage.  
10) With cockpit enabled, throughput degradation is minimal (≤5–10% overhead in standard mode).

---

# 6) NOTES ON “MAKING IT PERFECT”

This Phase 14 GUI is not just “pretty”. It is the **feedback control surface** for the entire factory.

Once it exists, you can:
- identify low-yield domains and blacklist them early
- see repeated 404 patterns and confirm frontier cooldown logic is working
- spot identity mismatches instantly
- validate that LLM is only being used where it adds value
- confirm you’re scanning the right surfaces (DOM/JSON/PDF/network)

This is how you reach “24/7, always improving” in practice.

