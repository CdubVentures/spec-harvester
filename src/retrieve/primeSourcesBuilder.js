import {
  ruleMinEvidenceRefs,
  ruleRequiredLevel
} from '../engine/ruleAccessors.js';
import {
  buildEvidencePoolFromSourceResults,
  buildEvidencePoolFromProvenance,
  buildTierAwareFieldRetrieval
} from './tierAwareRetriever.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFieldRulesMap(fieldRules = {}) {
  if (isObject(fieldRules?.fields)) return fieldRules.fields;
  if (isObject(fieldRules)) return fieldRules;
  return {};
}

function distinctSourcesRequired(needRow = {}, fieldRule = {}) {
  const evidence = isObject(fieldRule.evidence) ? fieldRule.evidence : {};
  if (evidence.distinct_sources_required !== undefined) {
    return Boolean(evidence.distinct_sources_required);
  }
  if (evidence.require_distinct_sources !== undefined) {
    return Boolean(evidence.require_distinct_sources);
  }
  const requiredLevel = String(needRow.required_level || ruleRequiredLevel(fieldRule) || '').trim().toLowerCase();
  const minRefs = Math.max(1, toInt(needRow.min_refs, ruleMinEvidenceRefs(fieldRule)));
  return minRefs >= 2 && (requiredLevel === 'identity' || requiredLevel === 'critical' || requiredLevel === 'required');
}

function selectPrimeSourcesForField({
  hits = [],
  minRefsRequired = 1,
  distinctRequired = false,
  maxPrimeSources = 8
} = {}) {
  const cap = Math.max(1, Math.min(20, toInt(maxPrimeSources, 8)));
  const minRefs = Math.max(1, toInt(minRefsRequired, 1));
  const selected = [];
  const selectedSnippets = new Set();
  const selectedSources = new Set();

  const pushHit = (row) => {
    if (!row) return false;
    const snippetKey = String(row.snippet_id || `${row.url || ''}|${row.quote_preview || ''}`).trim();
    if (!snippetKey || selectedSnippets.has(snippetKey)) return false;
    selectedSnippets.add(snippetKey);
    selected.push(row);
    if (row.source_key) selectedSources.add(String(row.source_key));
    return true;
  };

  for (const row of hits || []) {
    if (selected.length >= cap) break;
    const sourceKey = String(row.source_key || '').trim().toLowerCase();
    if (distinctRequired && sourceKey && selectedSources.has(sourceKey) && selected.length < minRefs) {
      continue;
    }
    pushHit(row);
  }

  if (selected.length < minRefs) {
    for (const row of hits || []) {
      if (selected.length >= Math.min(cap, Math.max(minRefs, cap))) break;
      pushHit(row);
      if (selected.length >= minRefs && !distinctRequired) break;
    }
  }

  const distinctSourceCount = selectedSources.size;
  const minRefsSatisfied = selected.length >= minRefs && (!distinctRequired || distinctSourceCount >= Math.min(minRefs, selected.length));
  return {
    prime_sources: selected,
    refs_selected: selected.length,
    distinct_sources_selected: distinctSourceCount,
    min_refs_satisfied: minRefsSatisfied
  };
}

export function buildPhase07PrimeSources({
  runId = '',
  category = '',
  productId = '',
  needSet = {},
  provenance = {},
  sourceResults = [],
  fieldRules = {},
  identity = {},
  options = {}
} = {}) {
  const now = new Date().toISOString();
  const rulesMap = normalizeFieldRulesMap(fieldRules);
  const provenancePool = buildEvidencePoolFromProvenance(provenance);
  const fallbackPool = buildEvidencePoolFromSourceResults(sourceResults, {
    maxRows: Math.max(200, Math.min(20_000, toInt(options.maxFallbackEvidenceRows, 6_000))),
    maxSnippetsPerSource: Math.max(8, Math.min(300, toInt(options.maxFallbackSnippetsPerSource, 120)))
  });
  const mergeThreshold = Math.max(0, toInt(options.provenanceOnlyMinRows, 24));
  const fallbackUsed = provenancePool.length < mergeThreshold && fallbackPool.length > 0;
  const evidencePool = fallbackUsed
    ? [...provenancePool, ...fallbackPool]
    : provenancePool;
  const maxHitsPerField = Math.max(4, Math.min(80, toInt(options.maxHitsPerField, 24)));
  const maxPrimeSourcesPerField = Math.max(2, Math.min(20, toInt(options.maxPrimeSourcesPerField, 8)));

  const needRows = toArray(needSet?.needs)
    .filter((row) => isObject(row) && String(row.field_key || '').trim())
    .sort((a, b) => Number(b.need_score || 0) - Number(a.need_score || 0));

  const fields = [];
  let fieldsWithHits = 0;
  let fieldsSatisfied = 0;
  let refsSelectedTotal = 0;
  let distinctSourcesSelected = 0;

  for (const needRow of needRows) {
    const fieldKey = String(needRow.field_key || '').trim();
    if (!fieldKey) continue;
    const fieldRule = isObject(rulesMap[fieldKey]) ? rulesMap[fieldKey] : {};
    const minRefsRequired = Math.max(1, toInt(needRow.min_refs, ruleMinEvidenceRefs(fieldRule)));
    const distinctRequired = distinctSourcesRequired(needRow, fieldRule);

    const retrieval = buildTierAwareFieldRetrieval({
      fieldKey,
      needRow,
      fieldRule,
      evidencePool,
      identity,
      maxHits: maxHitsPerField
    });
    const prime = selectPrimeSourcesForField({
      hits: retrieval.hits,
      minRefsRequired,
      distinctRequired,
      maxPrimeSources: maxPrimeSourcesPerField
    });

    if (retrieval.hits.length > 0) fieldsWithHits += 1;
    if (prime.min_refs_satisfied) fieldsSatisfied += 1;
    refsSelectedTotal += prime.refs_selected;
    distinctSourcesSelected += prime.distinct_sources_selected;

    fields.push({
      ...retrieval,
      min_refs_required: minRefsRequired,
      distinct_sources_required: distinctRequired,
      hits_count: retrieval.hits.length,
      refs_selected: prime.refs_selected,
      distinct_sources_selected: prime.distinct_sources_selected,
      min_refs_satisfied: prime.min_refs_satisfied,
      prime_sources: prime.prime_sources
    });
  }

  const unsatisfied = fields.filter((row) => !row.min_refs_satisfied).length;
  const avgHits = fields.length > 0
    ? Number((fields.reduce((sum, row) => sum + Number(row.hits_count || 0), 0) / fields.length).toFixed(3))
    : 0;

  return {
    run_id: String(runId || '').trim(),
    category: String(category || '').trim(),
    product_id: String(productId || '').trim(),
    generated_at: now,
    summary: {
      fields_attempted: fields.length,
      fields_with_hits: fieldsWithHits,
      fields_satisfied_min_refs: fieldsSatisfied,
      fields_unsatisfied_min_refs: unsatisfied,
      refs_selected_total: refsSelectedTotal,
      distinct_sources_selected: distinctSourcesSelected,
      avg_hits_per_field: avgHits,
      evidence_pool_size: evidencePool.length,
      evidence_pool_provenance_size: provenancePool.length,
      evidence_pool_fallback_size: fallbackPool.length,
      evidence_pool_fallback_used: fallbackUsed
    },
    fields
  };
}
