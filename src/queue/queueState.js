import { nowIso } from '../utils/common.js';

function round(value, digits = 8) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}

function parseDateMs(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function retryBackoffSeconds(retryCount, {
  baseSeconds = 60,
  maxSeconds = 3600
} = {}) {
  const retry = Math.max(1, Number.parseInt(String(retryCount || 1), 10) || 1);
  const value = baseSeconds * (2 ** (retry - 1));
  return Math.min(maxSeconds, value);
}

function makeSummarySnapshot(summary = {}) {
  return {
    validated: Boolean(summary.validated),
    validated_reason: summary.validated_reason || '',
    missing_required_fields: toArray(summary.missing_required_fields),
    critical_fields_below_pass_target: toArray(summary.critical_fields_below_pass_target),
    fields_below_pass_target: toArray(summary.fields_below_pass_target),
    confidence: Number.parseFloat(String(summary.confidence || 0)) || 0,
    completeness_required: Number.parseFloat(String(summary.completeness_required || 0)) || 0,
    contradiction_count: toInt(summary.constraint_analysis?.contradiction_count, 0),
    identity_gate_validated: Boolean(summary.identity_gate_validated),
    llm_budget_blocked_reason: summary.llm?.budget?.blocked_reason || '',
    sources_attempted: toInt(summary.sources_attempted, 0),
    generated_at: summary.generated_at || nowIso()
  };
}

function rowDefaults(productId, s3key = '') {
  return {
    productId,
    s3key,
    status: 'pending',
    priority: 3,
    attempts_total: 0,
    retry_count: 0,
    max_attempts: 3,
    next_retry_at: '',
    last_run_id: '',
    last_summary: null,
    cost_usd_total_for_product: 0,
    rounds_completed: 0,
    next_action_hint: 'fast_pass',
    last_urls_attempted: [],
    last_error: '',
    last_failed_at: '',
    last_started_at: '',
    last_completed_at: '',
    updated_at: nowIso()
  };
}

function normalizeProductRow(productId, current = {}) {
  const base = rowDefaults(productId, current.s3key || '');
  return {
    ...base,
    ...current,
    productId,
    status: String(current.status || base.status),
    priority: Math.max(1, Math.min(5, toInt(current.priority, base.priority))),
    attempts_total: toInt(current.attempts_total, 0),
    retry_count: toInt(current.retry_count, 0),
    max_attempts: Math.max(1, toInt(current.max_attempts, 3)),
    next_retry_at: String(current.next_retry_at || '').trim(),
    cost_usd_total_for_product: round(current.cost_usd_total_for_product || 0, 8),
    rounds_completed: toInt(current.rounds_completed, 0),
    last_urls_attempted: toArray(current.last_urls_attempted).slice(0, 300),
    last_error: String(current.last_error || '').trim(),
    last_failed_at: String(current.last_failed_at || '').trim(),
    updated_at: current.updated_at || nowIso()
  };
}

function stateDefaults(category) {
  return {
    category,
    updated_at: nowIso(),
    products: {}
  };
}

function normalizeState(category, input = {}) {
  const output = stateDefaults(category);
  output.updated_at = input.updated_at || output.updated_at;
  output.products = {};
  for (const [productId, row] of Object.entries(input.products || {})) {
    output.products[productId] = normalizeProductRow(productId, row);
  }
  return output;
}

function modernQueueStateKey(category) {
  return `_queue/${String(category || '').trim()}/state.json`;
}

function legacyQueueStateKey(storage, category) {
  return storage.resolveOutputKey('_queue', category, 'state.json');
}

export function queueStateKey({ storage, category }) {
  const token = String(category || '').trim();
  if (!token) {
    return '_queue/unknown/state.json';
  }
  return modernQueueStateKey(token);
}

async function readQueueJsonSafe(storage, key) {
  try {
    return {
      data: await storage.readJsonOrNull(key),
      corrupt: false
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        data: null,
        corrupt: true
      };
    }
    throw error;
  }
}

