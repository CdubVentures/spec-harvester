import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProductCatalog } from '../../catalog/productCatalog.js';
import { buildEvidenceSearchPayload } from '../evidenceSearch.js';
import {
  toInt, toFloat, safeJoin, safeReadJson, parseNdjson, readJsonlEvents, readGzipJsonlEvents,
  normalizeDomainToken, domainFromUrl, urlPathToken, classifySiteKind, isHelperPseudoDomain,
  createDomainBucket, createUrlStat, ensureUrlStat, bumpUrlStatEvent,
  choosePreferredSiteKind, cooldownSecondsRemaining, resolveHostBudget, resolveDomainChecklistStatus,
  classifyFetchOutcomeFromEvent, addTokensFromText, incrementMapCounter, countMapValuesAbove,
  normalizeJsonText, classifyLlmTracePhase, normalizePathToken, percentileFromSorted, parseTsMs,
  isKnownValue, hasKnownValue,
  safeStat, SITE_KIND_RANK, inferSiteKindByDomain,
} from '../helpers/requestHelpers.js';

let _indexLabRoot = '';
let _outputRoot = '';
let _storage = null;
let _config = null;
let _getSpecDbReady = null;
let _isProcessRunning = null;

export function initIndexLabDataBuilders({ indexLabRoot, outputRoot, storage, config, getSpecDbReady, isProcessRunning }) {
  _indexLabRoot = indexLabRoot;
  _outputRoot = outputRoot;
  _storage = storage;
  _config = config;
  _getSpecDbReady = getSpecDbReady;
  _isProcessRunning = isProcessRunning;
}

export async function readIndexLabRunEvents(runId, limit = 2000) {
  const runDir = safeJoin(_indexLabRoot, String(runId || '').trim());
  if (!runDir) return [];
  const eventsPath = path.join(runDir, 'run_events.ndjson');
  let text = '';
  try {
    text = await fs.readFile(eventsPath, 'utf8');
  } catch {
    return [];
  }
  const rows = parseNdjson(text);
  return rows.slice(-Math.max(1, toInt(limit, 2000)));
}

export function resolveRunProductId(meta = {}, events = []) {
  const fromMeta = String(meta?.product_id || '').trim();
  if (fromMeta) return fromMeta;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const row = events[i] || {};
    const payload = row?.payload && typeof row.payload === 'object'
      ? row.payload
      : {};
    const candidate = String(
      row?.product_id
      || row?.productId
      || payload?.product_id
      || payload?.productId
      || ''
    ).trim();
    if (candidate) return candidate;
  }
  return '';
}

export async function resolveIndexLabRunContext(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;
  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) {
    return null;
  }
  return {
    token,
    runDir,
    meta,
    category,
    resolvedRunId,
    productId
  };
}

export async function readIndexLabRunNeedSet(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'needset.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runNeedSetKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'needset.json');
  const runNeedSetPath = path.join(_outputRoot, ...String(runNeedSetKey || '').split('/'));
  const fromRunArtifact = await safeReadJson(runNeedSetPath);
  if (fromRunArtifact && typeof fromRunArtifact === 'object') {
    return fromRunArtifact;
  }

  const latestNeedSetKey = _storage.resolveOutputKey(category, productId, 'latest', 'needset.json');
  const latestNeedSetPath = path.join(_outputRoot, ...String(latestNeedSetKey || '').split('/'));
  const fromLatest = await safeReadJson(latestNeedSetPath);
  if (fromLatest && typeof fromLatest === 'object') {
    return fromLatest;
  }

  return null;
}

export async function readIndexLabRunSearchProfile(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'search_profile.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);

  if (productId) {
    const runProfileKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'search_profile.json');
    const runProfile = await _storage.readJsonOrNull(runProfileKey);
    if (runProfile && typeof runProfile === 'object') {
      return runProfile;
    }

    const latestProfileKey = _storage.resolveOutputKey(category, productId, 'latest', 'search_profile.json');
    const latestProfile = await _storage.readJsonOrNull(latestProfileKey);
    if (latestProfile && typeof latestProfile === 'object') {
      return latestProfile;
    }
  }

  const discoveryProfileKey = _storage.resolveInputKey('_discovery', category, `${resolvedRunId}.search_profile.json`);
  const fromDiscoveryProfile = await _storage.readJsonOrNull(discoveryProfileKey);
  if (fromDiscoveryProfile && typeof fromDiscoveryProfile === 'object') {
    return fromDiscoveryProfile;
  }

  const discoveryLegacyKey = _storage.resolveInputKey('_discovery', category, `${resolvedRunId}.json`);
  const fromDiscovery = await _storage.readJsonOrNull(discoveryLegacyKey);
  if (fromDiscovery?.search_profile && typeof fromDiscovery.search_profile === 'object') {
    return fromDiscovery.search_profile;
  }

  return null;
}

export async function readIndexLabRunPhase07Retrieval(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'phase07_retrieval.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'phase07_retrieval.json');
  const runPayload = await _storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = _storage.resolveOutputKey(category, productId, 'latest', 'phase07_retrieval.json');
  const latestPayload = await _storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  const runSummaryKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await _storage.readJsonOrNull(runSummaryKey);
  if (runSummary?.phase07 && typeof runSummary.phase07 === 'object') {
    return {
      run_id: resolvedRunId,
      category,
      product_id: productId,
      generated_at: String(runSummary.generated_at || '').trim() || null,
      summary: runSummary.phase07,
      fields: [],
      summary_only: true
    };
  }

  return null;
}

export async function readIndexLabRunPhase08Extraction(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'phase08_extraction.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'phase08_extraction.json');
  const runPayload = await _storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = _storage.resolveOutputKey(category, productId, 'latest', 'phase08_extraction.json');
  const latestPayload = await _storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  const runSummaryKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await _storage.readJsonOrNull(runSummaryKey);
  if (runSummary?.phase08 && typeof runSummary.phase08 === 'object') {
    return {
      run_id: resolvedRunId,
      category,
      product_id: productId,
      generated_at: String(runSummary.generated_at || '').trim() || null,
      summary: runSummary.phase08,
      batches: [],
      field_contexts: {},
      prime_sources: { rows: [] },
      summary_only: true
    };
  }

  return null;
}

export async function readIndexLabRunDynamicFetchDashboard(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'dynamic_fetch_dashboard.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'dynamic_fetch_dashboard.json');
  const runPayload = await _storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = _storage.resolveOutputKey(category, productId, 'latest', 'dynamic_fetch_dashboard.json');
  const latestPayload = await _storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  const runSummaryKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await _storage.readJsonOrNull(runSummaryKey);
  if (runSummary?.dynamic_fetch_dashboard && typeof runSummary.dynamic_fetch_dashboard === 'object') {
    return {
      run_id: resolvedRunId,
      category,
      product_id: productId,
      generated_at: String(runSummary.generated_at || '').trim() || null,
      host_count: Number(runSummary.dynamic_fetch_dashboard.host_count || 0),
      hosts: [],
      summary_only: true,
      key: String(runSummary.dynamic_fetch_dashboard.key || '').trim() || null,
      latest_key: String(runSummary.dynamic_fetch_dashboard.latest_key || '').trim() || null
    };
  }

  return null;
}

export async function readIndexLabRunSourceIndexingPackets(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'source_indexing_extraction_packets.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'source_indexing_extraction_packets.json');
  const runPayload = await _storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = _storage.resolveOutputKey(category, productId, 'latest', 'source_indexing_extraction_packets.json');
  const latestPayload = await _storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  return null;
}

export async function readIndexLabRunItemIndexingPacket(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'item_indexing_extraction_packet.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'item_indexing_extraction_packet.json');
  const runPayload = await _storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = _storage.resolveOutputKey(category, productId, 'latest', 'item_indexing_extraction_packet.json');
  const latestPayload = await _storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  return null;
}

export async function readIndexLabRunRunMetaPacket(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'run_meta_packet.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'run_meta_packet.json');
  const runPayload = await _storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = _storage.resolveOutputKey(category, productId, 'latest', 'run_meta_packet.json');
  const latestPayload = await _storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  return null;
}

export async function readIndexLabRunSerpExplorer(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;

  const searchProfile = await readIndexLabRunSearchProfile(token);
  if (searchProfile?.serp_explorer && typeof searchProfile.serp_explorer === 'object') {
    return searchProfile.serp_explorer;
  }

  const runDir = safeJoin(_indexLabRoot, token);
  if (!runDir) return null;
  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runSummaryKey = _storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await _storage.readJsonOrNull(runSummaryKey);
  if (!runSummary || typeof runSummary !== 'object') {
    return null;
  }
  const attemptRows = Array.isArray(runSummary.searches_attempted) ? runSummary.searches_attempted : [];
  const selectedUrlsRaw = Array.isArray(runSummary.urls_fetched) ? runSummary.urls_fetched : [];
  const selectedUrls = selectedUrlsRaw
    .map((row) => {
      if (typeof row === 'string') {
        return {
          url: String(row).trim(),
          query: '',
          doc_kind: '',
          tier_name: '',
          score: 0,
          reason_codes: ['summary_fallback']
        };
      }
      if (!row || typeof row !== 'object') return null;
      const url = String(row.url || row.href || '').trim();
      if (!url) return null;
      const reasonCodes = Array.isArray(row.reason_codes)
        ? row.reason_codes.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      return {
        url,
        query: String(row.query || '').trim(),
        doc_kind: String(row.doc_kind || '').trim(),
        tier_name: String(row.tier_name || '').trim(),
        score: Number(row.score || row.triage_score || 0),
        reason_codes: reasonCodes.length > 0 ? reasonCodes : ['summary_fallback']
      };
    })
    .filter(Boolean);
  return {
    generated_at: String(runSummary.generated_at || '').trim() || null,
    provider: String(runSummary.discovery?.provider || '').trim() || null,
    query_count: attemptRows.length,
    candidates_checked: 0,
    urls_triaged: 0,
    urls_selected: selectedUrls.length,
    urls_rejected: 0,
    dedupe_input: 0,
    dedupe_output: 0,
    duplicates_removed: 0,
    summary_only: true,
    selected_urls: selectedUrls,
    queries: attemptRows.map((row) => ({
      query: String(row?.query || '').trim(),
      hint_source: '',
      target_fields: [],
      doc_hint: '',
      domain_hint: '',
      result_count: Number(row?.result_count || 0),
      attempts: 1,
      providers: [String(row?.provider || '').trim()].filter(Boolean),
      candidate_count: 0,
      selected_count: 0,
      candidates: []
    }))
  };
}

