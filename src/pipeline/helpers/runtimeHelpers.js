import { toInt, toBool } from './typeHelpers.js';

export function parseMinEvidenceRefs(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Number.parseInt(String(fallback || 1), 10) || 1);
  }
  return Math.max(1, parsed);
}

export function sendModeIncludesPrime(value = '') {
  const token = String(value || '').trim().toLowerCase();
  return token.includes('prime');
}

export function selectPreferredRouteRow(rows = [], scope = 'field') {
  const scoped = (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.scope || '').trim().toLowerCase() === String(scope || '').trim().toLowerCase());
  if (scoped.length === 0) {
    return null;
  }
  return scoped
    .slice()
    .sort((a, b) => {
      const effortA = Number.parseInt(String(a?.effort ?? 0), 10) || 0;
      const effortB = Number.parseInt(String(b?.effort ?? 0), 10) || 0;
      if (effortA !== effortB) return effortB - effortA;
      const minA = parseMinEvidenceRefs(a?.llm_output_min_evidence_refs_required, 1);
      const minB = parseMinEvidenceRefs(b?.llm_output_min_evidence_refs_required, 1);
      return minB - minA;
    })[0] || null;
}

export function deriveRouteMatrixPolicy({
  routeRows = [],
  categoryConfig = null
} = {}) {
  const preferredField = selectPreferredRouteRow(routeRows, 'field');
  const preferredComponent = selectPreferredRouteRow(routeRows, 'component');
  const preferredList = selectPreferredRouteRow(routeRows, 'list');
  const ruleMinRefs = [];
  const fieldRules = categoryConfig?.fieldRules?.fields || {};
  for (const rule of Object.values(fieldRules || {})) {
    if (!rule || typeof rule !== 'object') continue;
    ruleMinRefs.push(parseMinEvidenceRefs(rule?.evidence?.min_evidence_refs ?? rule?.min_evidence_refs ?? 1, 1));
  }
  const routeMinRefs = (Array.isArray(routeRows) ? routeRows : [])
    .map((row) => parseMinEvidenceRefs(row?.llm_output_min_evidence_refs_required, 1));
  const minEvidenceRefsEffective = Math.max(
    1,
    ...ruleMinRefs,
    ...routeMinRefs
  );
  const scalarSend = String(
    preferredField?.scalar_linked_send || 'scalar value + prime sources'
  ).trim();
  const componentSend = String(
    preferredComponent?.component_values_send || 'component values + prime sources'
  ).trim();
  const listSend = String(
    preferredList?.list_values_send || 'list values prime sources'
  ).trim();
  const primeVisualSend =
    sendModeIncludesPrime(scalarSend) ||
    sendModeIncludesPrime(componentSend) ||
    sendModeIncludesPrime(listSend);

  return {
    scalar_linked_send: scalarSend,
    component_values_send: componentSend,
    list_values_send: listSend,
    llm_output_min_evidence_refs_required: minEvidenceRefsEffective,
    min_evidence_refs_effective: minEvidenceRefsEffective,
    prime_sources_visual_send: primeVisualSend,
    table_linked_send: primeVisualSend
  };
}

export async function loadRouteMatrixPolicyForRun({
  config = {},
  category = '',
  categoryConfig = null,
  logger = null
} = {}) {
  const categoryToken = String(category || '').trim().toLowerCase();
  let routeRows = [];
  if (categoryToken) {
    let specDb = null;
    try {
      const { SpecDb } = await import('../../db/specDb.js');
      const dbPath = `${String(config.specDbDir || '.specfactory_tmp').replace(/[\\\/]+$/, '')}/${categoryToken}/spec.sqlite`;
      specDb = new SpecDb({
        dbPath,
        category: categoryToken
      });
      routeRows = specDb.getLlmRouteMatrix();
    } catch (error) {
      logger?.warn?.('route_matrix_policy_load_failed', {
        category: categoryToken,
        message: error?.message || 'unknown_error'
      });
    } finally {
      try {
        specDb?.close?.();
      } catch {
        // best effort
      }
    }
  }
  const derived = deriveRouteMatrixPolicy({
    routeRows,
    categoryConfig
  });
  return {
    ...derived,
    source: routeRows.length > 0 ? 'spec_db' : 'category_rules_default',
    row_count: routeRows.length
  };
}

export function resolveRuntimeControlKey(storage, config = {}) {
  const raw = String(config.runtimeControlFile || '_runtime/control/runtime_overrides.json').trim();
  if (!raw) {
    return storage.resolveOutputKey('_runtime/control/runtime_overrides.json');
  }
  if (raw.startsWith(`${config.s3OutputPrefix || 'specs/outputs'}/`)) {
    return raw;
  }
  return storage.resolveOutputKey(raw);
}

export function resolveIndexingResumeKey(storage, category, productId) {
  return storage.resolveOutputKey('_runtime', 'indexing_resume', category, `${productId}.json`);
}

export function defaultRuntimeOverrides() {
  return {
    pause: false,
    max_urls_per_product: null,
    max_queries_per_product: null,
    blocked_domains: [],
    force_high_fields: [],
    disable_llm: false,
    disable_search: false,
    notes: ''
  };
}

export function normalizeRuntimeOverrides(payload = {}) {
  const input = payload && typeof payload === 'object' ? payload : {};
  return {
    ...defaultRuntimeOverrides(),
    ...input,
    pause: Boolean(input.pause),
    max_urls_per_product: input.max_urls_per_product === null || input.max_urls_per_product === undefined
      ? null
      : Math.max(1, toInt(input.max_urls_per_product, 0)),
    max_queries_per_product: input.max_queries_per_product === null || input.max_queries_per_product === undefined
      ? null
      : Math.max(1, toInt(input.max_queries_per_product, 0)),
    blocked_domains: Array.isArray(input.blocked_domains)
      ? [...new Set(input.blocked_domains.map((row) => String(row || '').trim().toLowerCase().replace(/^www\./, '')).filter(Boolean))]
      : [],
    force_high_fields: Array.isArray(input.force_high_fields)
      ? [...new Set(input.force_high_fields.map((row) => String(row || '').trim()).filter(Boolean))]
      : [],
    disable_llm: Boolean(input.disable_llm),
    disable_search: Boolean(input.disable_search),
    notes: String(input.notes || '')
  };
}

export function applyRuntimeOverridesToPlanner(planner, overrides = {}) {
  if (!planner || typeof planner !== 'object') {
    return;
  }
  if (Number.isFinite(Number(overrides.max_urls_per_product)) && Number(overrides.max_urls_per_product) > 0) {
    planner.maxUrls = Math.max(1, Number(overrides.max_urls_per_product));
  }
  for (const host of overrides.blocked_domains || []) {
    planner.blockHost(host, 'runtime_override_blocked_domain');
  }
}
