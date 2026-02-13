
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import semver from 'semver';
import { createFieldRulesEngine } from '../engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../engine/runtimeGate.js';
import { buildAccuracyReport } from '../testing/goldenFiles.js';
import { buildReviewMetrics } from '../review/overrideWorkflow.js';

function nowIso() {
  return new Date().toISOString();
}

function toPosix(...parts) {
  return parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^fields\./, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasKnownValue(value) {
  const token = normalizeToken(value);
  return token && token !== 'unk' && token !== 'unknown' && token !== 'n/a' && token !== 'null' && token !== '-';
}

function parseDateMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePeriodDays(period, fallback = 30) {
  const token = normalizeToken(period);
  if (!token) {
    return fallback;
  }
  if (token === 'week' || token === 'weekly' || token === '7d') {
    return 7;
  }
  if (token === 'month' || token === 'monthly' || token === '30d') {
    return 30;
  }
  const match = token.match(/^(\d+)d$/);
  if (match) {
    return Math.max(1, Number.parseInt(match[1], 10) || fallback);
  }
  const asInt = Number.parseInt(token, 10);
  if (Number.isFinite(asInt) && asInt > 0) {
    return asInt;
  }
  return fallback;
}

function parseJsonLines(text = '') {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines.
    }
  }
  return out;
}

function coerceOutputValue(value) {
  if (value === null || value === undefined) {
    return 'unk';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value) || isObject(value)) {
    return value;
  }
  const text = String(value).trim();
  if (!text) {
    return 'unk';
  }
  const lower = text.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number.parseFloat(text);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return text;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function outputModernKey(parts = []) {
  return toPosix('output', ...parts);
}

function outputLegacyKey(storage, parts = []) {
  return storage.resolveOutputKey('output', ...parts);
}

async function readJsonDual(storage, parts = []) {
  const modern = await storage.readJsonOrNull(outputModernKey(parts));
  if (modern) {
    return modern;
  }
  return await storage.readJsonOrNull(outputLegacyKey(storage, parts));
}

async function writeJsonDual(storage, parts = [], payload = {}) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  await storage.writeObject(outputModernKey(parts), body, { contentType: 'application/json' });
  await storage.writeObject(outputLegacyKey(storage, parts), body, { contentType: 'application/json' });
}

async function writeTextDual(storage, parts = [], text = '', contentType = 'text/plain; charset=utf-8') {
  const body = Buffer.from(String(text || ''), 'utf8');
  await storage.writeObject(outputModernKey(parts), body, { contentType });
  await storage.writeObject(outputLegacyKey(storage, parts), body, { contentType });
}

async function writeBufferDual(storage, parts = [], buffer, contentType = 'application/octet-stream') {
  await storage.writeObject(outputModernKey(parts), buffer, { contentType });
  await storage.writeObject(outputLegacyKey(storage, parts), buffer, { contentType });
}