export async function loadQueueState({ storage, category }) {
  const key = queueStateKey({ storage, category });
  const legacyKey = legacyQueueStateKey(storage, category);
  const modern = await readQueueJsonSafe(storage, key);
  const legacy = await readQueueJsonSafe(storage, legacyKey);
  const existing = modern.data || legacy.data;
  return {
    key,
    state: normalizeState(category, existing || {}),
    recovered_from_corrupt_state: Boolean((modern.corrupt || legacy.corrupt) && !existing)
  };
}

export async function saveQueueState({ storage, category, state }) {
  const key = queueStateKey({ storage, category });
  const legacyKey = legacyQueueStateKey(storage, category);
  const normalized = normalizeState(category, state);
  normalized.updated_at = nowIso();
  const payload = Buffer.from(JSON.stringify(normalized, null, 2), 'utf8');
  await storage.writeObject(
    key,
    payload,
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    legacyKey,
    payload,
    { contentType: 'application/json' }
  );
  return { key, state: normalized };
}

export async function upsertQueueProduct({
  storage,
  category,
  productId,
  s3key = '',
  patch = {}
}) {
  const loaded = await loadQueueState({ storage, category });
  const current = normalizeProductRow(productId, loaded.state.products[productId] || { s3key });
  const next = normalizeProductRow(productId, {
    ...current,
    ...patch,
    s3key: patch.s3key || current.s3key || s3key,
    updated_at: nowIso()
  });
  loaded.state.products[productId] = next;
  const saved = await saveQueueState({ storage, category, state: loaded.state });
  return {
    key: saved.key,
    product: next
  };
}

export async function syncQueueFromInputs({
  storage,
  category
}) {
  const loaded = await loadQueueState({ storage, category });
  const keys = await storage.listInputKeys(category);
  let added = 0;

  for (const key of keys) {
    const productId = String(key).split('/').pop()?.replace(/\.json$/i, '') || '';
    if (!productId) {
      continue;
    }
    if (!loaded.state.products[productId]) {
      loaded.state.products[productId] = normalizeProductRow(productId, {
        s3key: key,
        status: 'pending',
        next_action_hint: 'fast_pass'
      });
      added += 1;
      continue;
    }

    if (!loaded.state.products[productId].s3key) {
      loaded.state.products[productId].s3key = key;
      loaded.state.products[productId].updated_at = nowIso();
    }
  }

  if (added > 0) {
    await saveQueueState({ storage, category, state: loaded.state });
  }

  return {
    added,
    total_products: Object.keys(loaded.state.products).length,
    state: loaded.state
  };
}

