# PHASE 11 — ADDENDUM: PRACTICAL CHATMOCK INTEGRATION ON WINDOWS (MODEL TIERING + AUTORECOVERY)

> **Purpose of this addendum:** make ChatMock a **24/7 reliable “Cortex sidecar”** on the same Windows machine as `spec-harvester`, with **smart model routing** so **GPT‑5 Low handles ~90%** of sidecar work and **GPT‑5 High / “5.2 High”** is used only for genuinely hard cases (vision, deep conflicts, last-mile gaps).

---

## THE PROBLEM

Spec-harvester needs to reliably **start**, **stop**, **health-check**, and **communicate** with ChatMock — both running on the same Windows machine. Three options:

| Approach | Pros | Cons |
|----------|------|------|
| **A. Shortcut in spec-harvester** | Simple | Fragile — no structured error feedback |
| **B. Copy entire ChatMock folder** | Self-contained | Two copies drift apart; updates break; wastes disk |
| **C. Docker Compose remote control** | Reliable, no copy needed, full lifecycle control | Requires Docker Desktop running |

**Winner: Option C.** Spec-harvester controls ChatMock’s Docker stack by pointing `docker compose` at the ChatMock directory. No copy, no shortcuts, full programmatic control.

---

## HOW IT WORKS

### Directory Layout (nothing moves)

```
C:\Users\Chris\Desktop\
├── ChatMock\                          ← stays here, single source of truth
│   ├── docker-compose.yml
│   ├── chatmock.py
│   ├── Dockerfile
│   ├── test-bench\
│   └── ...
│
└── spec-harvester\                    ← your main app
    ├── src\
    │   ├── llm\
    │   │   ├── cortex_client.js       ← connects to ChatMock APIs
    │   │   ├── cortex_router.js       ← routes tasks to correct model tier
    │   │   ├── cortex_health.js       ← health + circuit breaker
    │   │   └── cortex_lifecycle.js    ← start/stop/restart ChatMock (Docker)
    │   └── ...
    ├── scripts\
    │   └── chatmock-ctl.bat           ← optional local wrapper
    ├── .env
    └── ...
```

### The Key Insight

ChatMock is already Dockerized. Spec-harvester doesn’t need the source code — it just needs to:

1. **Tell Docker** to start/stop the stack (`docker compose -f <path> up -d`)
2. **Connect to the APIs** on localhost
   - Sync OpenAI-compatible API: `http://localhost:8000/v1/...`
   - Optional async orchestration API: `http://localhost:4000/api/...`
3. **Health-check** before sending requests
4. **Route 90% of sidecar work to GPT‑5 Low** and only escalate to High when needed

---

## 24/7 RELIABILITY REQUIREMENT (NON‑NEGOTIABLE)

### Compose restart policy (ChatMock should auto-come-back)

In `ChatMock/docker-compose.yml`, set:

```yaml
services:
  chatmock:
    restart: unless-stopped
```

This makes ChatMock recover from crashes / reboots without manual action.

> If you use Docker Desktop on Windows, this is the most reliable “keep it up” layer. The app layer still needs **circuit breaker + fallback** (below).

---

## IMPLEMENTATION

### 1) Environment Variables (spec-harvester `.env`)