export async function readIndexLabRunLlmTraces(runId, limit = 80) {
  const context = await resolveIndexLabRunContext(runId);
  if (!context) return null;
  const traceRoot = path.join(
    _outputRoot,
    '_runtime',
    'traces',
    'runs',
    normalizePathToken(context.resolvedRunId, 'run'),
    normalizePathToken(context.productId, 'product'),
    'llm'
  );
  let entries = [];
  try {
    entries = await fs.readdir(traceRoot, { withFileTypes: true });
  } catch {
    return {
      generated_at: new Date().toISOString(),
      run_id: context.resolvedRunId,
      category: context.category,
      product_id: context.productId,
      count: 0,
      traces: []
    };
  }
  const fileRows = entries
    .filter((entry) => entry.isFile() && /^call_\d+\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const traces = [];
  for (const name of fileRows) {
    const filePath = path.join(traceRoot, name);
    const row = await safeReadJson(filePath);
    if (!row || typeof row !== 'object') continue;
    const usage = row.usage && typeof row.usage === 'object'
      ? row.usage
      : {};
    const prompt = row.prompt && typeof row.prompt === 'object'
      ? row.prompt
      : {};
    const response = row.response && typeof row.response === 'object'
      ? row.response
      : {};
    const routeRole = String(row.route_role || '').trim().toLowerCase();
    const purpose = String(row.purpose || '').trim();
    const ts = String(row.ts || '').trim();
    const tsMs = Date.parse(ts);
    traces.push({
      id: `${context.resolvedRunId}:${name}`,
      ts: ts || null,
      ts_ms: Number.isFinite(tsMs) ? tsMs : 0,
      phase: classifyLlmTracePhase(purpose, routeRole),
      role: routeRole || null,
      purpose: purpose || null,
      status: String(row.status || '').trim() || null,
      provider: String(row.provider || '').trim() || null,
      model: String(row.model || '').trim() || null,
      retry_without_schema: Boolean(row.retry_without_schema),
      json_schema_requested: Boolean(row.json_schema_requested),
      max_tokens_applied: toInt(row.max_tokens_applied, 0),
      target_fields: Array.isArray(row.target_fields)
        ? row.target_fields.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 80)
        : [],
      target_fields_count: toInt(row.target_fields_count, 0),
      prompt_preview: normalizeJsonText(prompt, 8000),
      response_preview: normalizeJsonText(response, 12000),
      error: String(row.error || '').trim() || null,
      usage: {
        prompt_tokens: toInt(usage.prompt_tokens, toInt(usage.input_tokens, 0)),
        completion_tokens: toInt(usage.completion_tokens, toInt(usage.output_tokens, 0)),
        cached_prompt_tokens: toInt(usage.cached_prompt_tokens, toInt(usage.cached_input_tokens, 0)),
        total_tokens: toInt(usage.total_tokens, 0)
      },
      trace_file: name
    });
  }
  traces.sort((a, b) => {
    if (b.ts_ms !== a.ts_ms) return b.ts_ms - a.ts_ms;
    return String(b.trace_file || '').localeCompare(String(a.trace_file || ''));
  });
  const maxRows = Math.max(1, toInt(limit, 80));
  return {
    generated_at: new Date().toISOString(),
    run_id: context.resolvedRunId,
    category: context.category,
    product_id: context.productId,
    count: traces.length,
    traces: traces.slice(0, maxRows).map(({ ts_ms, ...row }) => row)
  };
}

export async function readIndexLabRunEvidenceIndex(runId, { query = '', limit = 40 } = {}) {
  const context = await resolveIndexLabRunContext(runId);
  if (!context) return null;
  const requestedQuery = String(query || '').trim();
  const requestedLimit = Math.max(1, Math.min(120, toInt(limit, 40)));
  const specDb = await _getSpecDbReady(context.category);
  if (!specDb?.db) {
    return {
      generated_at: new Date().toISOString(),
      run_id: context.resolvedRunId,
      category: context.category,
      product_id: context.productId,
      db_ready: false,
      scope: {
        mode: 'none',
        run_match: false,
        run_id: context.resolvedRunId
      },
      summary: {
        documents: 0,
        artifacts: 0,
        artifacts_with_hash: 0,
        unique_hashes: 0,
        assertions: 0,
        evidence_refs: 0,
        fields_covered: 0
      },
      documents: [],
      top_fields: [],
      search: {
        query: requestedQuery,
        limit: requestedLimit,
        count: 0,
        rows: [],
        note: 'spec_db_not_ready'
      }
    };
  }

  const db = specDb.db;
  const scopeBaseSql = `
    sr.category = @category
    AND (
      sr.product_id = @product_id
      OR sr.item_identifier = @product_id
    )
  `;
  const scopeParams = {
    category: context.category,
    product_id: context.productId,
    run_id: context.resolvedRunId
  };
  const runCountRow = db.prepare(
    `SELECT COUNT(*) AS c FROM source_registry sr WHERE ${scopeBaseSql} AND sr.run_id = @run_id`
  ).get(scopeParams);
  const runMatch = toInt(runCountRow?.c, 0) > 0;
  const scopeMode = runMatch ? 'run' : 'product_fallback';
  const scopeSql = runMatch
    ? `${scopeBaseSql} AND sr.run_id = @run_id`
    : scopeBaseSql;

  const summaryRow = db.prepare(`
    SELECT
      COUNT(DISTINCT sr.source_id) AS documents,
      COUNT(sa.artifact_id) AS artifacts,
      SUM(CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN 1 ELSE 0 END) AS artifacts_with_hash,
      COUNT(DISTINCT CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN sa.content_hash END) AS unique_hashes,
      COUNT(DISTINCT asr.assertion_id) AS assertions,
      COUNT(ser.evidence_ref_id) AS evidence_refs,
      COUNT(DISTINCT asr.field_key) AS fields_covered
    FROM source_registry sr
    LEFT JOIN source_artifacts sa ON sa.source_id = sr.source_id
    LEFT JOIN source_assertions asr ON asr.source_id = sr.source_id
    LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
    WHERE ${scopeSql}
  `).get(scopeParams) || {};

  const documents = db.prepare(`
    SELECT
      sr.source_id,
      sr.source_url,
      sr.source_host,
      sr.source_tier,
      sr.crawl_status,
      sr.http_status,
      sr.fetched_at,
      sr.run_id,
      COUNT(DISTINCT sa.artifact_id) AS artifact_count,
      SUM(CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN 1 ELSE 0 END) AS hash_count,
      COUNT(DISTINCT CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN sa.content_hash END) AS unique_hashes,
      COUNT(DISTINCT asr.assertion_id) AS assertion_count,
      COUNT(ser.evidence_ref_id) AS evidence_ref_count
    FROM source_registry sr
    LEFT JOIN source_artifacts sa ON sa.source_id = sr.source_id
    LEFT JOIN source_assertions asr ON asr.source_id = sr.source_id
    LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
    WHERE ${scopeSql}
    GROUP BY sr.source_id
    ORDER BY COALESCE(sr.fetched_at, sr.updated_at, sr.created_at) DESC, sr.source_id
    LIMIT 120
  `).all(scopeParams);

  const topFields = db.prepare(`
    SELECT
      asr.field_key,
      COUNT(DISTINCT asr.assertion_id) AS assertions,
      COUNT(ser.evidence_ref_id) AS evidence_refs,
      COUNT(DISTINCT asr.source_id) AS distinct_sources
    FROM source_assertions asr
    JOIN source_registry sr ON sr.source_id = asr.source_id
    LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
    WHERE ${scopeSql}
    GROUP BY asr.field_key
    ORDER BY assertions DESC, evidence_refs DESC, asr.field_key
    LIMIT 80
  `).all(scopeParams);

  let searchRows = [];
  if (requestedQuery) {
    const queryToken = requestedQuery.toLowerCase();
    const queryLike = `%${queryToken}%`;
    const rankedRows = db.prepare(`
      SELECT
        sr.source_id,
        sr.source_url,
        sr.source_host,
        sr.source_tier,
        sr.run_id,
        asr.assertion_id,
        asr.field_key,
        asr.context_kind,
        asr.value_raw,
        asr.value_normalized,
        ser.snippet_id,
        ser.evidence_url,
        ser.quote,
        c.snippet_text
      FROM source_registry sr
      JOIN source_assertions asr ON asr.source_id = sr.source_id
      LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
      LEFT JOIN candidates c
        ON c.candidate_id = asr.candidate_id
       AND c.category = sr.category
      WHERE ${scopeSql}
        AND (
          LOWER(COALESCE(asr.field_key, '')) LIKE @query_like
          OR LOWER(COALESCE(asr.value_raw, '')) LIKE @query_like
          OR LOWER(COALESCE(asr.value_normalized, '')) LIKE @query_like
          OR LOWER(COALESCE(ser.quote, '')) LIKE @query_like
          OR LOWER(COALESCE(c.snippet_text, '')) LIKE @query_like
        )
      ORDER BY
        CASE
          WHEN LOWER(COALESCE(asr.field_key, '')) = @query_exact THEN 0
          WHEN LOWER(COALESCE(asr.field_key, '')) LIKE @query_like THEN 1
          WHEN LOWER(COALESCE(asr.value_raw, '')) LIKE @query_like THEN 2
          WHEN LOWER(COALESCE(ser.quote, '')) LIKE @query_like THEN 3
          ELSE 4
        END,
        COALESCE(sr.source_tier, 99) ASC,
        COALESCE(sr.fetched_at, sr.updated_at, sr.created_at) DESC,
        sr.source_id
      LIMIT @limit
    `).all({
      ...scopeParams,
      query_like: queryLike,
      query_exact: queryToken,
      limit: requestedLimit
    });

    searchRows = rankedRows.map((row) => ({
      source_id: String(row.source_id || '').trim(),
      source_url: String(row.source_url || '').trim(),
      source_host: String(row.source_host || '').trim(),
      source_tier: row.source_tier === null || row.source_tier === undefined
        ? null
        : toInt(row.source_tier, 0),
      run_id: String(row.run_id || '').trim() || null,
      field_key: String(row.field_key || '').trim(),
      context_kind: String(row.context_kind || '').trim(),
      assertion_id: String(row.assertion_id || '').trim(),
      snippet_id: String(row.snippet_id || '').trim() || null,
      evidence_url: String(row.evidence_url || '').trim() || null,
      quote_preview: String(row.quote || '').trim().slice(0, 280),
      snippet_preview: String(row.snippet_text || '').trim().slice(0, 280),
      value_preview: String(row.value_raw || row.value_normalized || '').trim().slice(0, 160)
    }));
  }

  return {
    generated_at: new Date().toISOString(),
    run_id: context.resolvedRunId,
    category: context.category,
    product_id: context.productId,
    db_ready: true,
    scope: {
      mode: scopeMode,
      run_match: runMatch,
      run_id: context.resolvedRunId
    },
    summary: {
      documents: toInt(summaryRow.documents, 0),
      artifacts: toInt(summaryRow.artifacts, 0),
      artifacts_with_hash: toInt(summaryRow.artifacts_with_hash, 0),
      unique_hashes: toInt(summaryRow.unique_hashes, 0),
      assertions: toInt(summaryRow.assertions, 0),
      evidence_refs: toInt(summaryRow.evidence_refs, 0),
      fields_covered: toInt(summaryRow.fields_covered, 0)
    },
    documents: documents.map((row) => ({
      source_id: String(row.source_id || '').trim(),
      source_url: String(row.source_url || '').trim(),
      source_host: String(row.source_host || '').trim(),
      source_tier: row.source_tier === null || row.source_tier === undefined
        ? null
        : toInt(row.source_tier, 0),
      crawl_status: String(row.crawl_status || '').trim(),
      http_status: row.http_status === null || row.http_status === undefined
        ? null
        : toInt(row.http_status, 0),
      fetched_at: String(row.fetched_at || '').trim() || null,
      run_id: String(row.run_id || '').trim() || null,
      artifact_count: toInt(row.artifact_count, 0),
      hash_count: toInt(row.hash_count, 0),
      unique_hashes: toInt(row.unique_hashes, 0),
      assertion_count: toInt(row.assertion_count, 0),
      evidence_ref_count: toInt(row.evidence_ref_count, 0)
    })),
    top_fields: topFields.map((row) => ({
      field_key: String(row.field_key || '').trim(),
      assertions: toInt(row.assertions, 0),
      evidence_refs: toInt(row.evidence_refs, 0),
      distinct_sources: toInt(row.distinct_sources, 0)
    })),
    search: {
      query: requestedQuery,
      limit: requestedLimit,
      count: searchRows.length,
      rows: searchRows
    },
    dedupe_stream: await (async () => {
      try {
        const events = await readIndexLabRunEvents(context.resolvedRunId, 8000);
        const DEDUPE_EVENT_NAMES = new Set(['indexed_new', 'dedupe_hit', 'dedupe_updated']);
        const dedupeEvents = events.filter((e) => DEDUPE_EVENT_NAMES.has(e?.event));
        const payload = buildEvidenceSearchPayload({ dedupeEvents, query: requestedQuery });
        return payload.dedupe_stream;
      } catch {
        return { total: 0, new_count: 0, reused_count: 0, updated_count: 0, total_chunks_indexed: 0 };
      }
    })()
  };
}

