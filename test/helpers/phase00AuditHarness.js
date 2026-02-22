import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IndexLabRuntimeBridge } from '../../src/indexlab/runtimeBridge.js';

export function createAuditHarness() {
  const wsEvents = [];
  const timestamps = [];
  let tempDir = '';
  let bridge = null;

  return {
    async setup() {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase00-audit-'));
      bridge = new IndexLabRuntimeBridge({
        outRoot: tempDir,
        onEvent: (row) => wsEvents.push({ ...row, _captured_at: Date.now() })
      });
      return bridge;
    },

    async feedEvent(row) {
      const ts = Date.now();
      timestamps.push({ event: row.event, fed_at: ts });
      bridge.onRuntimeEvent(row);
      await bridge.queue;
    },

    async feedEvents(rows) {
      for (const row of rows) {
        await this.feedEvent(row);
      }
    },

    async getEmittedEvents() {
      const eventsPath = bridge.eventsPath;
      if (!eventsPath) return [];
      try {
        const raw = await fs.readFile(eventsPath, 'utf8');
        return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },

    async getRunMeta() {
      const metaPath = bridge.runMetaPath;
      if (!metaPath) return null;
      try {
        const raw = await fs.readFile(metaPath, 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    async getNeedSet() {
      const needSetPath = bridge.needSetPath;
      if (!needSetPath) return null;
      try {
        const raw = await fs.readFile(needSetPath, 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    getWsEvents() {
      return [...wsEvents];
    },

    getBridge() {
      return bridge;
    },

    printAuditTrail(events) {
      const rows = events || [];
      if (rows.length === 0) {
        console.log('[AUDIT] No events captured');
        return;
      }
      const baseTs = Date.parse(rows[0].ts);
      console.log('[AUDIT] ── Event Trace ──');
      for (const evt of rows) {
        const offsetMs = Date.parse(evt.ts) - baseTs;
        const padded = String(offsetMs).padStart(8);
        const payloadKeys = evt.payload ? Object.keys(evt.payload).join(', ') : '(none)';
        console.log(`[${padded}ms] ${evt.stage}.${evt.event}  payload: {${payloadKeys}}`);
      }
      console.log(`[AUDIT] Total events: ${rows.length}`);
    },

    printTimingGaps(events) {
      const rows = events || [];
      if (rows.length < 2) return;
      console.log('[TIMING] ── Inter-Event Gaps ──');
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const curr = rows[i];
        const gapMs = Date.parse(curr.ts) - Date.parse(prev.ts);
        console.log(`[TIMING] ${prev.stage}.${prev.event} → ${curr.stage}.${curr.event} = ${gapMs}ms`);
      }
    },

    assertEnvelopeShape(event, label = '') {
      const prefix = label ? `[${label}] ` : '';
      const requiredKeys = ['run_id', 'ts', 'stage', 'event', 'payload'];
      for (const key of requiredKeys) {
        if (!(key in event)) {
          throw new Error(`${prefix}Missing envelope key "${key}" in event ${event.event || '(unknown)'}. Keys present: ${Object.keys(event).join(', ')}`);
        }
      }
      if (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) {
        throw new Error(`${prefix}payload must be a non-null object in event ${event.event}`);
      }
      if (!event.run_id) {
        throw new Error(`${prefix}run_id is empty in event ${event.event}`);
      }
      if (!event.ts) {
        throw new Error(`${prefix}ts is empty in event ${event.event}`);
      }
    },

    assertEventExists(events, eventName, label = '', payloadFilter = {}) {
      const filterKeys = Object.keys(payloadFilter);
      const found = events.find((e) => {
        if (e.event !== eventName) return false;
        if (filterKeys.length === 0) return true;
        return filterKeys.every((k) => e.payload?.[k] === payloadFilter[k]);
      });
      if (!found) {
        const available = [...new Set(events.map((e) => `${e.event}(scope=${e.payload?.scope || '?'})`))].join(', ');
        const filterDesc = filterKeys.length > 0 ? ` with ${JSON.stringify(payloadFilter)}` : '';
        throw new Error(`${label ? `[${label}] ` : ''}Expected event "${eventName}"${filterDesc} not found. Available: ${available}`);
      }
      return found;
    },

    assertPayloadHasKeys(event, keys, label = '') {
      const prefix = label ? `[${label}] ` : '';
      const missing = keys.filter((k) => !(k in event.payload));
      if (missing.length > 0) {
        const actual = Object.keys(event.payload).join(', ');
        throw new Error(`${prefix}Event "${event.event}" payload missing keys: ${missing.join(', ')}. Actual keys: ${actual}`);
      }
    },

    async cleanup() {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  };
}

export function makeRunStartedEvent(runId, overrides = {}) {
  return {
    event: 'run_started',
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    s3Key: 'specs/inputs/mouse/products/mouse-test.json',
    category: 'mouse',
    productId: 'mouse-test-product',
    ...overrides
  };
}

export function makeRunContextEvent(runId, overrides = {}) {
  return {
    event: 'run_context',
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    identity_fingerprint: 'fp_abc123',
    identity_lock_status: 'locked',
    dedupe_mode: 'content_hash',
    phase_cursor: 'phase_00_bootstrap',
    run_profile: 'indexlab',
    runtime_mode: 'single',
    ...overrides
  };
}

export function makeSearchEvent(runId, type, overrides = {}) {
  const base = {
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    category: 'mouse',
    productId: 'mouse-test-product'
  };
  if (type === 'query_started') {
    return { ...base, event: 'discovery_query_started', query: 'razer viper v3 pro specs', provider: 'searxng', ...overrides };
  }
  if (type === 'query_completed') {
    return { ...base, event: 'discovery_query_completed', query: 'razer viper v3 pro specs', provider: 'searxng', result_count: 10, duration_ms: 450, ...overrides };
  }
  return base;
}

export function makeFetchEvent(runId, type, overrides = {}) {
  const base = {
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    url: 'https://www.razer.com/gaming-mice/razer-viper-v3-pro',
    host: 'www.razer.com',
    category: 'mouse',
    productId: 'mouse-test-product'
  };
  if (type === 'started') {
    return { ...base, event: 'source_fetch_started', tier: 1, role: 'manufacturer', fetcher_kind: 'http', host_budget_score: 0.9, host_budget_state: 'healthy', ...overrides };
  }
  if (type === 'skipped') {
    return { ...base, event: 'source_fetch_skipped', skip_reason: 'cooldown', reason: 'host_cooldown', next_retry_ts: '', host_budget_score: 0.1, host_budget_state: 'blocked', ...overrides };
  }
  if (type === 'failed') {
    return { ...base, event: 'source_fetch_failed', message: 'ETIMEDOUT', fetch_ms: 30000, fetcher_kind: 'http', host_budget_score: 0.5, host_budget_state: 'degraded', ...overrides };
  }
  return base;
}

export function makeSourceProcessedEvent(runId, overrides = {}) {
  return {
    event: 'source_processed',
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    url: 'https://www.razer.com/gaming-mice/razer-viper-v3-pro',
    host: 'www.razer.com',
    category: 'mouse',
    productId: 'mouse-test-product',
    status: 200,
    candidate_count: 15,
    fetch_ms: 320,
    parse_ms: 45,
    fetch_attempts: 1,
    fetch_retry_count: 0,
    fetcher_kind: 'http',
    host_budget_score: 0.9,
    host_budget_state: 'healthy',
    final_url: 'https://www.razer.com/gaming-mice/razer-viper-v3-pro',
    content_type: 'text/html',
    content_hash: 'sha256_abc',
    bytes: 48221,
    article_title: 'Razer Viper V3 Pro',
    article_excerpt: 'Ultra-lightweight gaming mouse',
    article_quality_score: 0.85,
    article_char_count: 5200,
    article_extraction_method: 'readability',
    static_dom_mode: 'table_parse',
    static_dom_accepted_field_candidates: 12,
    static_dom_rejected_field_candidates: 3,
    structured_json_ld_count: 1,
    structured_candidates: 5,
    pdf_docs_parsed: 0,
    ...overrides
  };
}

export function makeFieldsFilledEvent(runId, overrides = {}) {
  return {
    event: 'fields_filled_from_source',
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    url: 'https://www.razer.com/gaming-mice/razer-viper-v3-pro',
    category: 'mouse',
    productId: 'mouse-test-product',
    count: 8,
    filled_fields: ['weight', 'sensor', 'dpi_max', 'polling_rate', 'battery_life', 'switches', 'shape', 'connectivity'],
    ...overrides
  };
}

export function makeLlmEvent(runId, type, overrides = {}) {
  const base = {
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    reason: 'extract_candidates',
    route_role: 'extract',
    model: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    max_tokens_applied: 4096,
    category: 'mouse',
    productId: 'mouse-test-product'
  };
  if (type === 'started') {
    return { ...base, event: 'llm_call_started', ...overrides };
  }
  if (type === 'completed') {
    return { ...base, event: 'llm_call_completed', prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000, ...overrides };
  }
  if (type === 'failed') {
    return { ...base, event: 'llm_call_failed', message: 'rate_limit_exceeded', ...overrides };
  }
  return base;
}

export function makeNeedsetComputedEvent(runId, overrides = {}) {
  return {
    event: 'needset_computed',
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    category: 'mouse',
    productId: 'mouse-test-product',
    total_fields: 60,
    needset_size: 25,
    size: 25,
    identity_lock_state: {
      status: 'locked',
      confidence: 0.95,
      identity_gate_validated: true,
      extraction_gate_open: true,
      family_model_count: 1,
      ambiguity_level: 'none',
      publishable: true,
      publish_blockers: [],
      reason_codes: [],
      page_count: 3,
      max_match_score: 0.98
    },
    identity_audit_rows: [],
    reason_counts: { missing: 15, low_confidence: 8, conflict: 2 },
    required_level_counts: { identity: 0, critical: 3, required: 12, expected: 8, optional: 2 },
    needs: [{ field: 'weight', need: 0.85, reason: 'missing' }],
    ...overrides
  };
}

export function makeRunCompletedEvent(runId, overrides = {}) {
  return {
    event: 'run_completed',
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    category: 'mouse',
    productId: 'mouse-test-product',
    identity_fingerprint: 'fp_abc123',
    identity_lock_status: 'locked',
    dedupe_mode: 'content_hash',
    phase_cursor: 'completed',
    confidence: 0.88,
    validated: true,
    missing_required_fields: ['weight'],
    critical_fields_below_pass_target: [],
    ...overrides
  };
}

export function makeEvidenceIndexEvent(runId, overrides = {}) {
  return {
    event: 'evidence_index_result',
    runId,
    ts: new Date().toISOString(),
    level: 'info',
    url: 'https://www.razer.com/gaming-mice/razer-viper-v3-pro',
    host: 'www.razer.com',
    doc_id: 'doc_abc',
    dedupe_outcome: 'new',
    chunks_indexed: 8,
    facts_indexed: 3,
    snippet_count: 5,
    ...overrides
  };
}

export function makeConvergenceEvents(runId) {
  return [
    {
      event: 'convergence_round_started',
      runId,
      ts: new Date().toISOString(),
      level: 'info',
      round: 0,
      mode: 'bootstrap',
      needset_size: 42,
      llm_target_field_count: 30,
      extra_query_count: 0
    },
    {
      event: 'convergence_round_completed',
      runId,
      ts: new Date().toISOString(),
      level: 'info',
      round: 0,
      needset_size: 42,
      missing_required_count: 10,
      critical_count: 3,
      confidence: 0.55,
      validated: false,
      improved: false,
      improvement_reasons: [],
      no_progress_streak: 0,
      low_quality_rounds: 0
    },
    {
      event: 'convergence_stop',
      runId,
      ts: new Date().toISOString(),
      level: 'info',
      stop_reason: 'complete',
      round_count: 1,
      complete: true,
      final_confidence: 0.90,
      final_needset_size: 10
    }
  ];
}