```bash
# ── ChatMock Location & Connection ──
CHATMOCK_DIR=C:\Users\Chris\Desktop\ChatMock
CHATMOCK_COMPOSE_FILE=C:\Users\Chris\Desktop\ChatMock\docker-compose.yml

# ── Sync API (ChatMock proxy — OpenAI-compatible) ──
# IMPORTANT: this is a /v1 base because ChatMock exposes OpenAI endpoints under /v1
CORTEX_BASE_URL=http://localhost:8000/v1
CORTEX_API_KEY=key                     # Dummy — ChatMock ignores it

# ── Async API (Eval Bench middleman / job control) ──
CORTEX_ASYNC_BASE_URL=http://localhost:4000/api
CORTEX_ASYNC_ENABLED=true              # Use async submit/poll for long requests

# ───────────────────────────────────────────────────────────────
# MODEL TIERING (THE WHOLE POINT OF THIS REVISION)
# ───────────────────────────────────────────────────────────────
# GPT-5 Low does the “smart 90%”:
# - evidence audit
# - DOM reasoning / table reading when not image-only
# - quick conflict triage
# - query planning and dedupe decisions
#
# GPT-5 High (your “5.2 High” slot) is only for:
# - vision (screenshots)
# - deep conflicts on critical fields
# - “last 5%” missing critical fields after low pass
# - web search execution (if enabled) for critical gaps

# Default fast tier (most sidecar work)
CORTEX_MODEL_FAST=gpt-5-low

# Evidence audit tier (always low unless debugging)
CORTEX_MODEL_AUDIT=gpt-5-low

# DOM structural extraction (default low)
CORTEX_MODEL_DOM=gpt-5-low

# Reasoning escalation tier (deep)
CORTEX_MODEL_REASONING_DEEP=gpt-5-high

# Vision tier (deep)
CORTEX_MODEL_VISION=gpt-5-high

# Search planning (low) and execution (deep)
CORTEX_MODEL_SEARCH_FAST=gpt-5-low
CORTEX_MODEL_SEARCH_DEEP=gpt-5-high

# ── Escalation Rules ──
CORTEX_ESCALATE_CONFIDENCE_LT=0.85
CORTEX_ESCALATE_IF_CONFLICT=true
CORTEX_ESCALATE_CRITICAL_ONLY=true
CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT=12

# ── Timeouts ──
# Low tier should generally complete fast (sync).
# High tier should go async (avoid HTTP timeouts).
CORTEX_SYNC_TIMEOUT_MS=60000           # 60s for gpt-5-low sync calls
CORTEX_ASYNC_POLL_INTERVAL_MS=5000     # Poll async status every 5s
CORTEX_ASYNC_MAX_WAIT_MS=900000        # 15 min max wait for async result

# ── Lifecycle ──
CORTEX_AUTO_START=true                 # Auto-start ChatMock if health check fails
CORTEX_AUTO_RESTART_ON_AUTH=true       # If auth_required, emit event + fallback
```

---

### 2) Model Routing Policy (the “smart 90%”)

| Task type | Default model | Escalate to High when… |
|---|---|---|
| identity check / quick sanity | `gpt-5-low` | identity ambiguous after 2 attempts |
| evidence audit (quote_span + supports value) | `gpt-5-low` | audit fails on critical fields |
| DOM structural read | `gpt-5-low` | DOM is complex, truncated, or multiple variants + conflict |
| conflict resolution | `gpt-5-low` | critical field conflict, cross-tier contradiction |
| vision (screenshots) | `gpt-5-high` | (always) |
| web search planning | `gpt-5-low` | none |
| web search execution + synthesis | `gpt-5-high` | only for critical gaps |

**Guarantee:** High-tier usage is bounded by `CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT`.

---

## LIFECYCLE CONTROLLER (UPDATED)

### 3) Lifecycle Controller (`src/llm/cortex_lifecycle.js`)

Key updates:
- **Ready check** uses `GET /v1/models` (more reliable than “process is up”)
- base URL normalization is robust (doesn’t double-append `/v1`)
- used by router before sending any sidecar work

