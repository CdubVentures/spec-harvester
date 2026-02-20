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

function legacyLedgerKey(storage, month) {
  return storage.resolveOutputKey('_billing', 'ledger', `${month}.jsonl`);
}

function legacyFlatLedgerKey(storage) {
  return storage.resolveOutputKey('_billing', 'ledger.jsonl');
}

function legacyMonthlyRollupKey(storage, month) {
  return storage.resolveOutputKey('_billing', 'monthly', `${month}.json`);
}

function legacyMonthlyDigestKey(storage, month) {
  return storage.resolveOutputKey('_billing', 'monthly', `${month}.txt`);
}

function legacyLatestDigestKey(storage) {
  return storage.resolveOutputKey('_billing', 'latest.txt');
}

function ledgerKey(_storage, month) {
  return `_billing/ledger/${month}.jsonl`;
}

function flatLedgerKey(_storage) {
  return '_billing/ledger.jsonl';
}

function monthlyRollupKey(_storage, month) {
  return `_billing/monthly/${month}.json`;
}

function monthlyDigestKey(_storage, month) {
  return `_billing/monthly/${month}.txt`;
}

function latestDigestKey(_storage) {
  return '_billing/latest.txt';
}

function formatUsd(value) {
  return `$${round(value, 8).toFixed(8)}`;
}

function parseIsoMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEntry(entry = {}) {
  const ts = entry.ts || nowIso();
  const tsStr = String(ts);
  const month = tsStr.slice(0, 7);   // YYYY-MM
  const day = tsStr.slice(0, 10);     // YYYY-MM-DD
  return {
    ts,
    month,
    day,
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

function toDbEntry(normalized) {
  return {
    ts: normalized.ts,
    month: normalized.month,
    day: normalized.day,
    provider: normalized.provider,
    model: normalized.model,
    category: normalized.category,
    product_id: normalized.productId,
    run_id: normalized.runId,
    round: normalized.round,
    prompt_tokens: normalized.prompt_tokens,
    completion_tokens: normalized.completion_tokens,
    cached_prompt_tokens: normalized.cached_prompt_tokens,
    total_tokens: normalized.total_tokens,
    cost_usd: normalized.cost_usd,
    reason: normalized.reason,
    host: normalized.host,
    url_count: normalized.url_count,
    evidence_chars: normalized.evidence_chars,
    estimated_usage: normalized.estimated_usage ? 1 : 0,
    meta: JSON.stringify(normalized.meta || {})
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

function collectRunBuckets(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const runId = String(row.runId || '').trim();
    const day = dayFromTs(row.ts || nowIso());
    const productId = String(row.productId || '').trim();
    const key = runId || `${day}::${productId || 'unknown_product'}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        runId: runId || '(no_run_id)',
        day,
        firstTs: row.ts || nowIso(),
        lastTs: row.ts || nowIso(),
        productId: productId || '',
        category: String(row.category || ''),
        calls: 0,
        costUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        providers: new Set(),
        models: new Set(),
        reasons: new Set()
      });
    }

    const bucket = map.get(key);
    if (parseIsoMs(row.ts) < parseIsoMs(bucket.firstTs)) {
      bucket.firstTs = row.ts;
      bucket.day = dayFromTs(row.ts || nowIso());
    }
    if (parseIsoMs(row.ts) > parseIsoMs(bucket.lastTs)) {
      bucket.lastTs = row.ts;
    }
    if (!bucket.productId && row.productId) {
      bucket.productId = String(row.productId);
    }
    if (!bucket.category && row.category) {
      bucket.category = String(row.category);
    }

    bucket.calls += 1;
    bucket.costUsd = round(bucket.costUsd + safeNumber(row.cost_usd, 0), 8);
    bucket.promptTokens += safeInt(row.prompt_tokens, 0);
    bucket.completionTokens += safeInt(row.completion_tokens, 0);
    if (row.provider) {
      bucket.providers.add(String(row.provider));
    }
    if (row.model) {
      bucket.models.add(String(row.model));
    }
    if (row.reason) {
      bucket.reasons.add(String(row.reason));
    }
  }

  return [...map.values()]
    .sort((a, b) => parseIsoMs(b.firstTs) - parseIsoMs(a.firstTs))
    .map((row) => ({
      ...row,
      providers: [...row.providers].sort(),
      models: [...row.models].sort(),
      reasons: [...row.reasons].sort()
    }));
}

function pushModelDetails(lines, config = {}) {
  const details = [
    ['Provider', config.llmProvider || ''],
    ['Base URL', config.llmBaseUrl || config.openaiBaseUrl || ''],
    ['Model Version', config.deepseekModelVersion || ''],
    ['Context Length', config.deepseekContextLength || ''],
    [
      'Max Output (deepseek-chat)',
      config.deepseekChatMaxOutputDefault || config.deepseekChatMaxOutputMaximum
        ? `default ${config.deepseekChatMaxOutputDefault || '?'} / max ${config.deepseekChatMaxOutputMaximum || '?'}`
        : ''
    ],
    [
      'Max Output (deepseek-reasoner)',
      config.deepseekReasonerMaxOutputDefault || config.deepseekReasonerMaxOutputMaximum
        ? `default ${config.deepseekReasonerMaxOutputDefault || '?'} / max ${config.deepseekReasonerMaxOutputMaximum || '?'}`
        : ''
    ],
    ['Features', config.deepseekFeatures || '']
  ];

  const pricing = [
    [
      'Pricing Default (1M input cache miss)',
      safeNumber(config.llmCostInputPer1M, 0) > 0 ? `$${safeNumber(config.llmCostInputPer1M, 0)}` : ''
    ],
    [
      'Pricing Default (1M input cache hit)',
      safeNumber(config.llmCostCachedInputPer1M, 0) > 0 ? `$${safeNumber(config.llmCostCachedInputPer1M, 0)}` : '$0'
    ],
    [
      'Pricing Default (1M output)',
      safeNumber(config.llmCostOutputPer1M, 0) > 0 ? `$${safeNumber(config.llmCostOutputPer1M, 0)}` : ''
    ],
    [
      'Pricing deepseek-chat',
      safeNumber(config.llmCostInputPer1MDeepseekChat, -1) >= 0 ||
      safeNumber(config.llmCostOutputPer1MDeepseekChat, -1) >= 0 ||
      safeNumber(config.llmCostCachedInputPer1MDeepseekChat, -1) >= 0
        ? `in $${safeNumber(config.llmCostInputPer1MDeepseekChat, 0)} / out $${safeNumber(config.llmCostOutputPer1MDeepseekChat, 0)} / cache-hit $${safeNumber(config.llmCostCachedInputPer1MDeepseekChat, 0)}`
        : ''
    ],
    [
      'Pricing deepseek-reasoner',
      safeNumber(config.llmCostInputPer1MDeepseekReasoner, -1) >= 0 ||
      safeNumber(config.llmCostOutputPer1MDeepseekReasoner, -1) >= 0 ||
      safeNumber(config.llmCostCachedInputPer1MDeepseekReasoner, -1) >= 0
        ? `in $${safeNumber(config.llmCostInputPer1MDeepseekReasoner, 0)} / out $${safeNumber(config.llmCostOutputPer1MDeepseekReasoner, 0)} / cache-hit $${safeNumber(config.llmCostCachedInputPer1MDeepseekReasoner, 0)}`
        : ''
    ]
  ];

  const rows = [...details, ...pricing].filter(([, value]) => String(value || '').trim() !== '');
  if (!rows.length) {
    return;
  }
  lines.push('Model Details');
  lines.push('-------------');
  for (const [label, value] of rows) {
    lines.push(`${label}: ${value}`);
  }
  lines.push('');
}

function buildBillingDigestText({
  month,
  rollup,
  rows,
  config = {}
}) {
  const runs = collectRunBuckets(rows);
  const lines = [];
  lines.push('Spec Harvester Billing Digest');
  lines.push('============================');
  lines.push(`Month: ${month}`);
  lines.push(`Generated At: ${rollup.generated_at || nowIso()}`);
  lines.push(`Total Cost USD: ${formatUsd(rollup.totals?.cost_usd || 0)}`);
  lines.push(`Total Calls: ${safeInt(rollup.totals?.calls, 0)}`);
  lines.push(`Prompt Tokens: ${safeInt(rollup.totals?.prompt_tokens, 0)}`);
  lines.push(`Completion Tokens: ${safeInt(rollup.totals?.completion_tokens, 0)}`);
  lines.push('');

  pushModelDetails(lines, config);

  lines.push('Run Totals (Newest First)');
  lines.push('-------------------------');
  if (!runs.length) {
    lines.push('No billable LLM calls recorded for this month.');
  } else {
    for (const run of runs) {
      lines.push(
        `${run.day} | run ${run.runId} | ${run.productId || 'unknown_product'} | cost ${formatUsd(run.costUsd)} | calls ${run.calls} | prompt ${run.promptTokens} | completion ${run.completionTokens} | models ${run.models.join(', ') || 'unknown'} | reasons ${run.reasons.join(', ') || 'unknown'}`
      );
    }
  }
  lines.push('');

  lines.push('Daily Totals');
  lines.push('------------');
  const dayRows = Object.entries(rollup.by_day || {})
    .sort((a, b) => b[0].localeCompare(a[0]));
  if (!dayRows.length) {
    lines.push('No daily totals yet.');
  } else {
    for (const [day, row] of dayRows) {
      lines.push(
        `${day} | cost ${formatUsd(row.cost_usd || 0)} | calls ${safeInt(row.calls, 0)} | prompt ${safeInt(row.prompt_tokens, 0)} | completion ${safeInt(row.completion_tokens, 0)}`
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function writeBillingDigest({
  storage,
  month,
  rollup,
  rows,
  config = {}
}) {
  const text = buildBillingDigestText({
    month,
    rollup,
    rows,
    config
  });
  const digestKey = monthlyDigestKey(storage, month);
  const latestKey = latestDigestKey(storage);
  const legacyDigestKey = legacyMonthlyDigestKey(storage, month);
  const legacyLatestKey = legacyLatestDigestKey(storage);
  await storage.writeObject(
    digestKey,
    Buffer.from(text, 'utf8'),
    { contentType: 'text/plain; charset=utf-8' }
  );
  await storage.writeObject(
    latestKey,
    Buffer.from(text, 'utf8'),
    { contentType: 'text/plain; charset=utf-8' }
  );
  await storage.writeObject(
    legacyDigestKey,
    Buffer.from(text, 'utf8'),
    { contentType: 'text/plain; charset=utf-8' }
  );
  await storage.writeObject(
    legacyLatestKey,
    Buffer.from(text, 'utf8'),
    { contentType: 'text/plain; charset=utf-8' }
  );
  return {
    digestKey,
    legacyDigestKey,
    latestDigestKey: latestKey
  };
}

export async function readMonthlyRollup({ storage, month, specDb = null }) {
  if (specDb) {
    try {
      const result = specDb.getBillingRollup(month);
      if (result) {
        return result;
      }
    } catch {
      // fall through to JSON path
    }
  }
  const key = monthlyRollupKey(storage, month);
  const legacyKey = legacyMonthlyRollupKey(storage, month);
  return (await storage.readJsonOrNull(key)) ||
    (await storage.readJsonOrNull(legacyKey)) ||
    emptyRollup(month);
}

export async function readLedgerMonth({ storage, month, specDb = null }) {
  if (specDb) {
    try {
      const entries = specDb.getBillingEntriesForMonth(month);
      if (entries) {
        return entries;
      }
    } catch {
      // fall through to JSON path
    }
  }
  const key = ledgerKey(storage, month);
  const legacyKey = legacyLedgerKey(storage, month);
  const text = await storage.readTextOrNull(key) ||
    await storage.readTextOrNull(legacyKey);
  return parseLedgerText(text);
}

export async function writeMonthlyRollup({ storage, month, rollup }) {
  const key = monthlyRollupKey(storage, month);
  const legacyKey = legacyMonthlyRollupKey(storage, month);
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(rollup, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    legacyKey,
    Buffer.from(JSON.stringify(rollup, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  return key;
}

export async function appendCostLedgerEntry({
  storage,
  config,
  entry,
  specDb = null
}) {
  if (!storage || !config || !entry) {
    return { entry: null, ledgerKey: null, monthlyRollupKey: null };
  }

  const normalized = normalizeEntry(entry);
  const month = monthFromTs(normalized.ts);

  // SQLite primary write
  if (specDb) {
    try {
      specDb.insertBillingEntry(toDbEntry(normalized));
    } catch {
      // fall through — JSON path below will still run if billingJsonWrite is set
    }
  }

  // Skip JSON/NDJSON writes when specDb is available and billingJsonWrite is not forced
  const writeJson = config.billingJsonWrite || !specDb;

  if (writeJson) {
    const key = ledgerKey(storage, month);
    const legacyKey = legacyLedgerKey(storage, month);
    const flatKey = flatLedgerKey(storage);
    const legacyFlatKey = legacyFlatLedgerKey(storage);
    const previous = await storage.readTextOrNull(key) ||
      await storage.readTextOrNull(legacyKey);
    const existingRows = parseLedgerText(previous);
    existingRows.push(normalized);
    await storage.writeObject(
      key,
      Buffer.from(serializeLedgerRows(existingRows), 'utf8'),
      { contentType: 'application/x-ndjson' }
    );
    await storage.writeObject(
      legacyKey,
      Buffer.from(serializeLedgerRows(existingRows), 'utf8'),
      { contentType: 'application/x-ndjson' }
    );
    const previousFlat = await storage.readTextOrNull(flatKey) ||
      await storage.readTextOrNull(legacyFlatKey);
    const flatRows = parseLedgerText(previousFlat);
    flatRows.push(normalized);
    await storage.writeObject(
      flatKey,
      Buffer.from(serializeLedgerRows(flatRows), 'utf8'),
      { contentType: 'application/x-ndjson' }
    );
    await storage.writeObject(
      legacyFlatKey,
      Buffer.from(serializeLedgerRows(flatRows), 'utf8'),
      { contentType: 'application/x-ndjson' }
    );

    const monthly = await readMonthlyRollup({ storage, month, specDb });
    applyEntryToRollup(monthly, normalized);
    const rollupKey = await writeMonthlyRollup({ storage, month, rollup: monthly });
    const digest = await writeBillingDigest({
      storage,
      month,
      rollup: monthly,
      rows: existingRows,
      config
    });

    return {
      entry: normalized,
      ledgerKey: key,
      legacyLedgerKey: legacyKey,
      flatLedgerKey: flatKey,
      legacyFlatLedgerKey: legacyFlatKey,
      monthlyRollupKey: rollupKey,
      digestKey: digest.digestKey,
      latestDigestKey: digest.latestDigestKey
    };
  }

  // specDb-only path (no JSON writes)
  return {
    entry: normalized,
    ledgerKey: null,
    legacyLedgerKey: null,
    flatLedgerKey: null,
    legacyFlatLedgerKey: null,
    monthlyRollupKey: null,
    digestKey: null,
    latestDigestKey: null
  };
}

export async function readBillingSnapshot({
  storage,
  month = monthFromTs(nowIso()),
  productId = '',
  specDb = null
}) {
  if (specDb) {
    try {
      const result = specDb.getBillingSnapshot(month, productId);
      if (result) {
        return result;
      }
    } catch {
      // fall through to JSON path
    }
  }

  const monthly = await readMonthlyRollup({ storage, month, specDb });
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
  month = monthFromTs(nowIso()),
  config = {},
  specDb = null
}) {
  if (specDb) {
    try {
      const rollup = specDb.getBillingRollup(month);
      const rows = specDb.getBillingEntriesForMonth(month);
      if (rollup) {
        const digest = await writeBillingDigest({
          storage,
          month,
          rollup,
          rows: rows || [],
          config
        });
        return {
          month,
          totals: rollup.totals,
          by_day: rollup.by_day,
          by_category: rollup.by_category,
          by_product: rollup.by_product,
          by_model: rollup.by_model,
          by_reason: rollup.by_reason,
          digest_key: digest.digestKey,
          latest_digest_key: digest.latestDigestKey
        };
      }
    } catch {
      // fall through to JSON path
    }
  }

  const monthly = await readMonthlyRollup({ storage, month, specDb });
  const rows = await readLedgerMonth({ storage, month, specDb });
  const digest = await writeBillingDigest({
    storage,
    month,
    rollup: monthly,
    rows,
    config
  });
  return {
    month,
    totals: monthly.totals,
    by_day: monthly.by_day,
    by_category: monthly.by_category,
    by_product: monthly.by_product,
    by_model: monthly.by_model,
    by_reason: monthly.by_reason,
    digest_key: digest.digestKey,
    latest_digest_key: digest.latestDigestKey
  };
}
