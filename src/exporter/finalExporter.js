import { nowIso } from '../utils/common.js';

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dedupeUrls(urls = [], limit = 50) {
  return [...new Set((urls || []).filter(Boolean))].slice(0, Math.max(1, limit));
}

function isLowValueUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (path.endsWith('/robots.txt')) {
      return true;
    }
    if (path.includes('sitemap') || path.endsWith('.xml')) {
      return true;
    }
    if (path.includes('/search') || path.includes('/shop/search')) {
      return true;
    }
    if (query.includes('q=') || query.includes('query=')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function urlLikelyMatchesBrand(url, brand) {
  const token = slug(brand || '');
  if (!token) {
    return true;
  }
  try {
    const parsed = new URL(String(url || ''));
    const haystack = `${parsed.hostname} ${parsed.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return haystack.includes(token);
  } catch {
    return false;
  }
}

function runSnapshot(summary = {}, runId = '') {
  return {
    ts: nowIso(),
    runId,
    validated: Boolean(summary.validated),
    validated_reason: summary.validated_reason || '',
    confidence: toNumber(summary.confidence, 0),
    completeness_required: toNumber(summary.completeness_required, 0),
    coverage_overall: toNumber(summary.coverage_overall, 0),
    contradiction_count: toInt(summary.constraint_analysis?.contradiction_count, 0),
    missing_required_fields: summary.missing_required_fields || [],
    critical_fields_below_pass_target: summary.critical_fields_below_pass_target || [],
    llm_cost_usd_run: toNumber(summary.llm?.cost_usd_run, 0),
    duration_ms: toInt(summary.duration_ms, 0)
  };
}

function compactSummary(summary = {}) {
  return {
    validated: Boolean(summary.validated),
    validated_reason: summary.validated_reason || '',
    confidence: toNumber(summary.confidence, 0),
    completeness_required: toNumber(summary.completeness_required, 0),
    coverage_overall: toNumber(summary.coverage_overall, 0),
    missing_required_fields: summary.missing_required_fields || [],
    fields_below_pass_target: summary.fields_below_pass_target || [],
    critical_fields_below_pass_target: summary.critical_fields_below_pass_target || [],
    contradiction_count: toInt(summary.constraint_analysis?.contradiction_count, 0),
    identity_gate_validated: Boolean(summary.identity_gate_validated),
    generated_at: summary.generated_at || nowIso()
  };
}

function finalSummaryScore(summary = {}) {
  return {
    completeness: toNumber(summary.completeness_required, toNumber(summary.completeness_required_percent, 0) / 100),
    confidence: toNumber(summary.confidence, 0),
    contradictions: toInt(summary.contradiction_count ?? summary.constraint_analysis?.contradiction_count, 0),
    generatedAt: String(summary.generated_at || '')
  };
}

function shouldPromoteFinal(existingSummary, candidateSummary) {
  if (!existingSummary) {
    return true;
  }
  const existing = finalSummaryScore(existingSummary);
  const candidate = finalSummaryScore(candidateSummary);

  if (candidate.completeness > existing.completeness + 1e-9) {
    return true;
  }
  if (candidate.completeness < existing.completeness - 1e-9) {
    return false;
  }

  if (candidate.confidence > existing.confidence + 1e-9) {
    return true;
  }
  if (candidate.confidence < existing.confidence - 1e-9) {
    return false;
  }

  if (candidate.contradictions < existing.contradictions) {
    return true;
  }
  if (candidate.contradictions > existing.contradictions) {
    return false;
  }

  return candidate.generatedAt >= existing.generatedAt;
}

function sourceRowsForHistory(sourceResults = [], runId = '') {
  return (sourceResults || []).map((row) => ({
    ts: nowIso(),
    runId,
    url: row.finalUrl || row.url || '',
    host: row.host || '',
    tier: row.tier ?? null,
    tier_name: row.tierName || '',
    role: row.role || '',
    approved_domain: Boolean(row.approvedDomain),
    candidate_source: Boolean(row.candidateSource),
    status: row.status ?? null,
    identity_match: Boolean(row.identity?.match),
    identity_score: toNumber(row.identity?.score, 0),
    anchor_status: row.anchorStatus || row.anchor_status || ''
  }));
}

function aggregateEvidencePack({
  productId,
  category,
  runId,
  sourceResults = [],
  summary = {}
}) {
  const references = [];
  const seen = new Set();
  let sourceIndex = 0;
  for (const source of sourceResults || []) {
    sourceIndex += 1;
    const pack = source.llmEvidencePack;
    if (!pack || !Array.isArray(pack.references)) {
      continue;
    }
    for (const ref of pack.references) {
      const refId = `r${String(sourceIndex).padStart(2, '0')}_${String(ref.id || '').trim()}`;
      const key = `${ref.url || source.url}|${ref.type || 'text'}|${String(ref.content || '').slice(0, 120)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      references.push({
        id: refId,
        url: ref.url || source.finalUrl || source.url || '',
        type: ref.type || 'text',
        content: String(ref.content || '')
      });
      if (references.length >= 300) {
        break;
      }
    }
    if (references.length >= 300) {
      break;
    }
  }

  if (references.length === 0) {
    for (const row of summary.top_evidence_references || []) {
      const key = `${row.url}|${row.field}|${row.keyPath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      references.push({
        id: `t${String(references.length + 1).padStart(3, '0')}`,
        url: row.url || '',
        type: 'text',
        content: `${row.field}: ${row.method || 'evidence'} (${row.keyPath || ''})`
      });
      if (references.length >= 120) {
        break;
      }
    }
  }

  return {
    references,
    meta: {
      productId,
      category,
      runId,
      generated_at: nowIso(),
      reference_count: references.length
    }
  };
}

function finalPathParts(category, identity = {}) {
  const brand = slug(identity.brand || 'unknown-brand');
  const model = slug(identity.model || identity.base_model || 'unknown-model');
  const variant = slug(identity.variant || '');
  const parts = ['final', slug(category || 'unknown-category'), brand, model];
  if (variant && variant !== 'unk' && variant !== 'na' && variant !== 'n-a') {
    parts.push(variant);
  }
  return parts;
}

async function writeJson(storage, key, value) {
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

async function appendJsonl(storage, key, row) {
  const line = `${JSON.stringify(row)}\n`;
  if (typeof storage.appendText === 'function') {
    await storage.appendText(
      key,
      line,
      { contentType: 'application/x-ndjson' }
    );
    return;
  }

  const existing = await storage.readTextOrNull(key);
  const next = `${existing || ''}${line}`;
  await storage.writeObject(
    key,
    Buffer.from(next, 'utf8'),
    { contentType: 'application/x-ndjson' }
  );
}

function buildMeta({
  productId,
  category,
  runId,
  normalized,
  summary,
  finalPath,
  sourceResults = []
}) {
  const matchedUrls = (sourceResults || [])
    .filter((row) => row.identity?.match && !row.discoveryOnly)
    .map((row) => row.finalUrl || row.url)
    .filter(Boolean);
  const approvedUrls = (sourceResults || [])
    .filter(
      (row) =>
        row.approvedDomain &&
        !row.discoveryOnly &&
        (row.identity?.match || row.role === 'manufacturer')
    )
    .map((row) => row.finalUrl || row.url)
    .filter(Boolean)
    .filter((url) => !isLowValueUrl(url));
  const evidenceUrls = (summary.top_evidence_references || [])
    .map((row) => row.url)
    .filter(Boolean);
  const fetchedUrls = (summary.urls_fetched || [])
    .filter((url) => !isLowValueUrl(url))
    .filter((url) => urlLikelyMatchesBrand(url, normalized?.identity?.brand));
  const bestUrls = dedupeUrls([
    ...matchedUrls,
    ...approvedUrls,
    ...evidenceUrls,
    ...fetchedUrls
  ]);
  return {
    productId,
    category,
    runId,
    canonical_identity: normalized.identity || {},
    lastUpdatedAt: nowIso(),
    final_path: finalPath,
    bestUrls
  };
}

async function writeDebugRunArtifacts({
  storage,
  category,
  productId,
  runId,
  normalized,
  summary,
  provenance,
  trafficLight,
  sourceResults,
  evidencePack
}) {
  const debugBase = ['runs', slug(category), slug(productId), runId];
  await Promise.all([
    writeJson(storage, `${debugBase.join('/')}/spec.json`, normalized.fields || {}),
    writeJson(storage, `${debugBase.join('/')}/summary.json`, compactSummary(summary)),
    writeJson(storage, `${debugBase.join('/')}/provenance.json`, provenance || {}),
    writeJson(storage, `${debugBase.join('/')}/traffic_light.json`, trafficLight || {}),
    writeJson(storage, `${debugBase.join('/')}/evidence/evidence_pack.json`, evidencePack || {}),
    storage.writeObject(
      `${debugBase.join('/')}/evidence/sources.jsonl`,
      Buffer.from(
        sourceRowsForHistory(sourceResults, runId).map((row) => JSON.stringify(row)).join('\n') + '\n',
        'utf8'
      ),
      { contentType: 'application/x-ndjson' }
    )
  ]);

  return `${debugBase.join('/')}`;
}

export async function writeFinalOutputs({
  storage,
  category,
  productId,
  runId,
  normalized,
  summary,
  provenance,
  trafficLight,
  sourceResults = []
}) {
  const finalParts = finalPathParts(category, normalized.identity || {});
  const finalBase = finalParts.join('/');

  const compact = compactSummary(summary);
  const existingSummary = await storage.readJsonOrNull(`${finalBase}/summary.json`);
  const promote = shouldPromoteFinal(existingSummary, compact);
  const evidencePack = aggregateEvidencePack({
    productId,
    category,
    runId,
    sourceResults,
    summary
  });
  const meta = buildMeta({
    productId,
    category,
    runId,
    normalized,
    summary,
    finalPath: finalBase,
    sourceResults
  });

  if (promote) {
    await Promise.all([
      writeJson(storage, `${finalBase}/spec.json`, normalized.fields || {}),
      writeJson(storage, `${finalBase}/summary.json`, compact),
      writeJson(storage, `${finalBase}/provenance.json`, {
        productId,
        runId,
        category,
        fields: provenance || {},
        field_reasoning: summary.field_reasoning || {},
        traffic_light: trafficLight?.by_field || {}
      }),
      writeJson(storage, `${finalBase}/traffic_light.json`, trafficLight || {}),
      writeJson(storage, `${finalBase}/meta.json`, meta),
      writeJson(storage, `${finalBase}/evidence/evidence_pack.json`, evidencePack)
    ]);
  }

  await appendJsonl(
    storage,
    `${finalBase}/history/runs.jsonl`,
    runSnapshot(summary, runId)
  );
  for (const row of sourceRowsForHistory(sourceResults, runId)) {
    await appendJsonl(storage, `${finalBase}/evidence/sources.jsonl`, row);
  }

  const debugBase = await writeDebugRunArtifacts({
    storage,
    category,
    productId,
    runId,
    normalized,
    summary,
    provenance,
    trafficLight,
    sourceResults,
    evidencePack
  });

  return {
    final_base: finalBase,
    promoted: promote,
    debug_base: debugBase,
    history_key: `${finalBase}/history/runs.jsonl`,
    sources_history_key: `${finalBase}/evidence/sources.jsonl`
  };
}