export function clampAutomationPriority(value, fallback = 50) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, parsed));
}

export function automationPriorityForRequiredLevel(requiredLevel = '') {
  const level = String(requiredLevel || '').trim().toLowerCase();
  if (level === 'identity') return 10;
  if (level === 'critical') return 20;
  if (level === 'required') return 35;
  if (level === 'expected') return 60;
  if (level === 'optional') return 80;
  return 50;
}

export function automationPriorityForJobType(jobType = '') {
  const token = String(jobType || '').trim().toLowerCase();
  if (token === 'repair_search') return 20;
  if (token === 'deficit_rediscovery') return 35;
  if (token === 'staleness_refresh') return 55;
  if (token === 'domain_backoff') return 65;
  return 50;
}

export function toStringList(value, limit = 20) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, Math.max(1, toInt(limit, 20)));
}

export function addUniqueStrings(base = [], extra = [], limit = 20) {
  const cap = Math.max(1, toInt(limit, 20));
  const seen = new Set(
    (Array.isArray(base) ? base : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  );
  for (const value of Array.isArray(extra) ? extra : []) {
    const token = String(value || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    if (seen.size >= cap) break;
  }
  return [...seen];
}

export function buildAutomationJobId(prefix = '', dedupeKey = '') {
  const lhs = String(prefix || 'job').trim().toLowerCase() || 'job';
  const rhs = String(dedupeKey || '').trim().toLowerCase();
  if (!rhs) return `${lhs}:na`;
  let hash = 0;
  for (let i = 0; i < rhs.length; i += 1) {
    hash = ((hash << 5) - hash + rhs.charCodeAt(i)) | 0;
  }
  return `${lhs}:${Math.abs(hash).toString(36)}`;
}

export function normalizeAutomationStatus(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'queued') return 'queued';
  if (token === 'running') return 'running';
  if (token === 'done') return 'done';
  if (token === 'failed') return 'failed';
  if (token === 'cooldown') return 'cooldown';
  return 'queued';
}

export function normalizeAutomationQuery(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function buildSearchProfileQueryMaps(searchProfile = {}) {
  const queryToFields = new Map();
  const fieldStats = new Map();
  const queryRows = Array.isArray(searchProfile?.query_rows) ? searchProfile.query_rows : [];
  const queryStatsRows = Array.isArray(searchProfile?.query_stats) ? searchProfile.query_stats : [];
  const fieldTargetQueries = searchProfile?.field_target_queries && typeof searchProfile.field_target_queries === 'object'
    ? searchProfile.field_target_queries
    : {};

  const ensureFieldStat = (fieldKey) => {
    const field = String(fieldKey || '').trim();
    if (!field) return null;
    if (!fieldStats.has(field)) {
      fieldStats.set(field, {
        attempts: 0,
        results: 0,
        queries: new Set()
      });
    }
    return fieldStats.get(field);
  };

  const queryStatsByQuery = new Map();
  for (const row of queryStatsRows) {
    const queryRaw = String(row?.query || '').trim();
    const query = normalizeAutomationQuery(queryRaw);
    if (!query) continue;
    queryStatsByQuery.set(query, {
      attempts: Math.max(0, toInt(row?.attempts, 0)),
      result_count: Math.max(0, toInt(row?.result_count, 0))
    });
  }

  for (const row of queryRows) {
    const queryRaw = String(row?.query || '').trim();
    const query = normalizeAutomationQuery(queryRaw);
    if (!query) continue;
    const targetFields = toStringList(row?.target_fields, 24);
    if (targetFields.length > 0) {
      if (!queryToFields.has(query)) queryToFields.set(query, new Set());
      const querySet = queryToFields.get(query);
      for (const field of targetFields) {
        querySet.add(field);
      }
    }
    const statsFallback = queryStatsByQuery.get(query) || {
      attempts: Math.max(0, toInt(row?.attempts, 0)),
      result_count: Math.max(0, toInt(row?.result_count, 0))
    };
    for (const field of targetFields) {
      const stat = ensureFieldStat(field);
      if (!stat) continue;
      stat.attempts += Math.max(0, toInt(statsFallback.attempts, 0));
      stat.results += Math.max(0, toInt(statsFallback.result_count, 0));
      stat.queries.add(queryRaw);
    }
  }

  for (const [fieldRaw, queriesRaw] of Object.entries(fieldTargetQueries)) {
    const field = String(fieldRaw || '').trim();
    if (!field) continue;
    const stat = ensureFieldStat(field);
    if (!stat) continue;
    const queries = toStringList(queriesRaw, 20);
    for (const query of queries) {
      const queryToken = normalizeAutomationQuery(query);
      if (!queryToken) continue;
      if (!queryToFields.has(queryToken)) queryToFields.set(queryToken, new Set());
      queryToFields.get(queryToken).add(field);
      stat.queries.add(query);
    }
  }

  const queryToFieldsFlat = new Map();
  for (const [query, set] of queryToFields.entries()) {
    queryToFieldsFlat.set(query, [...set].slice(0, 20));
  }
  const fieldStatsFlat = new Map();
  for (const [field, row] of fieldStats.entries()) {
    fieldStatsFlat.set(field, {
      attempts: Math.max(0, toInt(row?.attempts, 0)),
      results: Math.max(0, toInt(row?.results, 0)),
      queries: [...(row?.queries || new Set())].slice(0, 20)
    });
  }
  return {
    queryToFields: queryToFieldsFlat,
    fieldStats: fieldStatsFlat
  };
}

export async function readIndexLabRunAutomationQueue(runId) {
  const context = await resolveIndexLabRunContext(runId);
  if (!context) return null;

  const eventRows = await readIndexLabRunEvents(context.token, 8000);
  const needset = await readIndexLabRunNeedSet(context.token);
  const searchProfile = await readIndexLabRunSearchProfile(context.token);
  const { queryToFields, fieldStats } = buildSearchProfileQueryMaps(searchProfile || {});

  const jobsById = new Map();
  const actions = [];
  const repairJobIdByQuery = new Map();
  const deficitJobIdByField = new Map();
  const contentHashSeen = new Map();

  const sortedEvents = [...eventRows]
    .filter((row) => row && typeof row === 'object')
    .sort((a, b) => {
      const aMs = parseTsMs(a.ts);
      const bMs = parseTsMs(b.ts);
      if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) {
        return aMs - bMs;
      }
      return String(a.event || '').localeCompare(String(b.event || ''));
    });

  const ensureJob = ({
    jobType = 'deficit_rediscovery',
    dedupeKey = '',
    sourceSignal = 'manual',
    scheduledAt = '',
    priority = null,
    category = context.category,
    productId = context.productId,
    runId: resolvedRunId = context.resolvedRunId,
    fieldTargets = [],
    reasonTags = [],
    domain = '',
    url = '',
    query = '',
    provider = '',
    docHint = '',
    status = 'queued'
  } = {}) => {
    const normalizedJobType = String(jobType || '').trim().toLowerCase() || 'deficit_rediscovery';
    const normalizedDedupe = String(dedupeKey || '').trim() || `${normalizedJobType}:${sourceSignal}`;
    const jobId = buildAutomationJobId(normalizedJobType, normalizedDedupe);
    const normalizedStatus = normalizeAutomationStatus(status);
    if (!jobsById.has(jobId)) {
      jobsById.set(jobId, {
        job_id: jobId,
        job_type: normalizedJobType,
        priority: clampAutomationPriority(
          priority === null || priority === undefined
            ? automationPriorityForJobType(normalizedJobType)
            : priority,
          automationPriorityForJobType(normalizedJobType)
        ),
        status: normalizedStatus,
        category: String(category || '').trim(),
        product_id: String(productId || '').trim(),
        run_id: String(resolvedRunId || '').trim(),
        field_targets: toStringList(fieldTargets, 20),
        url: String(url || '').trim() || null,
        domain: String(domain || '').trim() || null,
        query: String(query || '').trim() || null,
        provider: String(provider || '').trim() || null,
        doc_hint: String(docHint || '').trim() || null,
        dedupe_key: normalizedDedupe,
        source_signal: String(sourceSignal || '').trim() || 'manual',
        scheduled_at: String(scheduledAt || '').trim() || null,
        started_at: null,
        finished_at: null,
        next_run_at: null,
        attempt_count: 0,
        reason_tags: toStringList(reasonTags, 24),
        last_error: null,
        notes: []
      });
    }
    const job = jobsById.get(jobId);
    if (fieldTargets?.length) {
      job.field_targets = addUniqueStrings(job.field_targets, fieldTargets, 20);
    }
    if (reasonTags?.length) {
      job.reason_tags = addUniqueStrings(job.reason_tags, reasonTags, 24);
    }
    if (!job.url && url) job.url = String(url).trim();
    if (!job.domain && domain) job.domain = String(domain).trim();
    if (!job.query && query) job.query = String(query).trim();
    if (!job.provider && provider) job.provider = String(provider).trim();
    if (!job.doc_hint && docHint) job.doc_hint = String(docHint).trim();
    if (!job.scheduled_at && scheduledAt) job.scheduled_at = String(scheduledAt).trim();
    return job;
  };

  const pushAction = ({
    ts = '',
    event = '',
    job = null,
    status = '',
    detail = '',
    reasonTags = []
  } = {}) => {
    if (!job) return;
    actions.push({
      ts: String(ts || '').trim() || null,
      event: String(event || '').trim() || null,
      job_id: job.job_id,
      job_type: job.job_type,
      status: normalizeAutomationStatus(status || job.status),
      source_signal: job.source_signal,
      priority: clampAutomationPriority(job.priority, 50),
      detail: String(detail || '').trim() || null,
      domain: job.domain || null,
      url: job.url || null,
      query: job.query || null,
      field_targets: toStringList(job.field_targets, 20),
      reason_tags: addUniqueStrings(job.reason_tags || [], reasonTags, 24)
    });
  };

  const transitionJob = ({
    job = null,
    status = 'queued',
    ts = '',
    detail = '',
    nextRunAt = '',
    reasonTags = [],
    error = ''
  } = {}) => {
    if (!job) return;
    const normalizedStatus = normalizeAutomationStatus(status);
    job.status = normalizedStatus;
    const safeTs = String(ts || '').trim();
    if (normalizedStatus === 'queued') {
      if (safeTs) job.scheduled_at = safeTs;
      job.finished_at = null;
      job.last_error = null;
    }
    if (normalizedStatus === 'running') {
      if (safeTs) job.started_at = safeTs;
      job.finished_at = null;
      job.attempt_count = Math.max(0, toInt(job.attempt_count, 0)) + 1;
      job.last_error = null;
    }
    if (normalizedStatus === 'done') {
      if (safeTs && !job.started_at) {
        job.started_at = safeTs;
        job.attempt_count = Math.max(0, toInt(job.attempt_count, 0)) + 1;
      }
      if (safeTs) job.finished_at = safeTs;
      job.last_error = null;
    }
    if (normalizedStatus === 'failed') {
      if (safeTs && !job.started_at) {
        job.started_at = safeTs;
        job.attempt_count = Math.max(0, toInt(job.attempt_count, 0)) + 1;
      }
      if (safeTs) job.finished_at = safeTs;
      job.last_error = String(error || detail || 'job_failed').trim() || 'job_failed';
    }
    if (normalizedStatus === 'cooldown') {
      if (safeTs && !job.started_at) {
        job.started_at = safeTs;
      }
      if (safeTs) job.finished_at = safeTs;
    }
    const nextRun = String(nextRunAt || '').trim();
    if (nextRun) {
      job.next_run_at = nextRun;
    }
    if (reasonTags?.length) {
      job.reason_tags = addUniqueStrings(job.reason_tags, reasonTags, 24);
    }
    const detailToken = String(detail || '').trim();
    if (detailToken) {
      job.notes = addUniqueStrings(job.notes, [detailToken], 20);
    }
  };

  const setRepairJobByQuery = (query = '', job = null) => {
    const token = normalizeAutomationQuery(query);
    if (!token || !job) return;
    repairJobIdByQuery.set(token, job.job_id);
  };

  const getRepairJobByQuery = (query = '') => {
    const token = normalizeAutomationQuery(query);
    if (!token) return null;
    const jobId = repairJobIdByQuery.get(token);
    if (!jobId) return null;
    return jobsById.get(jobId) || null;
  };

  const setDeficitJobByField = (fieldKey = '', job = null) => {
    const token = String(fieldKey || '').trim();
    if (!token || !job) return;
    deficitJobIdByField.set(token, job.job_id);
  };

  const getDeficitJobsForQuery = (query = '') => {
    const token = normalizeAutomationQuery(query);
    if (!token) return [];
    const fields = queryToFields.get(token) || [];
    return fields
      .map((field) => jobsById.get(deficitJobIdByField.get(field)))
      .filter(Boolean);
  };

  for (const evt of sortedEvents) {
    const eventName = String(evt?.event || '').trim().toLowerCase();
    if (!eventName) continue;
    const payload = evt?.payload && typeof evt.payload === 'object'
      ? evt.payload
      : {};
    const ts = String(evt?.ts || payload.ts || '').trim();
    const query = String(payload.query || evt.query || '').trim();
    const url = String(payload.url || payload.source_url || evt.url || evt.source_url || '').trim();
    const domain = normalizeDomainToken(
      payload.domain || payload.host || evt.domain || evt.host || domainFromUrl(url)
    );
    const provider = String(payload.provider || evt.provider || '').trim();

    if (eventName === 'repair_query_enqueued') {
      const reason = String(payload.reason || evt.reason || '').trim();
      const docHint = String(payload.doc_hint || evt.doc_hint || '').trim();
      const fieldTargets = toStringList(payload.field_targets || evt.field_targets, 16);
      const dedupeKey = [
        'repair',
        domain,
        query.toLowerCase(),
        fieldTargets.join('|').toLowerCase(),
        reason.toLowerCase()
      ].join('::');
      const job = ensureJob({
        jobType: 'repair_search',
        dedupeKey,
        sourceSignal: 'url_health',
        scheduledAt: ts,
        priority: 20,
        fieldTargets,
        reasonTags: [reason || 'repair_signal', 'phase_04_signal'],
        domain,
        url,
        query,
        provider,
        docHint,
        status: 'queued'
      });
      transitionJob({
        job,
        status: 'queued',
        ts,
        detail: reason || 'repair_query_enqueued',
        reasonTags: [reason || 'repair_signal']
      });
      setRepairJobByQuery(query, job);
      pushAction({
        ts,
        event: eventName,
        job,
        status: 'queued',
        detail: reason || 'repair_query_enqueued',
        reasonTags: [reason || 'repair_signal']
      });
      continue;
    }

    if (eventName === 'blocked_domain_cooldown_applied') {
      const reason = toInt(payload.status, toInt(evt.status, 0)) === 429
        ? 'status_429_backoff'
        : 'status_403_backoff';
      const dedupeKey = `domain_backoff::${domain}::${reason}`;
      const job = ensureJob({
        jobType: 'domain_backoff',
        dedupeKey,
        sourceSignal: 'url_health',
        scheduledAt: ts,
        priority: 65,
        reasonTags: [reason, 'blocked_domain_threshold'],
        domain,
        status: 'cooldown'
      });
      transitionJob({
        job,
        status: 'cooldown',
        ts,
        detail: `blocked domain threshold reached (${toInt(payload.blocked_count, 0)})`,
        reasonTags: [reason]
      });
      pushAction({
        ts,
        event: eventName,
        job,
        status: 'cooldown',
        detail: `blocked domain threshold reached (${toInt(payload.blocked_count, 0)})`,
        reasonTags: [reason]
      });
      continue;
    }

    if (eventName === 'url_cooldown_applied') {
      const reason = String(payload.reason || evt.reason || '').trim().toLowerCase() || 'cooldown';
      const nextRetryAt = String(payload.next_retry_ts || payload.next_retry_at || payload.cooldown_until || evt.next_retry_ts || '').trim();
      const isPathDead = reason === 'path_dead_pattern';
      const jobType = isPathDead ? 'repair_search' : 'domain_backoff';
      const dedupeKey = `${jobType}::${domain}::${reason}::${urlPathToken(url || '/')}`;
      const job = ensureJob({
        jobType,
        dedupeKey,
        sourceSignal: 'url_health',
        scheduledAt: ts,
        priority: isPathDead ? 22 : 68,
        reasonTags: [reason],
        domain,
        url,
        status: 'cooldown'
      });
      transitionJob({
        job,
        status: 'cooldown',
        ts,
        detail: reason,
        nextRunAt: nextRetryAt,
        reasonTags: [reason]
      });
      pushAction({
        ts,
        event: eventName,
        job,
        status: 'cooldown',
        detail: reason,
        reasonTags: [reason]
      });
      continue;
    }

    if (eventName === 'source_fetch_skipped') {
      const skipReason = String(payload.skip_reason || payload.reason || evt.skip_reason || evt.reason || '').trim().toLowerCase();
      if (skipReason === 'retry_later' || skipReason === 'blocked_budget' || skipReason === 'cooldown') {
        const nextRetryAt = String(payload.next_retry_ts || payload.next_retry_at || evt.next_retry_ts || '').trim();
        const dedupeKey = `domain_backoff::${domain}::${skipReason}::${urlPathToken(url || '/')}`;
        const job = ensureJob({
          jobType: 'domain_backoff',
          dedupeKey,
          sourceSignal: 'url_health',
          scheduledAt: ts,
          priority: 70,
          reasonTags: [skipReason],
          domain,
          url,
          status: 'cooldown'
        });
        transitionJob({
          job,
          status: 'cooldown',
          ts,
          detail: skipReason,
          nextRunAt: nextRetryAt,
          reasonTags: [skipReason]
        });
        pushAction({
          ts,
          event: eventName,
          job,
          status: 'cooldown',
          detail: skipReason,
          reasonTags: [skipReason]
        });
      }
      continue;
    }

    if (eventName === 'source_processed' || eventName === 'fetch_finished') {
      const statusCode = toInt(payload.status, toInt(evt.status, 0));
      const contentHash = String(payload.content_hash || payload.contentHash || evt.content_hash || '').trim();
      if (statusCode >= 200 && statusCode < 300 && contentHash) {
        const seen = contentHashSeen.get(contentHash);
        if (!seen) {
          contentHashSeen.set(contentHash, {
            ts,
            url,
            host: domain
          });
        } else {
          const dedupeKey = `staleness_refresh::${contentHash}`;
          const job = ensureJob({
            jobType: 'staleness_refresh',
            dedupeKey,
            sourceSignal: 'staleness',
            scheduledAt: ts,
            priority: 55,
            reasonTags: ['content_hash_duplicate'],
            domain,
            url,
            status: 'done'
          });
          transitionJob({
            job,
            status: 'done',
            ts,
            detail: `content hash repeated (first ${seen.ts || '-'})`,
            reasonTags: ['content_hash_duplicate']
          });
          pushAction({
            ts,
            event: 'staleness_hash_duplicate',
            job,
            status: 'done',
            detail: `content hash repeated (first ${seen.ts || '-'})`,
            reasonTags: ['content_hash_duplicate']
          });
        }
      }
      continue;
    }

    if (eventName === 'discovery_query_started' || eventName === 'search_started') {
      const repairJob = getRepairJobByQuery(query);
      if (repairJob) {
        transitionJob({
          job: repairJob,
          status: 'running',
          ts,
          detail: 'repair query execution started'
        });
        pushAction({
          ts,
          event: eventName,
          job: repairJob,
          status: 'running',
          detail: 'repair query execution started'
        });
      }
      for (const deficitJob of getDeficitJobsForQuery(query)) {
        transitionJob({
          job: deficitJob,
          status: 'running',
          ts,
          detail: 'deficit rediscovery query started'
        });
        pushAction({
          ts,
          event: eventName,
          job: deficitJob,
          status: 'running',
          detail: 'deficit rediscovery query started'
        });
      }
      continue;
    }

    if (eventName === 'discovery_query_completed' || eventName === 'search_finished') {
      const resultCount = Math.max(0, toInt(payload.result_count, toInt(evt.result_count, 0)));
      const repairJob = getRepairJobByQuery(query);
      if (repairJob) {
        const done = resultCount > 0;
        transitionJob({
          job: repairJob,
          status: done ? 'done' : 'failed',
          ts,
          detail: done ? `repair query completed with ${resultCount} results` : 'repair query returned no results',
          error: done ? '' : 'repair_no_results'
        });
        pushAction({
          ts,
          event: eventName,
          job: repairJob,
          status: done ? 'done' : 'failed',
          detail: done ? `repair query completed with ${resultCount} results` : 'repair query returned no results',
          reasonTags: [done ? 'results_found' : 'no_results']
        });
      }
      for (const deficitJob of getDeficitJobsForQuery(query)) {
        const done = resultCount > 0;
        transitionJob({
          job: deficitJob,
          status: done ? 'done' : 'failed',
          ts,
          detail: done ? `deficit query completed with ${resultCount} results` : 'deficit query returned no results',
          error: done ? '' : 'deficit_no_results'
        });
        pushAction({
          ts,
          event: eventName,
          job: deficitJob,
          status: done ? 'done' : 'failed',
          detail: done ? `deficit query completed with ${resultCount} results` : 'deficit query returned no results',
          reasonTags: [done ? 'results_found' : 'no_results']
        });
      }
      continue;
    }
  }

  const needRows = Array.isArray(needset?.needs) ? needset.needs : [];
  const deficitCandidates = needRows
    .map((row) => ({
      field_key: String(row?.field_key || '').trim(),
      required_level: String(row?.required_level || '').trim().toLowerCase(),
      need_score: Number.parseFloat(String(row?.need_score ?? 0)) || 0,
      reasons: toStringList(row?.reasons, 12)
    }))
    .filter((row) => row.field_key)
    .filter((row) => row.reasons.some((reason) => (
      reason === 'missing'
      || reason === 'tier_pref_unmet'
      || reason === 'min_refs_fail'
      || reason === 'low_conf'
      || reason === 'conflict'
      || reason === 'publish_gate_block'
      || reason === 'blocked_by_identity'
    )))
    .sort((a, b) => b.need_score - a.need_score || a.field_key.localeCompare(b.field_key))
    .slice(0, 16);

  for (const row of deficitCandidates) {
    const field = row.field_key;
    const stats = fieldStats.get(field) || { attempts: 0, results: 0, queries: [] };
    const querySample = Array.isArray(stats.queries) ? stats.queries[0] : '';
    const dedupeKey = `deficit_rediscovery::${field}`;
    const job = ensureJob({
      jobType: 'deficit_rediscovery',
      dedupeKey,
      sourceSignal: 'needset_deficit',
      scheduledAt: String(needset?.generated_at || '').trim() || context.meta?.started_at || '',
      priority: automationPriorityForRequiredLevel(row.required_level),
      fieldTargets: [field],
      reasonTags: row.reasons,
      query: String(querySample || '').trim(),
      provider: String(searchProfile?.provider || '').trim(),
      status: 'queued'
    });
    setDeficitJobByField(field, job);
    if (toInt(stats.attempts, 0) > 0) {
      const hasResults = toInt(stats.results, 0) > 0;
      transitionJob({
        job,
        status: hasResults ? 'done' : 'failed',
        ts: String(needset?.generated_at || context.meta?.ended_at || context.meta?.started_at || '').trim(),
        detail: hasResults
          ? `searchprofile queries returned ${toInt(stats.results, 0)} results`
          : 'searchprofile queries executed with no results',
        error: hasResults ? '' : 'searchprofile_no_results'
      });
      pushAction({
        ts: String(needset?.generated_at || context.meta?.ended_at || context.meta?.started_at || '').trim(),
        event: 'needset_deficit_resolved_from_searchprofile',
        job,
        status: hasResults ? 'done' : 'failed',
        detail: hasResults
          ? `searchprofile queries returned ${toInt(stats.results, 0)} results`
          : 'searchprofile queries executed with no results',
        reasonTags: [hasResults ? 'results_found' : 'no_results']
      });
    } else {
      transitionJob({
        job,
        status: 'queued',
        ts: String(needset?.generated_at || context.meta?.started_at || '').trim(),
        detail: 'needset deficit queued for rediscovery',
        reasonTags: row.reasons
      });
      pushAction({
        ts: String(needset?.generated_at || context.meta?.started_at || '').trim(),
        event: 'needset_deficit_enqueued',
        job,
        status: 'queued',
        detail: 'needset deficit queued for rediscovery',
        reasonTags: row.reasons
      });
    }
  }

  const jobs = [...jobsById.values()];
  const statusCounts = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cooldown: 0
  };
  const typeCounts = {
    repair_search: 0,
    staleness_refresh: 0,
    deficit_rediscovery: 0,
    domain_backoff: 0
  };
  for (const job of jobs) {
    const status = normalizeAutomationStatus(job.status);
    statusCounts[status] += 1;
    const jobType = String(job.job_type || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(typeCounts, jobType)) {
      typeCounts[jobType] += 1;
    }
  }

  const statusOrder = {
    running: 0,
    queued: 1,
    cooldown: 2,
    failed: 3,
    done: 4
  };
  const sortedJobs = jobs
    .sort((a, b) => {
      const aRank = statusOrder[normalizeAutomationStatus(a.status)] ?? 99;
      const bRank = statusOrder[normalizeAutomationStatus(b.status)] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aTs = parseTsMs(a.scheduled_at || a.started_at || a.finished_at || '');
      const bTs = parseTsMs(b.scheduled_at || b.started_at || b.finished_at || '');
      if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return bTs - aTs;
      return String(a.job_id || '').localeCompare(String(b.job_id || ''));
    })
    .slice(0, 300);

  const sortedActions = actions
    .sort((a, b) => parseTsMs(String(b.ts || '')) - parseTsMs(String(a.ts || '')))
    .slice(0, 120);

  return {
    generated_at: new Date().toISOString(),
    run_id: context.resolvedRunId,
    category: context.category,
    product_id: context.productId,
    summary: {
      total_jobs: sortedJobs.length,
      queue_depth: statusCounts.queued + statusCounts.running + statusCounts.failed,
      active_jobs: statusCounts.queued + statusCounts.running,
      ...statusCounts,
      ...typeCounts
    },
    policies: {
      owner: 'phase_06b',
      loops: {
        repair_search: true,
        staleness_refresh: true,
        deficit_rediscovery: true
      }
    },
    jobs: sortedJobs,
    actions: sortedActions
  };
}