function scoreQueueRow(row) {
  const status = String(row.status || 'pending');
  if (
    status === 'complete' ||
    status === 'blocked' ||
    status === 'paused' ||
    status === 'skipped' ||
    status === 'in_progress' ||
    status === 'needs_manual' ||
    status === 'exhausted' ||
    status === 'failed'
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  const nowMs = Date.now();
  const nextRetryMs = parseDateMs(row.next_retry_at);
  if (nextRetryMs !== null && nextRetryMs > nowMs) {
    return Number.NEGATIVE_INFINITY;
  }

  const summary = row.last_summary || {};
  const missingRequired = toArray(summary.missing_required_fields).length;
  const criticalMissing = toArray(summary.critical_fields_below_pass_target).length;
  const contradictions = toInt(summary.contradiction_count, 0);
  const confidence = Number.parseFloat(String(summary.confidence || 0)) || 0;

  let score = 0;
  score += status === 'pending' ? 90 : 0;
  score += status === 'stale' ? 35 : 0;
  score += status === 'running' ? 40 : 0;
  score += status === 'needs_manual' ? 10 : 0;
  score += (6 - Math.max(1, Math.min(5, toInt(row.priority, 3)))) * 12;
  score += missingRequired * 10;
  score += criticalMissing * 16;
  score += contradictions * 6;
  score += Math.max(0, 1 - confidence) * 12;
  score -= Math.max(0, toInt(row.attempts_total, 0)) * 4;
  score -= Math.max(0, toInt(row.rounds_completed, 0)) * 3;
  if (status === 'blocked') {
    score -= 50;
  }
  return score;
}

export function selectNextQueueProduct(queueState) {
  const rows = Object.values(queueState.products || {});
  const ranked = rows
    .map((row) => ({
      ...row,
      queue_score: scoreQueueRow(row)
    }))
    .filter((row) => Number.isFinite(row.queue_score))
    .sort((a, b) => b.queue_score - a.queue_score || a.productId.localeCompare(b.productId));

  return ranked[0] || null;
}

function dedupeUrls(urls = [], limit = 250) {
  return [...new Set(urls.filter(Boolean))].slice(-Math.max(1, limit));
}

function inferQueueStatus({
  previousStatus,
  summary,
  roundResult,
  budgetExceeded = false
}) {
  if (summary?.validated) {
    return 'complete';
  }
  if (budgetExceeded) {
    return 'exhausted';
  }
  const llmBlocked = String(summary?.llm?.budget?.blocked_reason || '');
  if (llmBlocked && llmBlocked.includes('budget')) {
    return 'needs_manual';
  }

  if (roundResult?.exhausted) {
    return 'exhausted';
  }

  if (summary?.identity_gate_validated === false) {
    return 'needs_manual';
  }
  return previousStatus === 'pending' ? 'running' : previousStatus || 'running';
}

export async function recordQueueRunResult({
  storage,
  category,
  s3key,
  result,
  roundResult = {}
}) {
  const productId = String(result?.productId || '').trim();
  if (!productId) {
    throw new Error('recordQueueRunResult requires result.productId');
  }

  const loaded = await loadQueueState({ storage, category });
  const current = normalizeProductRow(productId, loaded.state.products[productId] || { s3key });
  const summary = result?.summary || {};
  const snapshot = makeSummarySnapshot(summary);
  const runCost = Number.parseFloat(String(summary.llm?.cost_usd_run || 0)) || 0;
  const queueStatus = inferQueueStatus({
    previousStatus: current.status,
    summary,
    roundResult,
    budgetExceeded: Boolean(roundResult?.budgetExceeded)
  });

  const next = normalizeProductRow(productId, {
    ...current,
    s3key: current.s3key || s3key,
    status: queueStatus,
    attempts_total: current.attempts_total + 1,
    last_run_id: result.runId || current.last_run_id,
    last_summary: snapshot,
    cost_usd_total_for_product: round(current.cost_usd_total_for_product + runCost, 8),
    rounds_completed: current.rounds_completed + 1,
    next_action_hint: roundResult.nextActionHint || current.next_action_hint || '',
    last_urls_attempted: dedupeUrls([
      ...(current.last_urls_attempted || []),
      ...(result?.normalized?.sources?.urls || []),
      ...(summary?.source_summary?.urls || []),
      ...(summary?.sources?.urls || [])
    ]),
    last_completed_at: nowIso(),
    updated_at: nowIso()
  });

  loaded.state.products[productId] = next;
  const saved = await saveQueueState({ storage, category, state: loaded.state });
  return {
    key: saved.key,
    product: next
  };
}

export async function recordQueueFailure({
  storage,
  category,
  productId,
  s3key = '',
  error,
  baseRetrySeconds = 60,
  maxRetrySeconds = 3600
}) {
  const loaded = await loadQueueState({ storage, category });
  const current = normalizeProductRow(productId, loaded.state.products[productId] || { s3key });
  const retryCount = current.retry_count + 1;
  const nextDelaySeconds = retryBackoffSeconds(retryCount, {
    baseSeconds: baseRetrySeconds,
    maxSeconds: maxRetrySeconds
  });
  const nextRetryAt = new Date(Date.now() + nextDelaySeconds * 1000).toISOString();
  const failedHard = retryCount >= current.max_attempts;

  const next = normalizeProductRow(productId, {
    ...current,
    s3key: current.s3key || s3key,
    status: failedHard ? 'failed' : 'pending',
    attempts_total: current.attempts_total + 1,
    retry_count: retryCount,
    next_retry_at: failedHard ? '' : nextRetryAt,
    last_error: String(error?.message || error || '').slice(0, 2000),
    last_failed_at: nowIso(),
    next_action_hint: failedHard ? 'manual_or_retry' : 'retry_backoff',
    updated_at: nowIso()
  });

  loaded.state.products[productId] = next;
  const saved = await saveQueueState({ storage, category, state: loaded.state });
  return {
    key: saved.key,
    product: next
  };
}

export async function markStaleQueueProducts({
  storage,
  category,
  staleAfterDays = 30,
  nowIso: nowIsoOverride = null
}) {
  const loaded = await loadQueueState({ storage, category });
  const nowMs = parseDateMs(nowIsoOverride || nowIso()) || Date.now();
  const staleThresholdMs = Math.max(1, Number(staleAfterDays || 30)) * 24 * 60 * 60 * 1000;
  const marked = [];

  for (const [productId, row] of Object.entries(loaded.state.products || {})) {
    const status = String(row.status || '').trim().toLowerCase();
    if (status !== 'complete') {
      continue;
    }
    const completedMs = parseDateMs(row.last_completed_at);
    if (completedMs === null) {
      continue;
    }
    if ((nowMs - completedMs) < staleThresholdMs) {
      continue;
    }
    loaded.state.products[productId] = normalizeProductRow(productId, {
      ...row,
      status: 'stale',
      next_action_hint: 'recrawl_stale',
      updated_at: nowIso()
    });
    marked.push(productId);
  }

  if (marked.length > 0) {
    await saveQueueState({ storage, category, state: loaded.state });
  }
  return {
    stale_marked: marked.length,
    products: marked
  };
}

export async function listQueueProducts({
  storage,
  category,
  status = '',
  limit = 200
}) {
  const loaded = await loadQueueState({ storage, category });
  const wantedStatus = String(status || '').trim().toLowerCase();
  const rows = Object.values(loaded.state.products || {})
    .filter((row) => !wantedStatus || String(row.status || '').trim().toLowerCase() === wantedStatus)
    .sort((a, b) => {
      const aPriority = toInt(a.priority, 3);
      const bPriority = toInt(b.priority, 3);
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      const aUpdated = parseDateMs(a.updated_at) || 0;
      const bUpdated = parseDateMs(b.updated_at) || 0;
      if (bUpdated !== aUpdated) {
        return bUpdated - aUpdated;
      }
      return String(a.productId || '').localeCompare(String(b.productId || ''));
    })
    .slice(0, Math.max(1, Number(limit || 200)));
  return rows;
}

export async function clearQueueByStatus({
  storage,
  category,
  status
}) {
  const wantedStatus = String(status || '').trim().toLowerCase();
  if (!wantedStatus) {
    throw new Error('clearQueueByStatus requires status');
  }
  const loaded = await loadQueueState({ storage, category });
  const removed = [];
  for (const [productId, row] of Object.entries(loaded.state.products || {})) {
    if (String(row.status || '').trim().toLowerCase() !== wantedStatus) {
      continue;
    }
    delete loaded.state.products[productId];
    removed.push(productId);
  }
  if (removed.length > 0) {
    await saveQueueState({ storage, category, state: loaded.state });
  }
  return {
    removed_count: removed.length,
    removed_product_ids: removed
  };
}

export async function markQueueRunning({
  storage,
  category,
  productId,
  s3key,
  nextActionHint = 'fast_pass'
}) {
  const loaded = await loadQueueState({ storage, category });
  const current = normalizeProductRow(productId, loaded.state.products[productId] || { s3key });
  const next = normalizeProductRow(productId, {
    ...current,
    s3key: current.s3key || s3key,
    status: 'running',
    next_action_hint: nextActionHint,
    last_started_at: nowIso(),
    updated_at: nowIso()
  });
  loaded.state.products[productId] = next;
  const saved = await saveQueueState({ storage, category, state: loaded.state });
  return {
    key: saved.key,
    product: next
  };
}
