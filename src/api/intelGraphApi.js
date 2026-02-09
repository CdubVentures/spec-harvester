import http from 'node:http';
import { loadSourceIntel } from '../intel/sourceIntel.js';
import { nextBestUrlsFromHypotheses } from '../learning/hypothesisQueue.js';

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function topPathsForDomain(domain, limit = 10) {
  return Object.values(domain?.per_path || {})
    .sort((a, b) => (b.planner_score || 0) - (a.planner_score || 0))
    .slice(0, Math.max(1, limit))
    .map((row) => ({
      path: row.path || '/',
      planner_score: row.planner_score || 0,
      attempts: row.attempts || 0,
      identity_match_rate: row.identity_match_rate || 0,
      major_anchor_conflict_rate: row.major_anchor_conflict_rate || 0,
      fields_accepted_count: row.fields_accepted_count || 0
    }));
}

function compactDomain(domain, topPathLimit = 10) {
  return {
    rootDomain: domain.rootDomain,
    planner_score: domain.planner_score || 0,
    attempts: domain.attempts || 0,
    identity_match_rate: domain.identity_match_rate || 0,
    major_anchor_conflict_rate: domain.major_anchor_conflict_rate || 0,
    fields_accepted_count: domain.fields_accepted_count || 0,
    accepted_critical_fields_count: domain.accepted_critical_fields_count || 0,
    products_seen: domain.products_seen || 0,
    top_paths: topPathsForDomain(domain, topPathLimit)
  };
}

function pickBestEvidence(provenance, field, limit = 10) {
  const bucket = provenance?.[field];
  if (!bucket?.evidence?.length) {
    return [];
  }
  return bucket.evidence
    .slice(0, Math.max(1, limit))
    .map((row) => ({
      url: row.url || '',
      host: row.host || '',
      rootDomain: row.rootDomain || '',
      tier: row.tier,
      tierName: row.tierName,
      method: row.method,
      keyPath: row.keyPath,
      approvedDomain: Boolean(row.approvedDomain)
    }));
}

function pickWhyFieldRejected(productSnapshot, field) {
  const summary = productSnapshot?.summary || {};
  const provenance = productSnapshot?.provenance || {};
  const normalized = productSnapshot?.normalized || {};
  const row = provenance?.[field] || {};
  const reasons = [];

  if ((summary.missing_required_fields || []).includes(field)) {
    reasons.push('missing_required_field');
  }
  if ((summary.fields_below_pass_target || []).includes(field)) {
    reasons.push('below_pass_target');
  }
  if ((summary.critical_fields_below_pass_target || []).includes(field)) {
    reasons.push('critical_field_below_pass_target');
  }
  if (row.value === 'unk' || normalized?.fields?.[field] === 'unk') {
    reasons.push('no_accepted_value');
  }
  if (row.approved_confirmations !== undefined && row.pass_target !== undefined) {
    if ((row.approved_confirmations || 0) < (row.pass_target || 0)) {
      reasons.push('insufficient_approved_confirmations');
    }
  }

  const contradictions = (summary?.constraint_analysis?.contradictions || [])
    .filter((item) => (item.fields || []).includes(field))
    .map((item) => ({
      code: item.code,
      severity: item.severity,
      message: item.message
    }));
  if (contradictions.length) {
    reasons.push('constraint_conflict');
  }

  return {
    field,
    value: normalized?.fields?.[field] ?? row.value ?? 'unk',
    confidence: row.confidence ?? null,
    pass_target: row.pass_target ?? null,
    approved_confirmations: row.approved_confirmations ?? null,
    meets_pass_target: row.meets_pass_target ?? null,
    reasons: [...new Set(reasons)],
    contradictions
  };
}

function buildConflictGraph(productSnapshot, limit = 100) {
  const summary = productSnapshot?.summary || {};
  const contradictions = summary?.constraint_analysis?.contradictions || [];
  const anchorConflicts = summary?.anchor_conflicts || [];
  const nodes = new Map();
  const edges = [];

  function ensureNode(id, kind = 'field', meta = {}) {
    if (!id) {
      return;
    }
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind, ...meta });
    }
  }

  for (const conflict of anchorConflicts) {
    const field = String(conflict.field || '').trim();
    if (!field) {
      continue;
    }
    ensureNode(field, 'field');
    const anchorNode = `anchor:${field}`;
    ensureNode(anchorNode, 'anchor', {
      field,
      expected: conflict.expected,
      observed: conflict.observed
    });
    edges.push({
      from: field,
      to: anchorNode,
      type: 'anchor_conflict',
      severity: conflict.severity || 'warning'
    });
  }

  for (const contradiction of contradictions) {
    const fields = contradiction.fields || [];
    if (fields.length === 0) {
      continue;
    }
    const contradictionId = `constraint:${contradiction.code || contradiction.message}`;
    ensureNode(contradictionId, 'constraint', {
      code: contradiction.code || '',
      message: contradiction.message || '',
      severity: contradiction.severity || 'warning'
    });
    for (const field of fields) {
      ensureNode(field, 'field');
      edges.push({
        from: field,
        to: contradictionId,
        type: 'constraint',
        severity: contradiction.severity || 'warning'
      });
    }
  }

  return {
    node_count: nodes.size,
    edge_count: edges.length,
    nodes: [...nodes.values()].slice(0, Math.max(1, limit)),
    edges: edges.slice(0, Math.max(1, limit))
  };
}

function productLatestKeys(storage, category, productId) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  return {
    summaryKey: `${latestBase}/summary.json`,
    normalizedKey: `${latestBase}/normalized.json`,
    provenanceKey: `${latestBase}/provenance.json`
  };
}

