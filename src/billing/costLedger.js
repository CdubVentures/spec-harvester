import { nowIso } from '../utils/common.js';

function round(value, digits = 8) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function monthFromTs(ts = nowIso()) {
  return String(ts).slice(0, 7);
}

function dayFromTs(ts = nowIso()) {
  return String(ts).slice(0, 10);
}

function ledgerKey(storage, month) {
  return storage.resolveOutputKey('_billing', 'ledger', `${month}.jsonl`);
}

function flatLedgerKey(storage) {
  return storage.resolveOutputKey('_billing', 'ledger.jsonl');
}

function monthlyRollupKey(storage, month) {
  return storage.resolveOutputKey('_billing', 'monthly', `${month}.json`);
}

function normalizeEntry(entry = {}) {
  const ts = entry.ts || nowIso();
  return {
    ts,
    provider: String(entry.provider || 'unknown'),
    model: String(entry.model || 'unknown'),
    category: String(entry.category || ''),
    productId: String(entry.productId || ''),
    runId: String(entry.runId || ''),
    round: safeInt(entry.round, 0),
    prompt_tokens: safeInt(entry.prompt_tokens, 0),
    completion_tokens: safeInt(entry.completion_tokens, 0),
    cached_prompt_tokens: safeInt(entry.cached_prompt_tokens, 0),
    total_tokens: safeInt(entry.total_tokens, 0),
    cost_usd: round(entry.cost_usd, 8),
    reason: String(entry.reason || 'extract'),
    host: String(entry.host || ''),
    url_count: safeInt(entry.url_count, 0),
    evidence_chars: safeInt(entry.evidence_chars, 0),
    estimated_usage: Boolean(entry.estimated_usage),
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {}
  };
}

function parseLedgerText(text) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed ledger line
    }
  }
  return rows;
}

function serializeLedgerRows(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

function bumpBucket(map, key, patch) {
  if (!key) {
    return;
  }
  if (!map[key]) {
    map[key] = {
      cost_usd: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      calls: 0
    };
  }
  const bucket = map[key];
  bucket.cost_usd = round(bucket.cost_usd + patch.cost_usd, 8);
  bucket.prompt_tokens += patch.prompt_tokens;
  bucket.completion_tokens += patch.completion_tokens;
  bucket.calls += patch.calls;
}

function emptyRollup(month) {
  return {
    month,
    generated_at: nowIso(),
    totals: {
      cost_usd: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      calls: 0
    },
    by_day: {},
    by_category: {},
    by_product: {},
    by_model: {},
    by_reason: {}
  };
}

function applyEntryToRollup(rollup, entry) {
  const patch = {
    cost_usd: round(entry.cost_usd || 0, 8),
    prompt_tokens: safeInt(entry.prompt_tokens, 0),
    completion_tokens: safeInt(entry.completion_tokens, 0),
    calls: 1
  };

  rollup.generated_at = nowIso();
  rollup.totals.cost_usd = round(rollup.totals.cost_usd + patch.cost_usd, 8);
  rollup.totals.prompt_tokens += patch.prompt_tokens;
  rollup.totals.completion_tokens += patch.completion_tokens;
  rollup.totals.calls += 1;

  bumpBucket(rollup.by_day, dayFromTs(entry.ts), patch);
  bumpBucket(rollup.by_category, entry.category, patch);
  bumpBucket(rollup.by_product, entry.productId, patch);
  bumpBucket(rollup.by_model, `${entry.provider}:${entry.model}`, patch);
  bumpBucket(rollup.by_reason, entry.reason, patch);
}

export async function readMonthlyRollup({ storage, month }) {
  const key = monthlyRollupKey(storage, month);
  return (await storage.readJsonOrNull(key)) || emptyRollup(month);
}

export async function readLedgerMonth({ storage, month }) {
  const key = ledgerKey(storage, month);
  const text = await storage.readTextOrNull(key);
  return parseLedgerText(text);
}

export async function writeMonthlyRollup({ storage, month, rollup }) {
  const key = monthlyRollupKey(storage, month);
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(rollup, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  return key;
}

export async function appendCostLedgerEntry({
  storage,
  config,
  entry
}) {
  if (!storage || !config || !entry) {
    return { entry: null, ledgerKey: null, monthlyRollupKey: null };
  }

  const normalized = normalizeEntry(entry);
  const month = monthFromTs(normalized.ts);
  const key = ledgerKey(storage, month);
  const flatKey = flatLedgerKey(storage);
  const previous = await storage.readTextOrNull(key);
  const existingRows = parseLedgerText(previous);
  existingRows.push(normalized);
  await storage.writeObject(
    key,
    Buffer.from(serializeLedgerRows(existingRows), 'utf8'),
    { contentType: 'application/x-ndjson' }
  );
  const previousFlat = await storage.readTextOrNull(flatKey);
  const flatRows = parseLedgerText(previousFlat);
  flatRows.push(normalized);
  await storage.writeObject(
    flatKey,
    Buffer.from(serializeLedgerRows(flatRows), 'utf8'),
    { contentType: 'application/x-ndjson' }
  );

  const monthly = await readMonthlyRollup({ storage, month });
  applyEntryToRollup(monthly, normalized);
  const rollupKey = await writeMonthlyRollup({ storage, month, rollup: monthly });

  return {
    entry: normalized,
    ledgerKey: key,
    flatLedgerKey: flatKey,
    monthlyRollupKey: rollupKey
  };
}

export async function readBillingSnapshot({
  storage,
  month = monthFromTs(nowIso()),
  productId = ''
}) {
  const monthly = await readMonthlyRollup({ storage, month });
  const product = monthly.by_product?.[productId] || {
    cost_usd: 0,
    calls: 0,
    prompt_tokens: 0,
    completion_tokens: 0
  };

  return {
    month,
    monthly_cost_usd: round(monthly.totals.cost_usd || 0, 8),
    monthly_calls: safeInt(monthly.totals.calls, 0),
    product_cost_usd: round(product.cost_usd || 0, 8),
    product_calls: safeInt(product.calls, 0),
    monthly
  };
}

export async function buildBillingReport({
  storage,
  month = monthFromTs(nowIso())
}) {
  const monthly = await readMonthlyRollup({ storage, month });
  return {
    month,
    totals: monthly.totals,
    by_day: monthly.by_day,
    by_category: monthly.by_category,
    by_product: monthly.by_product,
    by_model: monthly.by_model,
    by_reason: monthly.by_reason
  };
}