export async function listIndexLabRuns({ limit = 50 } = {}) {
  let dirs = [];
  try {
    const entries = await fs.readdir(_indexLabRoot, { withFileTypes: true });
    dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
  dirs.sort((a, b) => String(b).localeCompare(String(a)));
  const scanLimit = Math.max(Math.max(1, toInt(limit, 50)) * 2, 120);
  dirs = dirs.slice(0, scanLimit);

  const summarizeEvents = (events = []) => {
    const counters = {
      pages_checked: 0,
      fetched_ok: 0,
      fetched_404: 0,
      fetched_blocked: 0,
      fetched_error: 0,
      parse_completed: 0,
      indexed_docs: 0,
      fields_filled: 0
    };
    let productId = '';
    let startedAt = '';
    let endedAt = '';
    for (const row of events) {
      if (!row || typeof row !== 'object') continue;
      const ts = String(row.ts || '').trim();
      if (ts) {
        if (!startedAt) startedAt = ts;
        endedAt = ts;
      }
      if (!productId) {
        productId = String(row.product_id || '').trim();
      }
      const stage = String(row.stage || '').trim();
      const event = String(row.event || '').trim();
      const payload = row.payload && typeof row.payload === 'object'
        ? row.payload
        : {};
      const scope = String(payload.scope || '').trim();
      if (stage === 'fetch' && event === 'fetch_started' && scope === 'url') {
        counters.pages_checked += 1;
      } else if (stage === 'fetch' && event === 'fetch_finished' && scope === 'url') {
        const statusClass = String(payload.status_class || 'error').trim();
        if (statusClass === 'ok') counters.fetched_ok += 1;
        else if (statusClass === '404') counters.fetched_404 += 1;
        else if (statusClass === 'blocked') counters.fetched_blocked += 1;
        else counters.fetched_error += 1;
      } else if (stage === 'parse' && event === 'parse_finished' && scope === 'url') {
        counters.parse_completed += 1;
      } else if (stage === 'index' && event === 'index_finished' && scope === 'url') {
        counters.indexed_docs += 1;
        counters.fields_filled += Number.parseInt(String(payload.count || 0), 10) || 0;
      }
    }
    return { productId, startedAt, endedAt, counters };
  };
  const normalizeStartupMs = (value) => {
    const input = value && typeof value === 'object' ? value : {};
    const parseMetric = (field) => {
      if (!(field in input)) return null;
      const raw = Number.parseInt(String(input[field] ?? ''), 10);
      return Number.isFinite(raw) ? Math.max(0, raw) : null;
    };
    return {
      first_event: parseMetric('first_event'),
      search_started: parseMetric('search_started'),
      fetch_started: parseMetric('fetch_started'),
      parse_started: parseMetric('parse_started'),
      index_started: parseMetric('index_started')
    };
  };

  const rows = [];
  for (const dir of dirs) {
    const runDir = safeJoin(_indexLabRoot, dir);
    if (!runDir) continue;
    const runMetaPath = path.join(runDir, 'run.json');
    const runEventsPath = path.join(runDir, 'run_events.ndjson');
    const meta = await safeReadJson(runMetaPath);
    const stat = await safeStat(runMetaPath) || await safeStat(runEventsPath);
    const eventRows = await readIndexLabRunEvents(dir, 6000);
    const eventSummary = summarizeEvents(eventRows);
    const rawStatus = String(meta?.status || 'unknown').trim();
    const resolvedStatus = (
      rawStatus.toLowerCase() === 'running' && !_isProcessRunning()
    ) ? 'completed' : rawStatus;
    const hasMetaCounters = meta?.counters && typeof meta.counters === 'object';
    rows.push({
      run_id: String(meta?.run_id || dir).trim(),
      category: String(meta?.category || '').trim(),
      product_id: String(meta?.product_id || eventSummary.productId || '').trim(),
      status: String(resolvedStatus || 'unknown').trim(),
      started_at: String(meta?.started_at || eventSummary.startedAt || stat?.mtime?.toISOString?.() || '').trim(),
      ended_at: String(meta?.ended_at || (resolvedStatus !== 'running' ? eventSummary.endedAt : '') || '').trim(),
      identity_fingerprint: String(meta?.identity_fingerprint || '').trim(),
      identity_lock_status: String(meta?.identity_lock_status || '').trim(),
      dedupe_mode: String(meta?.dedupe_mode || '').trim(),
      phase_cursor: String(meta?.phase_cursor || '').trim(),
      startup_ms: normalizeStartupMs(meta?.startup_ms),
      events_path: runEventsPath,
      run_dir: runDir,
      counters: hasMetaCounters ? meta.counters : eventSummary.counters
    });
  }

  rows.sort((a, b) => {
    const aMs = Date.parse(String(a.started_at || ''));
    const bMs = Date.parse(String(b.started_at || ''));
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  });
  return rows.slice(0, Math.max(1, toInt(limit, 50)));
}

export async function buildIndexingDomainChecklist({
  storage,
  config,
  outputRoot,
  category,
  productId = '',
  runId = '',
  windowMinutes = 120,
  includeUrls = false
} = {}) {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const resolvedProductId = String(productId || '').trim();
  let resolvedRunId = String(runId || '').trim();
  const brandTokens = new Set();
  const notes = [];

  if (!normalizedCategory) {
    return {
      category: null,
      productId: resolvedProductId || null,
      runId: resolvedRunId || null,
      window_minutes: windowMinutes,
      rows: [],
      milestones: {
        manufacturer_domain: null,
        manufacturer: null,
        primary_domains: []
      },
      domain_field_yield: [],
      repair_queries: [],
      bad_url_patterns: [],
      notes: ['category_required']
    };
  }

  if (resolvedProductId) {
    const pidParts = resolvedProductId.split('-').filter(Boolean);
    if (pidParts.length >= 2) {
      addTokensFromText(brandTokens, pidParts[1]);
      addTokensFromText(brandTokens, `${pidParts[1]} ${pidParts[2] || ''}`.trim());
    }
    try {
      const catalog = await loadProductCatalog(config, normalizedCategory);
      const entry = catalog?.products?.[resolvedProductId] || null;
      if (entry?.brand) {
        addTokensFromText(brandTokens, entry.brand);
      }
    } catch {
      // ignore optional catalog lookup failures
    }
  }

  if (!resolvedRunId && resolvedProductId) {
    const latestBase = storage.resolveOutputKey(normalizedCategory, resolvedProductId, 'latest');
    const latestSummary = await storage.readJsonOrNull(`${latestBase}/summary.json`).catch(() => null);
    resolvedRunId = String(latestSummary?.runId || '').trim();
  }

  let events = [];
  if (resolvedProductId && resolvedRunId) {
    const runEventsKey = storage.resolveOutputKey(
      normalizedCategory,
      resolvedProductId,
      'runs',
      resolvedRunId,
      'logs',
      'events.jsonl.gz'
    );
    const runEventsPath = path.join(outputRoot, ...runEventsKey.split('/'));
    events = await readGzipJsonlEvents(runEventsPath);
  }
  if (events.length === 0) {
    const runtimeEventsPath = path.join(outputRoot, '_runtime', 'events.jsonl');
    events = await readJsonlEvents(runtimeEventsPath);
  }

  events = events.filter((evt) => {
    const evtCategory = String(evt.category || evt.cat || '').trim().toLowerCase();
    if (evtCategory) return evtCategory === normalizedCategory;
    const pid = String(evt.productId || evt.product_id || '').trim().toLowerCase();
    return pid.startsWith(`${normalizedCategory}-`);
  });

  if (resolvedProductId) {
    events = events.filter((evt) => String(evt.productId || evt.product_id || '').trim() === resolvedProductId);
  }

  if (!resolvedRunId) {
    let latestTs = -1;
    for (const evt of events) {
      const evtRunId = String(evt.runId || '').trim();
      if (!evtRunId) continue;
      const ts = parseTsMs(evt.ts);
      if (!Number.isFinite(ts)) continue;
      if (ts > latestTs) {
        latestTs = ts;
        resolvedRunId = evtRunId;
      }
    }
  }

  if (resolvedRunId) {
    events = events.filter((evt) => String(evt.runId || '').trim() === resolvedRunId);
  } else {
    const sinceMs = Date.now() - (Math.max(5, toInt(windowMinutes, 120)) * 60 * 1000);
    events = events.filter((evt) => {
      const ts = parseTsMs(evt.ts);
      return Number.isFinite(ts) && ts >= sinceMs;
    });
    notes.push('no_run_id_resolved_using_time_window');
  }

  const buckets = new Map();
  const startTimesByKey = new Map();
  const repairQueryRows = [];
  const repairQueryDedup = new Set();
  const badUrlPatterns = new Map();
  const ensureBucket = (domain, siteKind = 'other') => {
    const host = normalizeDomainToken(domain);
    if (!host) return null;
    if (!buckets.has(host)) {
      buckets.set(host, createDomainBucket(host, siteKind));
    } else {
      const existing = buckets.get(host);
      existing.site_kind = choosePreferredSiteKind(existing.site_kind, siteKind);
    }
    return buckets.get(host);
  };

  for (const evt of events) {
    const eventName = String(evt.event || '').trim();
    const urlRaw = String(evt.url || evt.finalUrl || evt.source_url || '').trim();
    const domain = domainFromUrl(urlRaw || evt.domain || evt.host || '');
    if (!domain) continue;
    if (isHelperPseudoDomain(domain)) continue;
    const siteKind = classifySiteKind({
      domain,
      role: evt.role,
      tierName: evt.tierName,
      brandTokens
    });
    const bucket = ensureBucket(domain, siteKind);
    if (!bucket) continue;
    if (urlRaw) bucket.seen_urls.add(urlRaw);

    const normalizedRole = String(evt.role || '').trim().toLowerCase();
    if (normalizedRole) {
      bucket.roles_seen.add(normalizedRole);
      bucket.site_kind = choosePreferredSiteKind(bucket.site_kind, classifySiteKind({
        domain,
        role: normalizedRole,
        tierName: evt.tierName,
        brandTokens
      }));
    }

    const normalizedUrl = urlRaw || '';
    const fetchKey = `${String(evt.runId || resolvedRunId || '').trim()}|${normalizedUrl}`;
    if (eventName === 'source_fetch_started') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        bucket.urls_selected_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
          urlStat.selected_count += 1;
          urlStat.fetch_started_count += 1;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      bucket.started_count += 1;
      const startTs = parseTsMs(evt.ts);
      if (Number.isFinite(startTs) && normalizedUrl) {
        const arr = startTimesByKey.get(fetchKey) || [];
        arr.push(startTs);
        startTimesByKey.set(fetchKey, arr);
      }
      continue;
    }

    if (eventName === 'source_discovery_only') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      continue;
    }

    if (eventName === 'source_fetch_skipped') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const skipReason = String(evt.skip_reason || evt.reason || '').trim().toLowerCase();
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      if (skipReason === 'cooldown') {
        bucket.dedupe_hits += 1;
      }
      if (skipReason === 'blocked_budget') {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
        }
      }
      const nextRetry = String(evt.next_retry_ts || evt.next_retry_at || '').trim();
      if (nextRetry) {
        if (!bucket.next_retry_at) {
          bucket.next_retry_at = nextRetry;
        } else {
          const currentMs = parseTsMs(bucket.next_retry_at);
          const nextMs = parseTsMs(nextRetry);
          if (Number.isFinite(nextMs) && (!Number.isFinite(currentMs) || nextMs < currentMs)) {
            bucket.next_retry_at = nextRetry;
          }
        }
      }
      continue;
    }

    if (eventName === 'fields_filled_from_source') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const count = Math.max(
        0,
        toInt(evt.count, Array.isArray(evt.filled_fields) ? evt.filled_fields.length : 0)
      );
      bucket.fields_filled_count += count;
      if (normalizedUrl) {
        bucket.indexed_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.indexed = true;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      continue;
    }

    if (eventName === 'url_cooldown_applied') {
      bucket.dedupe_hits += 1;
      const nextRetry = String(
        evt.next_retry_ts || evt.next_retry_at || evt.cooldown_until || ''
      ).trim();
      const cooldownReason = String(evt.reason || '').trim();
      if (cooldownReason === 'path_dead_pattern') {
        const urlPath = String(urlPathToken(normalizedUrl || evt.url || evt.source_url || '') || '').trim() || '/';
        const patternKey = `${domain}|${urlPath}`;
        const existingPattern = badUrlPatterns.get(patternKey) || {
          domain,
          path: urlPath,
          reason: cooldownReason,
          count: 0,
          last_ts: ''
        };
        existingPattern.count += 1;
        const eventTs = String(evt.ts || '').trim();
        if (eventTs && (!existingPattern.last_ts || parseTsMs(eventTs) >= parseTsMs(existingPattern.last_ts))) {
          existingPattern.last_ts = eventTs;
        }
        badUrlPatterns.set(patternKey, existingPattern);
      }
      if (nextRetry) {
        if (!bucket.next_retry_at) {
          bucket.next_retry_at = nextRetry;
        } else {
          const currentMs = parseTsMs(bucket.next_retry_at);
          const nextMs = parseTsMs(nextRetry);
          if (Number.isFinite(nextMs) && (!Number.isFinite(currentMs) || nextMs < currentMs)) {
            bucket.next_retry_at = nextRetry;
          }
        }
      }
      continue;
    }

    if (eventName === 'repair_query_enqueued') {
      const query = String(evt.query || '').trim();
      if (query) {
        const sourceUrl = String(evt.source_url || normalizedUrl || '').trim();
        const reason = String(evt.reason || '').trim();
        const dedupeKey = `${domain}|${query}|${reason}|${sourceUrl}`;
        if (!repairQueryDedup.has(dedupeKey)) {
          repairQueryDedup.add(dedupeKey);
          repairQueryRows.push({
            ts: String(evt.ts || '').trim() || null,
            domain,
            query,
            status: toInt(evt.status, 0),
            reason: reason || null,
            source_url: sourceUrl || null,
            cooldown_until: String(evt.cooldown_until || evt.next_retry_ts || '').trim() || null,
            doc_hint: String(evt.doc_hint || '').trim() || null,
            field_targets: Array.isArray(evt.field_targets)
              ? evt.field_targets.map((row) => String(row || '').trim()).filter(Boolean).slice(0, 20)
              : []
          });
        }
      }
      continue;
    }

    if (eventName === 'source_processed' || eventName === 'source_fetch_failed') {
      const statusCode = toInt(evt.status, 0);
      const fetchOutcome = classifyFetchOutcomeFromEvent(evt);
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      bucket.completed_count += 1;
      if (fetchOutcome && Object.prototype.hasOwnProperty.call(bucket.outcome_counts, fetchOutcome)) {
        bucket.outcome_counts[fetchOutcome] += 1;
      }
      if (urlStat) {
        urlStat.processed_count += 1;
        urlStat.last_outcome = fetchOutcome || urlStat.last_outcome;
        bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts, status: statusCode });
      }
      const startArr = startTimesByKey.get(fetchKey) || [];
      if (startArr.length > 0) {
        const startTs = startArr.shift();
        if (startArr.length > 0) {
          startTimesByKey.set(fetchKey, startArr);
        } else {
          startTimesByKey.delete(fetchKey);
        }
        const endTs = parseTsMs(evt.ts);
        if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs >= startTs) {
          bucket.fetch_durations.push(endTs - startTs);
        }
      }
    }

    if (eventName === 'source_processed') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const status = toInt(evt.status, 0);
      const fetchOutcome = classifyFetchOutcomeFromEvent(evt);
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
        }
      }
      if (fetchOutcome === 'ok') {
        if (normalizedUrl) bucket.fetched_ok_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.fetched_ok = true;
        }
        const ts = String(evt.ts || '').trim();
        if (ts && (!bucket.last_success_at || parseTsMs(ts) > parseTsMs(bucket.last_success_at))) {
          bucket.last_success_at = ts;
        }
      }
      if (fetchOutcome === 'not_found' || status === 404 || status === 410) {
        bucket.err_404 += 1;
        if (normalizedUrl) incrementMapCounter(bucket.err_404_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.err_404_count += 1;
        }
      }
      if (
        fetchOutcome === 'blocked'
        || fetchOutcome === 'rate_limited'
        || fetchOutcome === 'login_wall'
        || fetchOutcome === 'bot_challenge'
      ) {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
        }
      }
      if (fetchOutcome === 'bad_content') {
        bucket.parse_fail_count += 1;
        if (urlStat) {
          urlStat.parse_fail_count += 1;
        }
      }
      if (normalizedUrl) {
        const candidateCount = toInt(evt.candidate_count, 0);
        const llmCandidateCount = toInt(evt.llm_candidate_count, 0);
        if (candidateCount > 0 || llmCandidateCount > 0) {
          bucket.indexed_urls.add(normalizedUrl);
          if (urlStat) {
            urlStat.indexed = true;
          }
        }
      }
      if (urlStat) {
        bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts, status });
      }
      continue;
    }

    if (eventName === 'source_fetch_failed') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const fetchOutcome = classifyFetchOutcomeFromEvent(evt);
      if (fetchOutcome === 'not_found') {
        bucket.err_404 += 1;
        if (normalizedUrl) incrementMapCounter(bucket.err_404_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.err_404_count += 1;
        }
      }
      if (
        fetchOutcome === 'blocked'
        || fetchOutcome === 'rate_limited'
        || fetchOutcome === 'login_wall'
        || fetchOutcome === 'bot_challenge'
      ) {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
        }
      }
      if (fetchOutcome === 'bad_content') {
        bucket.parse_fail_count += 1;
        if (urlStat) {
          urlStat.parse_fail_count += 1;
        }
      }
      if (urlStat) {
        bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
      }
    }
  }

  const domainFieldYield = new Map();
  const incrementDomainFieldYield = (domain, field) => {
    const key = `${domain}|${field}`;
    domainFieldYield.set(key, (domainFieldYield.get(key) || 0) + 1);
  };

  if (resolvedProductId) {
    const latestBase = storage.resolveOutputKey(normalizedCategory, resolvedProductId, 'latest');
    const runBase = resolvedRunId
      ? storage.resolveOutputKey(normalizedCategory, resolvedProductId, 'runs', resolvedRunId)
      : null;
    const provenance =
      (runBase && await storage.readJsonOrNull(`${runBase}/provenance/fields.provenance.json`).catch(() => null))
      || await storage.readJsonOrNull(`${latestBase}/provenance.json`).catch(() => null);

    const fieldMap = provenance && typeof provenance === 'object'
      ? (provenance.fields && typeof provenance.fields === 'object' ? provenance.fields : provenance)
      : {};

    for (const [field, row] of Object.entries(fieldMap || {})) {
      if (!row || typeof row !== 'object') continue;
      const evidence = Array.isArray(row.evidence) ? row.evidence : [];
      if (evidence.length === 0) continue;
      const known = isKnownValue(row.value);
      const passTarget = toInt(row.pass_target, 0);
      const meetsTarget = row.meets_pass_target === true;
      const used = known && (meetsTarget || passTarget > 0 || Number(row.confidence || 0) > 0);

      for (const ev of evidence) {
        const evidenceDomain = normalizeDomainToken(
          ev?.rootDomain || ev?.host || domainFromUrl(ev?.url || '')
        );
        if (!evidenceDomain) continue;
        if (isHelperPseudoDomain(evidenceDomain)) continue;
        const evidenceSiteKind = classifySiteKind({
          domain: evidenceDomain,
          role: ev?.role,
          tierName: ev?.tierName,
          brandTokens
        });
        const bucket = ensureBucket(evidenceDomain, evidenceSiteKind);
        if (!bucket) continue;
        bucket.evidence_hits += 1;
        if (used) {
          bucket.evidence_used += 1;
          bucket.fields_covered.add(field);
          incrementDomainFieldYield(evidenceDomain, field);
          if (passTarget > 0) {
            bucket.publish_gated_fields.add(field);
          }
        }
      }
    }
  } else {
    notes.push('select_product_for_evidence_contribution_metrics');
  }

  const nowMs = Date.now();
  const rows = [...buckets.values()].map((bucket) => {
    const durations = [...bucket.fetch_durations].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    const avgFetch = durations.length > 0
      ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length
      : 0;
    const cooldownSeconds = cooldownSecondsRemaining(bucket.next_retry_at, nowMs);
    const hostBudget = resolveHostBudget(bucket, cooldownSeconds);
    return {
      domain: bucket.domain,
      site_kind: bucket.site_kind,
      candidates_checked: bucket.candidates_checked_urls.size,
      urls_selected: bucket.urls_selected_urls.size,
      pages_fetched_ok: bucket.fetched_ok_urls.size,
      pages_indexed: bucket.indexed_urls.size,
      dedupe_hits: bucket.dedupe_hits,
      err_404: bucket.err_404,
      repeat_404_urls: countMapValuesAbove(bucket.err_404_by_url, 1),
      blocked_count: bucket.blocked_count,
      repeat_blocked_urls: countMapValuesAbove(bucket.blocked_by_url, 1),
      parse_fail_count: bucket.parse_fail_count,
      avg_fetch_ms: Number(avgFetch.toFixed(2)),
      p95_fetch_ms: Number(percentileFromSorted(durations, 0.95).toFixed(2)),
      evidence_hits: bucket.evidence_hits,
      evidence_used: bucket.evidence_used,
      fields_covered: bucket.fields_covered.size,
      status: resolveDomainChecklistStatus(bucket),
      host_budget_score: hostBudget.score,
      host_budget_state: hostBudget.state,
      cooldown_seconds_remaining: cooldownSeconds,
      outcome_counts: { ...bucket.outcome_counts },
      last_success_at: bucket.last_success_at || null,
      next_retry_at: bucket.next_retry_at || null,
      url_count: bucket.url_stats.size,
      urls: includeUrls
        ? [...bucket.url_stats.values()]
          .map((urlRow) => ({
            url: urlRow.url,
            checked_count: urlRow.checked_count,
            selected_count: urlRow.selected_count,
            fetch_started_count: urlRow.fetch_started_count,
            processed_count: urlRow.processed_count,
            fetched_ok: urlRow.fetched_ok,
            indexed: urlRow.indexed,
            err_404_count: urlRow.err_404_count,
            blocked_count: urlRow.blocked_count,
            parse_fail_count: urlRow.parse_fail_count,
            last_outcome: urlRow.last_outcome || null,
            last_status: urlRow.last_status || null,
            last_event: urlRow.last_event || null,
            last_ts: urlRow.last_ts || null
          }))
          .sort((a, b) => {
            const riskA = (a.err_404_count * 5) + (a.blocked_count * 5) + (a.parse_fail_count * 2);
            const riskB = (b.err_404_count * 5) + (b.blocked_count * 5) + (b.parse_fail_count * 2);
            if (riskB !== riskA) return riskB - riskA;
            const tsA = parseTsMs(a.last_ts || '');
            const tsB = parseTsMs(b.last_ts || '');
            if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsB !== tsA) return tsB - tsA;
            return String(a.url || '').localeCompare(String(b.url || ''));
          })
        : []
    };
  }).sort((a, b) => {
    const kindRank = (SITE_KIND_RANK[a.site_kind] ?? 99) - (SITE_KIND_RANK[b.site_kind] ?? 99);
    if (kindRank !== 0) return kindRank;
    if (b.evidence_used !== a.evidence_used) return b.evidence_used - a.evidence_used;
    if (b.pages_fetched_ok !== a.pages_fetched_ok) return b.pages_fetched_ok - a.pages_fetched_ok;
    if (b.urls_selected !== a.urls_selected) return b.urls_selected - a.urls_selected;
    return a.domain.localeCompare(b.domain);
  });

  const bucketByDomain = new Map([...buckets.entries()]);
  const topDomains = [...rows]
    .sort((a, b) => {
      const scoreA = (a.pages_fetched_ok * 3) + (a.pages_indexed * 2) + a.urls_selected;
      const scoreB = (b.pages_fetched_ok * 3) + (b.pages_indexed * 2) + b.urls_selected;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.domain.localeCompare(b.domain);
    });

  const manufacturerRow = rows.find((row) => row.site_kind === 'manufacturer') || null;
  const primaryDomainList = [];
  if (manufacturerRow) primaryDomainList.push(manufacturerRow.domain);
  for (const row of topDomains) {
    if (primaryDomainList.includes(row.domain)) continue;
    primaryDomainList.push(row.domain);
    if (primaryDomainList.length >= 3) break;
  }

  const buildMilestonesForBucket = (bucket) => {
    if (!bucket) {
      return {
        product_page_found: false,
        support_page_found: false,
        manual_pdf_found: false,
        spec_table_extracted: false,
        firmware_driver_found: false,
        publish_gated_fields_supported: false
      };
    }
    const urls = [...bucket.seen_urls];
    const hasPathMatch = (pattern) => urls.some((url) => pattern.test(urlPathToken(url)));
    return {
      product_page_found: hasPathMatch(/\/(product|products|gaming-mice|mice|mouse)\b/),
      support_page_found: hasPathMatch(/(support|help|faq|kb|docs?|manual|download)/),
      manual_pdf_found: hasPathMatch(/(manual|datasheet|user[-_ ]guide|owner[-_ ]manual|\.pdf($|\?))/),
      spec_table_extracted: bucket.indexed_urls.size > 0 || bucket.fields_filled_count > 0,
      firmware_driver_found: hasPathMatch(/(firmware|driver|software|download)/),
      publish_gated_fields_supported: bucket.publish_gated_fields.size > 0
    };
  };

  const primaryDomainMilestones = primaryDomainList.map((domain) => {
    const bucket = bucketByDomain.get(domain);
    const milestones = buildMilestonesForBucket(bucket);
    return {
      domain,
      site_kind: bucket?.site_kind || inferSiteKindByDomain(domain),
      ...milestones
    };
  });

  const manufacturerDomain = manufacturerRow?.domain || null;
  const manufacturerMilestones = manufacturerDomain
    ? primaryDomainMilestones.find((row) => row.domain === manufacturerDomain) || null
    : null;

  const domainFieldYieldRows = [...domainFieldYield.entries()]
    .map(([key, count]) => {
      const [domain, field] = key.split('|');
      return {
        domain,
        field,
        evidence_used_count: count
      };
    })
    .sort((a, b) => b.evidence_used_count - a.evidence_used_count || a.domain.localeCompare(b.domain) || a.field.localeCompare(b.field))
    .slice(0, 120);
  repairQueryRows.sort((a, b) => parseTsMs(String(b.ts || '')) - parseTsMs(String(a.ts || '')));
  const badUrlPatternRows = [...badUrlPatterns.values()]
    .sort((a, b) => b.count - a.count || parseTsMs(b.last_ts) - parseTsMs(a.last_ts) || a.domain.localeCompare(b.domain))
    .slice(0, 120);

  if (!manufacturerDomain) {
    notes.push('no_manufacturer_domain_detected_for_scope');
  }
  if (rows.some((row) => String(row.status || '').startsWith('dead'))) {
    notes.push('dead_status_is_url_level_not_domain_outage');
  }

  return {
    category: normalizedCategory,
    productId: resolvedProductId || null,
    runId: resolvedRunId || null,
    window_minutes: Math.max(5, toInt(windowMinutes, 120)),
    generated_at: new Date().toISOString(),
    rows,
    milestones: {
      manufacturer_domain: manufacturerDomain,
      manufacturer: manufacturerMilestones,
      primary_domains: primaryDomainMilestones
    },
    domain_field_yield: domainFieldYieldRows,
    repair_queries: repairQueryRows,
    bad_url_patterns: badUrlPatternRows,
    notes
  };
}