async function readProductSnapshot({ storage, category, productId }) {
  const keys = productLatestKeys(storage, category, productId);
  const [summary, normalized, provenance] = await Promise.all([
    storage.readJsonOrNull(keys.summaryKey),
    storage.readJsonOrNull(keys.normalizedKey),
    storage.readJsonOrNull(keys.provenanceKey)
  ]);

  if (!summary && !normalized && !provenance) {
    return null;
  }

  return {
    productId,
    category,
    summary: summary || null,
    normalized: normalized || null,
    provenance: provenance || null
  };
}

async function readJsonBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`body_too_large:${maxBytes}`);
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function includesOperation(query, operationName) {
  return new RegExp(`\\b${operationName}\\b`).test(String(query || ''));
}

async function resolveGraphRequest({ storage, config, defaultCategory, query, variables }) {
  const category = String(variables.category || defaultCategory || 'mouse');
  const intel = await loadSourceIntel({ storage, config, category });
  const domains = Object.values(intel.data.domains || {});
  const topPathLimit = toInt(variables.topPaths, 10);
  const data = {};

  if (includesOperation(query, 'topDomains')) {
    const limit = Math.max(1, toInt(variables.limit, 20));
    data.topDomains = domains
      .sort((a, b) => (b.planner_score || 0) - (a.planner_score || 0))
      .slice(0, limit)
      .map((domain) => compactDomain(domain, topPathLimit));
  }

  if (includesOperation(query, 'domainStats') || includesOperation(query, 'hostStats')) {
    const rootDomain = String(variables.rootDomain || variables.host || '').toLowerCase().trim();
    const found = domains.find((item) => item.rootDomain === rootDomain) || null;
    const compact = found ? compactDomain(found, topPathLimit) : null;
    if (includesOperation(query, 'domainStats')) {
      data.domainStats = compact;
    }
    if (includesOperation(query, 'hostStats')) {
      data.hostStats = compact;
    }
  }

  const needsProduct =
    includesOperation(query, 'product') ||
    includesOperation(query, 'missingCriticalFields') ||
    includesOperation(query, 'bestEvidence') ||
    includesOperation(query, 'whyFieldRejected') ||
    includesOperation(query, 'nextBestUrls') ||
    includesOperation(query, 'conflictGraph');
  let productSnapshot = null;
  if (needsProduct) {
    const productId = String(variables.productId || '').trim();
    if (!productId) {
      throw new Error('productId is required for product-based queries');
    }
    productSnapshot = await readProductSnapshot({ storage, category, productId });
    if (includesOperation(query, 'product')) {
      data.product = productSnapshot;
    }
  }

  if (includesOperation(query, 'missingCriticalFields')) {
    data.missingCriticalFields = productSnapshot?.summary?.critical_fields_below_pass_target || [];
  }

  if (includesOperation(query, 'bestEvidence')) {
    const field = String(variables.field || '').trim();
    const limit = Math.max(1, toInt(variables.limit, 10));
    data.bestEvidence = field
      ? pickBestEvidence(productSnapshot?.provenance, field, limit)
      : [];
  }

  if (includesOperation(query, 'whyFieldRejected')) {
    const field = String(variables.field || '').trim();
    data.whyFieldRejected = field
      ? pickWhyFieldRejected(productSnapshot, field)
      : null;
  }

  if (includesOperation(query, 'nextBestUrls')) {
    const field = String(variables.field || '').trim();
    const limit = Math.max(1, toInt(variables.limit, 10));
    data.nextBestUrls = nextBestUrlsFromHypotheses({
      hypothesisQueue: productSnapshot?.summary?.hypothesis_queue || [],
      field,
      limit
    });
  }

  if (includesOperation(query, 'conflictGraph')) {
    const limit = Math.max(1, toInt(variables.limit, 100));
    data.conflictGraph = buildConflictGraph(productSnapshot, limit);
  }

  if (Object.keys(data).length === 0) {
    throw new Error(
      'No supported operation found in query. Supported: topDomains, domainStats, hostStats, product, missingCriticalFields, bestEvidence, whyFieldRejected, nextBestUrls, conflictGraph'
    );
  }

  return data;
}

export async function startIntelGraphApi({
  storage,
  config,
  category = 'mouse',
  port = 8787,
  host = '0.0.0.0'
}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      jsonResponse(res, 200, {
        ok: true,
        service: 'intel-graph-api',
        category
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/graphql') {
      jsonResponse(res, 404, { error: 'not_found' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      const message = String(error.message || '');
      const status = message.startsWith('body_too_large:') ? 413 : 400;
      jsonResponse(res, status, { error: 'invalid_json_body', message });
      return;
    }

    const query = String(body.query || '').trim();
    const variables = body.variables && typeof body.variables === 'object'
      ? body.variables
      : {};

    if (!query) {
      jsonResponse(res, 400, { error: 'query_required' });
      return;
    }

    try {
      const data = await resolveGraphRequest({
        storage,
        config,
        defaultCategory: category,
        query,
        variables
      });
      jsonResponse(res, 200, { data });
    } catch (error) {
      jsonResponse(res, 400, {
        error: 'query_failed',
        message: error.message
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const publicHost = host === '0.0.0.0' ? '127.0.0.1' : host;

  return {
    server,
    host,
    port: actualPort,
    graphqlUrl: `http://${publicHost}:${actualPort}/graphql`,
    healthUrl: `http://${publicHost}:${actualPort}/health`
  };
}