```javascript
/**
 * CortexLifecycle — Manages the ChatMock Docker stack from Node.js.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);

function stripTrailingV1(url) {
  return (url || '').replace(/\/v1\/?$/, '');
}

class CortexLifecycle {
  constructor(config) {
    this.composeFile = config.CHATMOCK_COMPOSE_FILE
      || path.join(config.CHATMOCK_DIR || '', 'docker-compose.yml');
    this.chatmockDir = config.CHATMOCK_DIR || path.dirname(this.composeFile);

    // CORTEX_BASE_URL is expected to be like http://localhost:8000/v1
    this.baseUrlNoV1 = stripTrailingV1(config.CORTEX_BASE_URL) || 'http://localhost:8000';

    this.autoStart = config.CORTEX_AUTO_START === 'true';
    this._startingUp = false;
  }

  async _compose(args, options = {}) {
    const composeArgs = ['compose', '-f', this.composeFile, ...args];
    try {
      const { stdout, stderr } = await execFileAsync('docker', composeArgs, {
        cwd: this.chatmockDir,
        timeout: options.timeout || 120000,
        windowsHide: true
      });
      return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
      return { ok: false, error: err.message, stderr: err.stderr?.trim() };
    }
  }

  async start() {
    if (this._startingUp) return { ok: true, status: 'already_starting' };
    this._startingUp = true;
    try {
      const dockerCheck = await this._compose(['version']);
      if (!dockerCheck.ok) {
        return { ok: false, error: 'Docker Desktop is not running. Start it first.' };
      }

      const up = await this._compose(['up', '-d'], { timeout: 180000 });
      if (!up.ok) return up;

      const healthy = await this._waitForReady(60000);
      return { ok: healthy, status: healthy ? 'started' : 'started_but_unready' };
    } finally {
      this._startingUp = false;
    }
  }

  async stop() { return this._compose(['down']); }

  async restart() {
    await this.stop();
    await new Promise(r => setTimeout(r, 3000));
    return this.start();
  }

  async rebuild() { return this._compose(['up', '-d', '--build'], { timeout: 300000 }); }

  async status() {
    const ps = await this._compose(['ps']);
    const running = ps.ok && ps.stdout.includes('chatmock') && ps.stdout.includes('running');

    if (!running) return { running: false, ready: false, models: [] };

    // READY CHECK: /v1/models
    try {
      const modelsRes = await fetch(`${this.baseUrlNoV1}/v1/models`, { signal: AbortSignal.timeout(5000) });
      if (!modelsRes.ok) return { running: true, ready: false, models: [] };
      const json = await modelsRes.json();
      const models = json.data?.map(m => m.id) || [];
      return { running: true, ready: true, models };
    } catch {
      return { running: true, ready: false, models: [] };
    }
  }

  async ensureRunning() {
    const s = await this.status();
    if (s.ready) return { ok: true, status: s };

    if (!s.running && this.autoStart) {
      const startResult = await this.start();
      return { ok: startResult.ok, status: await this.status() };
    }

    const ready = await this._waitForReady(15000);
    return { ok: ready, status: await this.status() };
  }

  async _waitForReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.baseUrlNoV1}/v1/models`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 3000));
    }
    return false;
  }
}

module.exports = { CortexLifecycle };
```

---

## ROUTER CHANGES (HOW TO USE LOW VS HIGH)

### 4) Router rule of thumb

- `gpt-5-low` → **sync API** (port 8000): fast, cheap, high throughput  
- `gpt-5-high` → **async API** (port 4000): slow, deep, scarce resource

### 5) Router pseudocode (model escalation)

```js
// For each product:
run_stage_1_deterministic();
run_stage_2_gemini();

run_cortex_low_pass({
  model: CORTEX_MODEL_FAST,
  tasks: [evidence_audit, dom_extract, conflict_triage, targeted_gap_fill]
});

if (critical_gaps_remain OR critical_conflicts_remain OR evidence_audit_failed_on_critical) {
  run_cortex_high_escalation({
    model: CORTEX_MODEL_REASONING_DEEP,
    tasks: [vision_extract, deep_conflict_resolution, web_search_for_critical_gaps]
  });
}
```

---

## OPTIONAL WINDOWS BATCH HELPER

### 6) Windows Batch Helper (`scripts/chatmock-ctl.bat`)

(unchanged from v1; keep as a convenience wrapper)

---

## WHY NOT COPY THE CHATMOCK FOLDER

Same reasons as v1; Docker Compose remote control is the stable approach.

---

## ACCEPTANCE CRITERIA (PHASE 11 ADDENDUM)

1) Spec-harvester can start/stop/restart ChatMock using `docker compose -f <path>`.  
2) Readiness check uses `/v1/models` and fails fast if ChatMock isn’t ready.  
3) 24/7 behavior: ChatMock restarts automatically via compose `restart: unless-stopped`.  
4) Router uses **GPT‑5 Low for the default pass**, and uses High only for escalation, bounded by `CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT`.  
5) If ChatMock is down/unavailable, spec-harvester falls back to non-sidecar execution and continues queue progression.