async function listOutputKeys(storage, parts = []) {
  const prefixes = [outputModernKey(parts), outputLegacyKey(storage, parts)];
  const seen = new Set();
  const out = [];
  for (const prefix of prefixes) {
    const keys = await storage.listKeys(prefix);
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out.sort();
}

function inferProductIdFromKey(key) {
  const match = String(key || '').replace(/\\/g, '/').match(/\/published\/([^/]+)\/current\.json$/i);
  return match ? match[1] : '';
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hostnameFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function firstEvidence(row = {}) {
  if (Array.isArray(row.evidence) && row.evidence.length > 0) {
    return row.evidence[0] || {};
  }
  return row || {};
}

function stableSpecFieldOrder(fields = {}) {
  return Object.keys(fields || {}).sort((a, b) => a.localeCompare(b));
}

async function readOverrideDoc({ config = {}, category, productId }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const overridePath = path.join(helperRoot, category, '_overrides', `${productId}.overrides.json`);
  try {
    const raw = await fs.readFile(overridePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (isObject(parsed)) {
      return {
        path: overridePath,
        payload: parsed
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  return {
    path: overridePath,
    payload: null
  };
}

async function listApprovedOverrideProductIds({ config = {}, category }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const dir = path.join(helperRoot, category, '_overrides');
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.overrides.json')) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const status = normalizeToken(parsed?.review_status || '');
      if (status !== 'approved') {
        continue;
      }
      const productId = String(parsed?.product_id || '').trim() || entry.name.replace(/\.overrides\.json$/i, '');
      if (productId) {
        out.push(productId);
      }
    } catch {
      // Ignore malformed override docs in product discovery.
    }
  }

  return [...new Set(out)].sort();
}
function mergeOverrideValue({ existing, override, field }) {
  const value = String(override?.override_value ?? override?.value ?? '').trim();
  if (!value) {
    return existing;
  }
  const provenance = isObject(override?.override_provenance) ? override.override_provenance : {};
  const source = isObject(override?.source) ? override.source : {};

  const evidence = {
    url: String(provenance.url || '').trim() || null,
    host: hostnameFromUrl(provenance.url),
    method: String(source.method || 'manual_override').trim(),
    keyPath: `overrides.${field}`,
    tier: 1,
    tierName: 'user_override',
    source_id: String(provenance.source_id || '').trim() || '',
    snippet_id: String(provenance.snippet_id || '').trim() || '',
    snippet_hash: String(provenance.snippet_hash || '').trim() || '',
    quote_span: Array.isArray(provenance.quote_span) ? provenance.quote_span : null,
    quote: String(provenance.quote || '').trim() || '',
    retrieved_at: String(provenance.retrieved_at || nowIso()).trim()
  };

  return {
    ...(isObject(existing) ? existing : {}),
    value,
    confidence: 1,
    evidence: [evidence],
    override: {
      candidate_id: String(override?.candidate_id || '').trim(),
      override_source: String(override?.override_source || 'manual_override').trim(),
      override_reason: String(override?.override_reason || '').trim() || null,
      set_at: String(override?.set_at || override?.overridden_at || nowIso()).trim()
    }
  };
}

function computeDiffRows(previousSpecs = {}, nextSpecs = {}) {
  const keys = [...new Set([...Object.keys(previousSpecs || {}), ...Object.keys(nextSpecs || {})])]
    .sort((a, b) => a.localeCompare(b));
  const rows = [];
  for (const key of keys) {
    const left = previousSpecs[key];
    const right = nextSpecs[key];
    if (JSON.stringify(left) === JSON.stringify(right)) {
      continue;
    }
    rows.push({
      field: key,
      before: left ?? 'unk',
      after: right ?? 'unk'
    });
  }
  return rows;
}

function coverageFromSpecs(specs = {}, fieldOrder = []) {
  const keys = fieldOrder.length > 0 ? fieldOrder : stableSpecFieldOrder(specs);
  let known = 0;
  for (const key of keys) {
    if (hasKnownValue(specs[key])) {
      known += 1;
    }
  }
  return {
    total: keys.length,
    known,
    coverage: keys.length > 0 ? Number.parseFloat((known / keys.length).toFixed(6)) : 0
  };
}

function resolveFieldConfidence(provenanceRow = {}) {
  const direct = toNumber(provenanceRow?.confidence, NaN);
  if (Number.isFinite(direct)) {
    return Math.max(0, Math.min(1, direct));
  }
  return 0;
}

function evidenceWarningsForRecord(fields = {}, provenance = {}) {
  const warnings = [];
  for (const [field, value] of Object.entries(fields || {})) {
    if (!hasKnownValue(value)) {
      continue;
    }
    const row = isObject(provenance[field]) ? provenance[field] : {};
    const evidence = firstEvidence(row);
    if (!String(evidence.url || '').trim()) {
      warnings.push({ field, code: 'missing_evidence_url' });
    }
    if (!String(evidence.quote || '').trim()) {
      warnings.push({ field, code: 'missing_evidence_quote' });
    }
    if (!String(evidence.snippet_id || '').trim()) {
      warnings.push({ field, code: 'missing_snippet_id' });
    }
  }
  return warnings;
}

function buildUnknowns(specs = {}, summary = {}) {
  const fieldReasoning = isObject(summary?.field_reasoning) ? summary.field_reasoning : {};
  const out = {};
  for (const [field, value] of Object.entries(specs || {})) {
    if (hasKnownValue(value)) {
      continue;
    }
    const row = isObject(fieldReasoning[field]) ? fieldReasoning[field] : {};
    out[field] = {
      reason: String(row.unknown_reason || 'not_found_after_search').trim() || 'not_found_after_search'
    };
  }
  return out;
}

function sourceCountFromProvenance(provenance = {}) {
  const sources = new Set();
  for (const row of Object.values(provenance || {})) {
    const evidence = firstEvidence(row || {});
    const sourceId = String(evidence.source_id || '').trim();
    const host = String(evidence.host || hostnameFromUrl(evidence.url)).trim();
    if (sourceId) {
      sources.add(`id:${sourceId}`);
    }
    if (host) {
      sources.add(`host:${host}`);
    }
  }
  return sources.size;
}

function summarizeConfidenceFromMetadata(specsWithMetadata = {}) {
  let total = 0;
  let count = 0;
  for (const row of Object.values(specsWithMetadata || {})) {
    const confidence = toNumber(row?.confidence, NaN);
    if (!Number.isFinite(confidence)) {
      continue;
    }
    total += confidence;
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return Number.parseFloat((total / count).toFixed(6));
}

function normalizeSpecForCompact(fullRecord = {}) {
  return {
    product_id: fullRecord.product_id,
    category: fullRecord.category,
    published_version: fullRecord.published_version,
    published_at: fullRecord.published_at,
    identity: fullRecord.identity,
    specs: fullRecord.specs,
    metrics: fullRecord.metrics
  };
}

function toJsonLdProduct(fullRecord = {}) {
  const identity = fullRecord.identity || {};
  const name = String(identity.full_name || `${identity.brand || ''} ${identity.model || ''}`.trim()).trim();
  const properties = [];
  for (const [field, value] of Object.entries(fullRecord.specs || {})) {
    if (!hasKnownValue(value)) {
      continue;
    }
    properties.push({
      '@type': 'PropertyValue',
      name: field,
      value: Array.isArray(value) ? value.join(', ') : String(value)
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    brand: {
      '@type': 'Brand',
      name: String(identity.brand || '')
    },
    category: String(fullRecord.category || ''),
    additionalProperty: properties
  };
}

function toMarkdownRecord(fullRecord = {}) {
  const lines = [];
  lines.push(`# ${fullRecord.identity?.full_name || fullRecord.product_id}`);
  lines.push('');
  lines.push(`- Product ID: ${fullRecord.product_id}`);
  lines.push(`- Category: ${fullRecord.category}`);
  lines.push(`- Published Version: ${fullRecord.published_version}`);
  lines.push(`- Published At: ${fullRecord.published_at}`);
  lines.push('');
  lines.push('| Field | Value | Confidence | Source |');
  lines.push('| --- | --- | ---: | --- |');
  for (const [field, row] of Object.entries(fullRecord.specs_with_metadata || {})) {
    lines.push(`| ${field} | ${String(row.value ?? 'unk')} | ${toNumber(row.confidence, 0)} | ${String(row.source || '')} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function readLatestArtifacts(storage, category, productId) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  const [normalized, provenance, summary] = await Promise.all([
    storage.readJsonOrNull(`${latestBase}/normalized.json`),
    storage.readJsonOrNull(`${latestBase}/provenance.json`),
    storage.readJsonOrNull(`${latestBase}/summary.json`)
  ]);

  if (!isObject(normalized) || !isObject(normalized.fields)) {
    throw new Error(`missing_latest_normalized:${category}:${productId}`);
  }

  return {
    normalized,
    provenance: isObject(provenance) ? provenance : {},
    summary: isObject(summary) ? summary : {}
  };
}

function buildSpecsWithMetadata({
  engine,
  fields,
  provenance,
  fieldOrder
}) {
  const out = {};
  for (const field of fieldOrder) {
    const value = fields[field];
    const provRow = isObject(provenance[field]) ? provenance[field] : {};
    const evidence = firstEvidence(provRow);
    const rule = engine?.getFieldRule?.(field) || {};
    out[field] = {
      value: coerceOutputValue(value),
      unit: rule?.contract?.unit || null,
      confidence: resolveFieldConfidence(provRow),
      source: String(evidence.host || hostnameFromUrl(evidence.url) || ''),
      source_tier: String(evidence.tierName || '').trim() || null,
      last_verified: String(evidence.retrieved_at || '').trim() || null,
      source_id: String(evidence.source_id || '').trim() || null,
      snippet_id: String(evidence.snippet_id || '').trim() || null,
      snippet_hash: String(evidence.snippet_hash || '').trim() || null,
      quote_span: Array.isArray(evidence.quote_span) ? evidence.quote_span : null,
      override_source: String(provRow?.override?.override_source || '').trim() || null
    };
  }
  return out;
}

async function readPublishedCurrent(storage, category, productId) {
  return await readJsonDual(storage, [category, 'published', productId, 'current.json']);
}

async function readPublishedProductChangelog(storage, category, productId) {
  const parsed = await readJsonDual(storage, [category, 'published', productId, 'changelog.json']);
  if (!isObject(parsed) || !Array.isArray(parsed.entries)) {
    return {
      version: 1,
      category,
      product_id: productId,
      generated_at: nowIso(),
      entries: []
    };
  }
  return parsed;
}

async function writePublishedProductFiles({
  storage,
  category,
  productId,
  fullRecord,
  previousRecord,
  changes,
  warnings = []
}) {
  const previousVersion = semver.valid(String(previousRecord?.published_version || ''))
    ? String(previousRecord.published_version)
    : null;
  const changed = changes.length > 0 || !previousRecord;
  const nextVersion = !previousRecord
    ? '1.0.0'
    : (changed ? (semver.inc(previousVersion || '1.0.0', 'patch') || '1.0.0') : (previousVersion || '1.0.0'));

  if (!changed && previousRecord) {
    return {
      changed: false,
      published_version: nextVersion,
      change_count: 0,
      warnings
    };
  }

  const nextRecord = {
    ...fullRecord,
    published_version: nextVersion,
    published_at: nowIso()
  };

  if (previousRecord && previousVersion) {
    await writeJsonDual(
      storage,
      [category, 'published', productId, 'versions', `v${previousVersion}.json`],
      previousRecord
    );
  }

  await Promise.all([
    writeJsonDual(storage, [category, 'published', productId, 'current.json'], nextRecord),
    writeJsonDual(storage, [category, 'published', productId, 'compact.json'], normalizeSpecForCompact(nextRecord)),
    writeJsonDual(storage, [category, 'published', productId, 'provenance.json'], {
      product_id: productId,
      category,
      generated_at: nowIso(),
      fields: fullRecord.provenance,
      warnings
    }),
    writeJsonDual(storage, [category, 'published', productId, 'schema_product.jsonld'], toJsonLdProduct(nextRecord)),
    writeTextDual(storage, [category, 'published', productId, 'current.md'], toMarkdownRecord(nextRecord), 'text/markdown; charset=utf-8')
  ]);

  const changelog = await readPublishedProductChangelog(storage, category, productId);
  const entry = {
    version: nextVersion,
    published_at: nextRecord.published_at,
    change_count: changes.length,
    changes
  };
  changelog.generated_at = nowIso();
  changelog.entries = [entry, ...changelog.entries.filter((row) => row?.version !== nextVersion)].slice(0, 200);
  await writeJsonDual(storage, [category, 'published', productId, 'changelog.json'], changelog);

  return {
    changed: true,
    published_version: nextVersion,
    change_count: changes.length,
    warnings
  };
}
async function listPublishedCurrentRecords(storage, category) {
  const keys = await listOutputKeys(storage, [category, 'published']);
  const currentKeys = keys.filter((key) => String(key || '').replace(/\\/g, '/').endsWith('/current.json'));
  const byProduct = new Map();

  for (const key of currentKeys) {
    const productId = inferProductIdFromKey(key);
    if (!productId) {
      continue;
    }
    const payload = await storage.readJsonOrNull(key);
    if (!isObject(payload)) {
      continue;
    }
    const previous = byProduct.get(productId);
    if (!previous) {
      byProduct.set(productId, payload);
      continue;
    }
    if (parseDateMs(payload.published_at) >= parseDateMs(previous.published_at)) {
      byProduct.set(productId, payload);
    }
  }

  return [...byProduct.values()].sort((a, b) => String(a.product_id || '').localeCompare(String(b.product_id || '')));
}

function sortIndexItems(items = []) {
  return items
    .slice()
    .sort((a, b) => parseDateMs(b.published_at) - parseDateMs(a.published_at) || String(a.product_id).localeCompare(String(b.product_id)))
    .map((item) => ({
      product_id: item.product_id,
      category: item.category,
      published_version: item.published_version,
      published_at: item.published_at,
      brand: item.identity?.brand || '',
      model: item.identity?.model || '',
      variant: item.identity?.variant || '',
      coverage: toNumber(item.metrics?.coverage, 0),
      avg_confidence: toNumber(item.metrics?.avg_confidence, 0)
    }));
}

async function writeCategoryIndexAndChangelog(storage, category) {
  const records = await listPublishedCurrentRecords(storage, category);
  const indexPayload = {
    version: 1,
    category,
    generated_at: nowIso(),
    total_products: records.length,
    items: sortIndexItems(records)
  };

  const categoryChangelogRows = [];
  for (const row of records) {
    const changelog = await readPublishedProductChangelog(storage, category, row.product_id);
    const latest = changelog.entries[0];
    if (!latest) {
      continue;
    }
    categoryChangelogRows.push({
      product_id: row.product_id,
      version: latest.version,
      published_at: latest.published_at,
      change_count: toInt(latest.change_count, 0)
    });
  }
  categoryChangelogRows.sort((a, b) => parseDateMs(b.published_at) - parseDateMs(a.published_at));

  const categoryChangelog = {
    version: 1,
    category,
    generated_at: nowIso(),
    items: categoryChangelogRows.slice(0, 500)
  };

  await Promise.all([
    writeJsonDual(storage, [category, '_index.json'], indexPayload),
    writeJsonDual(storage, [category, '_changelog.json'], categoryChangelog),
    writeJsonDual(storage, [category, 'exports', 'feed.json'], {
      version: 1,
      category,
      generated_at: nowIso(),
      items: records
        .slice()
        .sort((a, b) => parseDateMs(b.published_at) - parseDateMs(a.published_at))
        .slice(0, 100)
        .map((item) => ({
          product_id: item.product_id,
          title: item.identity?.full_name || `${item.identity?.brand || ''} ${item.identity?.model || ''}`.trim(),
          published_version: item.published_version,
          published_at: item.published_at
        }))
    })
  ]);

  return {
    records,
    index_key: outputModernKey([category, '_index.json']),
    changelog_key: outputModernKey([category, '_changelog.json'])
  };
}

function confidenceStyle(score) {
  if (score >= 0.85) {
    return { argb: 'FFC6EFCE' };
  }
  if (score >= 0.6) {
    return { argb: 'FFFFF2CC' };
  }
  return { argb: 'FFF8CBAD' };
}

async function writeCsvExport(storage, category, records) {
  const fieldSet = new Set();
  for (const row of records) {
    for (const key of Object.keys(row.specs || {})) {
      fieldSet.add(key);
    }
  }
  const fields = [...fieldSet].sort((a, b) => a.localeCompare(b));
  const headers = ['product_id', 'brand', 'model', 'variant', 'published_version', 'published_at', ...fields];

  const lines = [headers.map(csvEscape).join(',')];
  for (const row of records) {
    const line = [
      row.product_id,
      row.identity?.brand || '',
      row.identity?.model || '',
      row.identity?.variant || '',
      row.published_version,
      row.published_at,
      ...fields.map((field) => {
        const value = row.specs?.[field];
        if (Array.isArray(value)) {
          return value.join('|');
        }
        if (isObject(value)) {
          return JSON.stringify(value);
        }
        return value ?? '';
      })
    ];
    lines.push(line.map(csvEscape).join(','));
  }

  await writeTextDual(storage, [category, 'exports', 'all_products.csv'], `${lines.join('\n')}\n`, 'text/csv; charset=utf-8');
  return outputModernKey([category, 'exports', 'all_products.csv']);
}

async function writeXlsxExport(storage, category, records, accuracyReport = null) {
  const workbook = new ExcelJS.Workbook();

  const fieldSet = new Set();
  for (const row of records) {
    for (const key of Object.keys(row.specs || {})) {
      fieldSet.add(key);
    }
  }
  const fields = [...fieldSet].sort((a, b) => a.localeCompare(b));

  const products = workbook.addWorksheet('Products');
  const productHeaders = ['product_id', 'brand', 'model', 'variant', 'published_version', 'published_at', ...fields];
  products.addRow(productHeaders);
  for (const row of records) {
    const values = [
      row.product_id,
      row.identity?.brand || '',
      row.identity?.model || '',
      row.identity?.variant || '',
      row.published_version,
      row.published_at,
      ...fields.map((field) => {
        const value = row.specs?.[field];
        if (Array.isArray(value)) {
          return value.join(', ');
        }
        if (isObject(value)) {
          return JSON.stringify(value);
        }
        return value ?? 'unk';
      })
    ];
    const added = products.addRow(values);
    fields.forEach((field, index) => {
      const columnIndex = 7 + index;
      const metadata = row.specs_with_metadata?.[field] || {};
      const value = String(added.getCell(columnIndex).value || '').trim().toLowerCase();
      if (!value || value === 'unk' || value === 'unknown' || value === 'n/a') {
        added.getCell(columnIndex).font = { italic: true, color: { argb: 'FF666666' } };
      }
      if (metadata.override_source) {
        added.getCell(columnIndex).font = {
          ...(added.getCell(columnIndex).font || {}),
          bold: true,
          color: { argb: 'FF1F4E79' }
        };
      }
    });
  }

  productHeaders.forEach((header, index) => {
    const column = products.getColumn(index + 1);
    column.width = Math.max(14, String(header).length + 2);
  });

  const confidence = workbook.addWorksheet('Confidence');
  confidence.addRow(['product_id', ...fields]);
  for (const row of records) {
    const values = [row.product_id, ...fields.map((field) => toNumber(row.specs_with_metadata?.[field]?.confidence, 0))];
    const added = confidence.addRow(values);
    fields.forEach((field, index) => {
      const cell = added.getCell(index + 2);
      const score = toNumber(row.specs_with_metadata?.[field]?.confidence, 0);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: confidenceStyle(score)
      };
    });
  }

  const metadataSheet = workbook.addWorksheet('Field Metadata');
  metadataSheet.addRow(['field_key', 'display_name', 'type', 'unit', 'required_level']);
  const firstRecord = records[0] || {};
  const fieldMetaRows = Object.keys(firstRecord.specs_with_metadata || {})
    .sort((a, b) => a.localeCompare(b))
    .map((field) => {
      const meta = firstRecord.specs_with_metadata[field] || {};
      return [field, field, typeof meta.value, meta.unit || '', meta.required_level || ''];
    });
  for (const row of fieldMetaRows) {
    metadataSheet.addRow(row);
  }

  const unknownsSheet = workbook.addWorksheet('Unknowns');
  unknownsSheet.addRow(['product_id', 'field', 'reason']);
  for (const row of records) {
    for (const [field, unknown] of Object.entries(row.unknowns || {})) {
      unknownsSheet.addRow([row.product_id, field, String(unknown?.reason || '')]);
    }
  }

  const changelogSheet = workbook.addWorksheet('Changelog');
  changelogSheet.addRow(['product_id', 'published_version', 'published_at']);
  for (const row of records) {
    changelogSheet.addRow([row.product_id, row.published_version, row.published_at]);
  }

  const accuracySheet = workbook.addWorksheet('Accuracy');
  accuracySheet.addRow(['field', 'accuracy', 'coverage']);
  const reportByField = isObject(accuracyReport?.by_field)
    ? accuracyReport.by_field
    : (isObject(accuracyReport?.raw?.by_field) ? accuracyReport.raw.by_field : {});
  for (const field of Object.keys(reportByField).sort((a, b) => a.localeCompare(b))) {
    const row = reportByField[field] || {};
    accuracySheet.addRow([field, toNumber(row.accuracy, 0), toNumber(row.coverage, 0)]);
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await writeBufferDual(storage, [category, 'exports', 'all_products.xlsx'], buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return outputModernKey([category, 'exports', 'all_products.xlsx']);
}

async function writeSqliteExport(storage, category, records) {
  const fileParts = [category, 'exports', 'all_products.sqlite'];
  const modern = outputModernKey(fileParts);
  const legacy = outputLegacyKey(storage, fileParts);

  const script = [
    'import json, sqlite3, sys',
    'db_path = sys.argv[1]',
    'rows = json.loads(sys.argv[2])',
    'conn = sqlite3.connect(db_path)',
    'cur = conn.cursor()',
    'cur.execute("CREATE TABLE IF NOT EXISTS products (product_id TEXT PRIMARY KEY, category TEXT, brand TEXT, model TEXT, variant TEXT, published_version TEXT, published_at TEXT, specs_json TEXT)")',
    'for row in rows:',
    '  cur.execute("INSERT OR REPLACE INTO products (product_id, category, brand, model, variant, published_version, published_at, specs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (row.get("product_id", ""), row.get("category", ""), ((row.get("identity") or {}).get("brand", "")), ((row.get("identity") or {}).get("model", "")), ((row.get("identity") or {}).get("variant", "")), row.get("published_version", ""), row.get("published_at", ""), json.dumps(row.get("specs") or {})))',
    'conn.commit()',
    'conn.close()'
  ].join('\n');

  const tmpDir = path.resolve('.specfactory_tmp', 'phase9');
  await fs.mkdir(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, `${category}_all_products.sqlite`);

  const run = spawnSync('python', ['-c', script, dbPath, JSON.stringify(records)], {
    encoding: 'utf8'
  });
  if (run.status !== 0) {
    return {
      ok: false,
      error: String(run.stderr || run.stdout || 'sqlite_export_failed').trim() || 'sqlite_export_failed'
    };
  }

  const bytes = await fs.readFile(dbPath);
  await writeBufferDual(storage, fileParts, bytes, 'application/vnd.sqlite3');
  return {
    ok: true,
    key: modern,
    legacy_key: legacy
  };
}

async function writeBulkExports(storage, category, format = 'all') {
  const records = await listPublishedCurrentRecords(storage, category);
  const normalizedFormat = normalizeToken(format || 'all');
  const written = {};

  let latestAccuracy = await readJsonDual(storage, [category, '_accuracy_report.json']);
  if (!latestAccuracy) {
    latestAccuracy = null;
  }

  if (normalizedFormat === 'all' || normalizedFormat === 'csv') {
    written.csv_key = await writeCsvExport(storage, category, records);
  }
  if (normalizedFormat === 'all' || normalizedFormat === 'xlsx') {
    written.xlsx_key = await writeXlsxExport(storage, category, records, latestAccuracy);
  }
  if (normalizedFormat === 'all' || normalizedFormat === 'sqlite') {
    const sqlite = await writeSqliteExport(storage, category, records);
    written.sqlite = sqlite;
  }

  await writeJsonDual(storage, [category, 'exports', 'feed.json'], {
    version: 1,
    category,
    generated_at: nowIso(),
    items: records
      .slice()
      .sort((a, b) => parseDateMs(b.published_at) - parseDateMs(a.published_at))
      .slice(0, 100)
      .map((row) => ({
        product_id: row.product_id,
        title: row.identity?.full_name || `${row.identity?.brand || ''} ${row.identity?.model || ''}`.trim(),
        published_version: row.published_version,
        published_at: row.published_at
      }))
  });

  return {
    record_count: records.length,
    ...written
  };
}
async function publishSingleProduct({ storage, config, category, productId }) {
  const latest = await readLatestArtifacts(storage, category, productId);
  const override = await readOverrideDoc({ config, category, productId });
  const reviewStatus = normalizeToken(override.payload?.review_status || '');
  const overrides = reviewStatus === 'approved' && isObject(override.payload?.overrides)
    ? override.payload.overrides
    : {};

  const mergedFields = { ...latest.normalized.fields };
  const mergedProvenance = { ...latest.provenance };
  for (const [rawField, overrideRow] of Object.entries(overrides)) {
    const field = normalizeFieldKey(rawField);
    if (!field) {
      continue;
    }
    const value = String(overrideRow?.override_value ?? overrideRow?.value ?? '').trim();
    if (!value) {
      continue;
    }
    mergedFields[field] = value;
    mergedProvenance[field] = mergeOverrideValue({
      existing: mergedProvenance[field],
      override: overrideRow,
      field
    });
  }

  const engine = await createFieldRulesEngine(category, { config });
  const fieldOrder = engine.getAllFieldKeys();
  const migratedInput = engine.applyKeyMigrations(mergedFields);
  const runtimeGate = applyRuntimeFieldRules({
    engine,
    fields: migratedInput,
    provenance: mergedProvenance,
    fieldOrder,
    enforceEvidence: false,
    strictEvidence: false,
    evidencePack: null
  });

  const requiredMissing = engine.getRequiredFields()
    .map((row) => normalizeFieldKey(row.key))
    .filter((field) => !hasKnownValue(runtimeGate.fields[field]));
  const validationFailed = (runtimeGate.failures || []).length > 0 || requiredMissing.length > 0;
  if (validationFailed) {
    return {
      ok: false,
      product_id: productId,
      reason: 'validation_failed_after_merge',
      runtime_gate: runtimeGate,
      required_missing_fields: requiredMissing
    };
  }

  const specs = {};
  for (const field of fieldOrder) {
    specs[field] = coerceOutputValue(runtimeGate.fields[field]);
  }
  for (const field of Object.keys(runtimeGate.fields || {})) {
    if (!Object.prototype.hasOwnProperty.call(specs, field)) {
      specs[field] = coerceOutputValue(runtimeGate.fields[field]);
    }
  }

  const specsWithMetadata = buildSpecsWithMetadata({
    engine,
    fields: runtimeGate.fields,
    provenance: mergedProvenance,
    fieldOrder: stableSpecFieldOrder(specs)
  });

  const identity = isObject(latest.normalized.identity) ? latest.normalized.identity : {};
  const identityRecord = {
    brand: String(identity.brand || '').trim(),
    model: String(identity.model || '').trim(),
    variant: String(identity.variant || '').trim(),
    full_name: String(`${identity.brand || ''} ${identity.model || ''} ${identity.variant || ''}`).replace(/\s+/g, ' ').trim(),
    slug: slug(`${identity.brand || ''}-${identity.model || ''}-${identity.variant || ''}`)
  };

  const coverage = coverageFromSpecs(specs, stableSpecFieldOrder(specs));
  const unknowns = buildUnknowns(specs, latest.summary);
  const warnings = evidenceWarningsForRecord(runtimeGate.fields, mergedProvenance);

  const fullRecord = {
    product_id: productId,
    category,
    published_version: '0.0.0',
    published_at: nowIso(),
    field_rules_version: String(engine?.keyMigrations?.version || '1.0.0'),
    identity: identityRecord,
    specs,
    specs_with_metadata: specsWithMetadata,
    unknowns,
    metrics: {
      coverage: coverage.coverage,
      avg_confidence: summarizeConfidenceFromMetadata(specsWithMetadata),
      sources_used: sourceCountFromProvenance(mergedProvenance),
      human_overrides: Object.keys(overrides).length,
      last_crawled: String(latest.summary.generated_at || nowIso())
    },
    provenance: mergedProvenance,
    publish_validation: {
      runtime_failures: runtimeGate.failures || [],
      runtime_warnings: runtimeGate.warnings || [],
      required_missing_fields: requiredMissing,
      evidence_warnings: warnings
    }
  };

  const previous = await readPublishedCurrent(storage, category, productId);
  const changes = computeDiffRows(previous?.specs || {}, fullRecord.specs || {});
  const written = await writePublishedProductFiles({
    storage,
    category,
    productId,
    fullRecord,
    previousRecord: previous,
    changes,
    warnings
  });

  return {
    ok: true,
    product_id: productId,
    changed: written.changed,
    published_version: written.published_version,
    change_count: written.change_count,
    warnings: written.warnings
  };
}

export async function publishProducts({
  storage,
  config = {},
  category,
  productIds = [],
  allApproved = false,
  format = 'all'
}) {
  const normalizedCategory = normalizeCategory(category || '');
  if (!normalizedCategory) {
    throw new Error('publish requires --category <category>');
  }

  const explicitIds = (productIds || []).map((value) => String(value || '').trim()).filter(Boolean);
  const approvedIds = allApproved
    ? await listApprovedOverrideProductIds({ config, category: normalizedCategory })
    : [];
  const targets = [...new Set([...explicitIds, ...approvedIds])];

  const results = [];
  let published = 0;
  let blocked = 0;

  for (const productId of targets) {
    try {
      const row = await publishSingleProduct({
        storage,
        config,
        category: normalizedCategory,
        productId
      });
      results.push(row);
      if (row.ok) {
        published += 1;
      } else {
        blocked += 1;
      }
    } catch (error) {
      blocked += 1;
      results.push({
        ok: false,
        product_id: productId,
        reason: error.message || 'publish_failed'
      });
    }
  }

  const indexInfo = await writeCategoryIndexAndChangelog(storage, normalizedCategory);
  const exportInfo = await writeBulkExports(storage, normalizedCategory, format);

  return {
    category: normalizedCategory,
    processed_count: targets.length,
    published_count: published,
    blocked_count: blocked,
    results,
    index_key: indexInfo.index_key,
    changelog_key: indexInfo.changelog_key,
    exports: exportInfo
  };
}

export async function readPublishedProvenance({
  storage,
  category,
  productId,
  field = '',
  full = false
}) {
  const normalizedCategory = normalizeCategory(category);
  const payload = await readJsonDual(storage, [normalizedCategory, 'published', productId, 'provenance.json']);
  if (!isObject(payload)) {
    throw new Error(`published_provenance_not_found:${normalizedCategory}:${productId}`);
  }

  if (full) {
    return {
      category: normalizedCategory,
      product_id: productId,
      full: true,
      ...payload
    };
  }

  const normalizedField = normalizeFieldKey(field);
  if (!normalizedField) {
    throw new Error('provenance requires --field <field> or --full');
  }
  const start = Date.now();
  const row = payload.fields?.[normalizedField] || null;
  return {
    category: normalizedCategory,
    product_id: productId,
    field: normalizedField,
    provenance: row,
    query_time_ms: Date.now() - start
  };
}

export async function readPublishedChangelog({ storage, category, productId }) {
  const normalizedCategory = normalizeCategory(category);
  const payload = await readPublishedProductChangelog(storage, normalizedCategory, productId);
  return {
    category: normalizedCategory,
    product_id: productId,
    entries: payload.entries || []
  };
}

export async function runAccuracyBenchmarkReport({
  storage,
  config = {},
  category,
  period = 'weekly',
  maxCases = 0
}) {
  const normalizedCategory = normalizeCategory(category);
  const raw = await buildAccuracyReport({
    category: normalizedCategory,
    storage,
    config,
    maxCases
  });

  const previous = await readJsonDual(storage, [normalizedCategory, '_accuracy_report.json']);
  const previousByField = isObject(previous?.raw?.by_field)
    ? previous.raw.by_field
    : (isObject(previous?.by_field) ? previous.by_field : {});

  const regressions = [];
  for (const [field, metrics] of Object.entries(raw.by_field || {})) {
    const prev = toNumber(previousByField?.[field]?.accuracy, NaN);
    const current = toNumber(metrics?.accuracy, NaN);
    if (!Number.isFinite(prev) || !Number.isFinite(current)) {
      continue;
    }
    const delta = Number.parseFloat((current - prev).toFixed(6));
    if (delta <= -0.05) {
      regressions.push({
        field,
        previous_accuracy: prev,
        current_accuracy: current,
        delta,
        likely_cause: 'pipeline_or_source_change',
        suggested_action: 'review_recent_changes_and_update_extractors'
      });
    }
  }
  regressions.sort((a, b) => a.delta - b.delta || a.field.localeCompare(b.field));

  const groupTrends = {};
  const previousByGroup = isObject(previous?.raw?.by_group)
    ? previous.raw.by_group
    : (isObject(previous?.by_group) ? previous.by_group : {});
  for (const [group, metrics] of Object.entries(raw.by_group || {})) {
    const prev = toNumber(previousByGroup?.[group]?.accuracy, NaN);
    const current = toNumber(metrics?.accuracy, 0);
    let trend = 'stable';
    if (Number.isFinite(prev)) {
      const delta = current - prev;
      if (delta >= 0.02) {
        trend = 'improving';
      } else if (delta <= -0.02) {
        trend = 'declining';
      }
    }
    groupTrends[group] = {
      accuracy: current,
      trend
    };
  }

  const reviewMetrics = await buildReviewMetrics({
    config,
    category: normalizedCategory,
    windowHours: 24
  });
  const llmMetrics = await buildLlmMetrics({
    storage,
    config,
    period: 'month'
  });
  const publishedRecords = await listPublishedCurrentRecords(storage, normalizedCategory);
  const avgCostPerProduct = publishedRecords.length > 0
    ? Number.parseFloat((toNumber(llmMetrics.total_cost_usd, 0) / publishedRecords.length).toFixed(6))
    : 0;

  const topFailures = toArray(raw.common_failures).map((row) => {
    const fieldMetrics = raw.by_field?.[row.field] || {};
    const total = toInt(fieldMetrics.total, 0);
    const count = toInt(row.count, 0);
    return {
      field: row.field,
      failure_rate: total > 0 ? Number.parseFloat((count / total).toFixed(6)) : 0,
      primary_reason: row.reason
    };
  }).sort((a, b) => b.failure_rate - a.failure_rate || a.field.localeCompare(b.field)).slice(0, 15);

  const report = {
    report_type: 'accuracy',
    category: normalizedCategory,
    generated_at: nowIso(),
    period: normalizeToken(period) || 'weekly',
    summary: {
      products_published: publishedRecords.length,
      overall_accuracy: toNumber(raw.overall_accuracy, 0),
      overall_coverage: toNumber(raw.overall_coverage, 0),
      human_override_rate: toNumber(reviewMetrics.overrides_per_product, 0),
      avg_review_time_seconds: toNumber(reviewMetrics.average_review_time_seconds, 0),
      total_llm_cost_usd: toNumber(llmMetrics.total_cost_usd, 0),
      avg_cost_per_product: avgCostPerProduct
    },
    accuracy_by_group: groupTrends,
    regressions,
    top_failures: topFailures,
    raw
  };

  const dateKey = report.generated_at.slice(0, 10);
  await Promise.all([
    writeJsonDual(storage, [normalizedCategory, '_accuracy_report.json'], report),
    writeJsonDual(storage, [normalizedCategory, 'reports', `accuracy_${dateKey}.json`], report)
  ]);

  return report;
}
export async function buildAccuracyTrend({
  storage,
  category,
  field,
  periodDays = 90
}) {
  const normalizedCategory = normalizeCategory(category);
  const normalizedField = normalizeFieldKey(field);
  const days = Math.max(1, parsePeriodDays(periodDays, 90));
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

  const keys = await listOutputKeys(storage, [normalizedCategory, 'reports']);
  const reportKeys = keys.filter((key) => String(key || '').toLowerCase().includes('/reports/accuracy_') && String(key || '').toLowerCase().endsWith('.json'));
  const points = [];

  for (const key of reportKeys) {
    const payload = await storage.readJsonOrNull(key);
    if (!isObject(payload)) {
      continue;
    }
    const generatedAt = String(payload.generated_at || '').trim();
    const generatedMs = parseDateMs(generatedAt);
    if (!generatedMs || generatedMs < cutoff) {
      continue;
    }
    const byField = isObject(payload.raw?.by_field) ? payload.raw.by_field : (isObject(payload.by_field) ? payload.by_field : {});
    const value = toNumber(byField?.[normalizedField]?.accuracy, NaN);
    if (!Number.isFinite(value)) {
      continue;
    }
    points.push({
      generated_at: generatedAt,
      accuracy: value
    });
  }

  points.sort((a, b) => parseDateMs(a.generated_at) - parseDateMs(b.generated_at));
  const first = points[0]?.accuracy;
  const last = points[points.length - 1]?.accuracy;
  const delta = Number.isFinite(first) && Number.isFinite(last)
    ? Number.parseFloat((last - first).toFixed(6))
    : 0;

  return {
    category: normalizedCategory,
    field: normalizedField,
    period_days: days,
    points,
    delta,
    regression_alert: delta <= -0.05
  };
}

function parseStatusCode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusIsSuccess(status, textStatus = '') {
  if (status !== null) {
    return status >= 200 && status < 400;
  }
  const token = normalizeToken(textStatus);
  return token === 'ok' || token === 'success';
}

function statusIsBlocked(status, textStatus = '') {
  if (status !== null) {
    return status === 403 || status === 429;
  }
  const token = normalizeToken(textStatus);
  return token.includes('captcha') || token.includes('blocked');
}

export async function buildSourceHealth({
  storage,
  category,
  source = '',
  periodDays = 30
}) {
  const normalizedCategory = normalizeCategory(category);
  const days = Math.max(1, parsePeriodDays(periodDays, 30));
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

  const prefixes = [
    toPosix('final', normalizedCategory),
    storage.resolveOutputKey('final', normalizedCategory)
  ];
  const keys = [];
  const seen = new Set();
  for (const prefix of prefixes) {
    const listed = await storage.listKeys(prefix);
    for (const key of listed) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const sourceKeys = keys.filter((key) => String(key || '').replace(/\\/g, '/').endsWith('/evidence/sources.jsonl'));
  const stats = new Map();

  for (const key of sourceKeys) {
    const text = await storage.readTextOrNull(key);
    const rows = parseJsonLines(text || '');
    for (const row of rows) {
      const tsMs = parseDateMs(row.ts || row.timestamp || '');
      if (!tsMs || tsMs < cutoff) {
        continue;
      }
      const host = String(row.host || hostnameFromUrl(row.url) || '').trim().toLowerCase();
      if (!host) {
        continue;
      }
      if (source && normalizeToken(source) !== normalizeToken(host) && normalizeToken(source) !== normalizeToken(row.source_id || '')) {
        continue;
      }
      if (!stats.has(host)) {
        stats.set(host, {
          host,
          source_id: '',
          attempts: 0,
          success: 0,
          blocked: 0,
          identity_match_count: 0,
          last_seen_at: '',
          freshness_days: 0
        });
      }
      const bucket = stats.get(host);
      bucket.attempts += 1;
      const statusCode = parseStatusCode(row.status);
      const textStatus = String(row.status || row.anchor_status || '').trim();
      if (statusIsSuccess(statusCode, textStatus)) {
        bucket.success += 1;
      }
      if (statusIsBlocked(statusCode, textStatus)) {
        bucket.blocked += 1;
      }
      if (row.identity_match || row.identity?.match) {
        bucket.identity_match_count += 1;
      }
      if (!bucket.source_id && row.source_id) {
        bucket.source_id = String(row.source_id || '').trim();
      }
      const ts = String(row.ts || row.timestamp || '').trim();
      if (parseDateMs(ts) > parseDateMs(bucket.last_seen_at)) {
        bucket.last_seen_at = ts;
      }
    }
  }

  const rows = [...stats.values()]
    .map((row) => {
      const successRate = row.attempts > 0 ? row.success / row.attempts : 0;
      const blockedRate = row.attempts > 0 ? row.blocked / row.attempts : 0;
      const freshnessDays = row.last_seen_at
        ? Number.parseFloat(((Date.now() - parseDateMs(row.last_seen_at)) / (24 * 60 * 60 * 1000)).toFixed(3))
        : Number.POSITIVE_INFINITY;
      return {
        ...row,
        success_rate: Number.parseFloat(successRate.toFixed(6)),
        blocked_rate: Number.parseFloat(blockedRate.toFixed(6)),
        freshness_days: Number.isFinite(freshnessDays) ? freshnessDays : null
      };
    })
    .sort((a, b) => b.attempts - a.attempts || a.host.localeCompare(b.host));

  return {
    category: normalizedCategory,
    period_days: days,
    source_filter: source || null,
    generated_at: nowIso(),
    total_sources: rows.length,
    sources: rows,
    alerts: rows
      .filter((row) => row.blocked_rate >= 0.25 || (row.success_rate <= 0.6 && row.attempts >= 5))
      .map((row) => ({
        host: row.host,
        blocked_rate: row.blocked_rate,
        success_rate: row.success_rate,
        attempts: row.attempts
      }))
  };
}

export async function buildLlmMetrics({
  storage,
  config = {},
  period = 'week',
  model = ''
}) {
  const days = parsePeriodDays(period, 7);
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const text = await storage.readTextOrNull('_billing/ledger.jsonl') || await storage.readTextOrNull(storage.resolveOutputKey('_billing', 'ledger.jsonl')) || '';
  const rows = parseJsonLines(text)
    .filter((row) => parseDateMs(row.ts) >= cutoff)
    .filter((row) => !model || normalizeToken(row.model || '') === normalizeToken(model));

  const byModelMap = new Map();
  const products = new Set();
  let totalCost = 0;
  let totalCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  for (const row of rows) {
    const provider = String(row.provider || 'unknown').trim();
    const modelName = String(row.model || 'unknown').trim();
    const key = `${provider}:${modelName}`;
    if (!byModelMap.has(key)) {
      byModelMap.set(key, {
        provider,
        model: modelName,
        calls: 0,
        cost_usd: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        products: new Set()
      });
    }
    const bucket = byModelMap.get(key);
    const cost = toNumber(row.cost_usd, 0);
    const prompt = toInt(row.prompt_tokens, 0);
    const completion = toInt(row.completion_tokens, 0);

    bucket.calls += 1;
    bucket.cost_usd += cost;
    bucket.prompt_tokens += prompt;
    bucket.completion_tokens += completion;
    if (row.productId) {
      bucket.products.add(String(row.productId));
      products.add(String(row.productId));
    }

    totalCost += cost;
    totalCalls += 1;
    promptTokens += prompt;
    completionTokens += completion;
  }

  const byModel = [...byModelMap.values()]
    .map((row) => ({
      provider: row.provider,
      model: row.model,
      calls: row.calls,
      cost_usd: Number.parseFloat(row.cost_usd.toFixed(8)),
      avg_cost_per_call: row.calls > 0 ? Number.parseFloat((row.cost_usd / row.calls).toFixed(8)) : 0,
      prompt_tokens: row.prompt_tokens,
      completion_tokens: row.completion_tokens,
      products: row.products.size
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd || a.model.localeCompare(b.model));

  const budgetMonthly = toNumber(config.llmMonthlyBudgetUsd, 0);
  const periodBudget = budgetMonthly > 0
    ? Number.parseFloat(((budgetMonthly / 30) * days).toFixed(8))
    : 0;

  return {
    period_days: days,
    period: normalizeToken(period),
    model_filter: model || null,
    generated_at: nowIso(),
    total_calls: totalCalls,
    total_cost_usd: Number.parseFloat(totalCost.toFixed(8)),
    total_prompt_tokens: promptTokens,
    total_completion_tokens: completionTokens,
    unique_products: products.size,
    avg_cost_per_product: products.size > 0 ? Number.parseFloat((totalCost / products.size).toFixed(8)) : 0,
    by_model: byModel,
    budget: {
      monthly_usd: budgetMonthly,
      period_budget_usd: periodBudget,
      exceeded: periodBudget > 0 ? totalCost > periodBudget : false
    }
  };
}
