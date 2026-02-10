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
    attempts_total: 0,
    last_run_id: '',
    last_summary: null,
    cost_usd_total_for_product: 0,
    rounds_completed: 0,
    next_action_hint: 'fast_pass',
    last_urls_attempted: [],
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
    attempts_total: toInt(current.attempts_total, 0),
    cost_usd_total_for_product: round(current.cost_usd_total_for_product || 0, 8),
    rounds_completed: toInt(current.rounds_completed, 0),
    last_urls_attempted: toArray(current.last_urls_attempted).slice(0, 300),
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

export function queueStateKey({ storage, category }) {
  return storage.resolveOutputKey('_queue', category, 'state.json');
}

export async function loadQueueState({ storage, category }) {
  const key = queueStateKey({ storage, category });
  const existing = await storage.readJsonOrNull(key);
  return {
    key,
    state: normalizeState(category, existing || {})
  };
}

export async function saveQueueState({ storage, category, state }) {
  const key = queueStateKey({ storage, category });
  const normalized = normalizeState(category, state);
  normalized.updated_at = nowIso();
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(normalized, null, 2), 'utf8'),
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
  if (status === 'complete' || status === 'exhausted' || status === 'blocked') {
    return Number.NEGATIVE_INFINITY;
  }

  const summary = row.last_summary || {};
  const missingRequired = toArray(summary.missing_required_fields).length;
  const criticalMissing = toArray(summary.critical_fields_below_pass_target).length;
  const contradictions = toInt(summary.contradiction_count, 0);
  const confidence = Number.parseFloat(String(summary.confidence || 0)) || 0;

  let score = 0;
  score += status === 'pending' ? 90 : 0;
  score += status === 'running' ? 40 : 0;
  score += status === 'needs_manual' ? 10 : 0;
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
