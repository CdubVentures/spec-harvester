import {
  ANCHOR_FIELDS,
  COMMONLY_WRONG_FIELDS,
  INSTRUMENTED_HOST_HINTS,
  INSTRUMENTED_FIELDS,
  KNOWN_LIST_VALUES,
  LIST_FIELDS,
  NUMERIC_FIELDS
} from '../constants.js';
import {
  normalizeToken,
  normalizeWhitespace,
  parseNumber,
  splitListValue
} from '../utils/common.js';
import { buildFallbackFieldCandidateId } from '../utils/candidateIdentifier.js';

const METHOD_WEIGHT = {
  network_json: 1,
  adapter_api: 0.95,
  pdf_table: 0.95,
  html_table: 0.9,
  embedded_state: 0.85,
  ldjson: 0.75,
  llm_extract: 0.2,
  dom: 0.4
};

const TIER_WEIGHT = {
  1: 1,
  2: 0.8,
  3: 0.45
};

const PASS_EXEMPT_FIELDS = new Set([
  'id',
  'brand',
  'model',
  'base_model',
  'category',
  'sku'
]);

function unknownFieldMap(fieldOrder) {
  const output = {};
  for (const field of fieldOrder) {
    output[field] = 'unk';
  }
  return output;
}

function hasValue(value) {
  const text = String(value || '').trim().toLowerCase();
  return text !== '' && text !== 'unk';
}

function normalizePollingRate(value) {
  const nums = splitListValue(value)
    .map((item) => parseNumber(item))
    .filter((item) => item !== null)
    .map((item) => Math.round(item));
  const uniq = [...new Set(nums)].sort((a, b) => b - a);
  return uniq.length ? uniq.join(', ') : 'unk';
}

function canonicalValue(field, value) {
  if (!hasValue(value)) {
    return { display: 'unk', key: 'unk' };
  }

  if (field === 'polling_rate') {
    const display = normalizePollingRate(value);
    return { display, key: normalizeToken(display) };
  }

  if (NUMERIC_FIELDS.has(field)) {
    const num = parseNumber(value);
    if (num === null) {
      return { display: 'unk', key: 'unk' };
    }
    const rounded = Number.isInteger(num) ? num : Number.parseFloat(num.toFixed(2));
    return { display: String(rounded), key: String(rounded) };
  }

  if (LIST_FIELDS.has(field)) {
    const values = splitListValue(value).map((item) => normalizeWhitespace(item)).filter(Boolean);
    const display = values.length ? values.join(', ') : 'unk';
    return { display, key: normalizeToken(display) };
  }

  const display = normalizeWhitespace(value);
  return { display: display || 'unk', key: normalizeToken(display) || 'unk' };
}

// ---------------------------------------------------------------------------
// selection_policy bonus — small tiebreaker applied to cluster scores
// ---------------------------------------------------------------------------

const POLICY_BONUS = 0.3;

const LLM_METHODS = new Set(['llm_extract']);

function computePolicySignal(cluster, policy) {
  switch (policy) {
    case 'best_evidence': {
      return cluster.evidence.filter(
        (e) => e.citation?.snippetHash || e.citation?.snippetId
      ).length;
    }
    case 'prefer_deterministic': {
      return cluster.evidence.filter((e) => !LLM_METHODS.has(e.method)).length;
    }
    case 'prefer_llm': {
      return cluster.evidence.filter((e) => LLM_METHODS.has(e.method)).length;
    }
    case 'prefer_latest': {
      if (!cluster.evidence.length) return 0;
      return Math.max(
        ...cluster.evidence.map((e) => new Date(e.ts || 0).getTime())
      );
    }
    default:
      return 0;
  }
}

function applyPolicyBonus(clusters, policy) {
  if (!policy || policy === 'best_confidence' || clusters.length < 2) {
    return;
  }
  let bestSignal = -Infinity;
  let bestIdx = -1;
  for (let i = 0; i < clusters.length; i++) {
    const signal = computePolicySignal(clusters[i], policy);
    if (signal > bestSignal) {
      bestSignal = signal;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestSignal > 0) {
    clusters[bestIdx].score += POLICY_BONUS;
  }
}

function passTargetForField(field) {
  if (PASS_EXEMPT_FIELDS.has(field)) {
    return 0;
  }
  if (COMMONLY_WRONG_FIELDS.has(field)) {
    return 5;
  }
  return 3;
}

function selectBestCluster(clusters) {
  const ranked = [...clusters].sort((a, b) => {
    if (b.approvedDomainCount !== a.approvedDomainCount) {
      return b.approvedDomainCount - a.approvedDomainCount;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.display.localeCompare(b.display);
  });
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  return { best, second };
}

function clusterCandidates(rows) {
  const byKey = new Map();

  for (const row of rows) {
    if (!byKey.has(row.clusterKey)) {
      byKey.set(row.clusterKey, {
        key: row.clusterKey,
        display: row.displayValue,
        score: 0,
        domains: new Set(),
        approvedDomains: new Set(),
        instrumentedDomains: new Set(),
        evidence: []
      });
    }

    const cluster = byKey.get(row.clusterKey);
    const scoreAdd = (TIER_WEIGHT[row.tier] || 0.4) * (METHOD_WEIGHT[row.method] || 0.4);

    if (row.approvedDomain) {
      cluster.score += scoreAdd;
    }
    cluster.domains.add(row.rootDomain);
    if (row.approvedDomain) {
      cluster.approvedDomains.add(row.rootDomain);
    }
    if (row.instrumentedHost && row.approvedDomain) {
      cluster.instrumentedDomains.add(row.rootDomain);
    }
    cluster.evidence.push(row);
  }

  return [...byKey.values()].map((cluster) => ({
    ...cluster,
    domainCount: cluster.domains.size,
    approvedDomainCount: cluster.approvedDomains.size,
    instrumentedDomainCount: cluster.instrumentedDomains.size
  }));
}

function isInstrumentedEvidenceSource(source) {
  const rootDomain = String(source.rootDomain || '').toLowerCase();
  if (source.tierName === 'lab') {
    return true;
  }
  return INSTRUMENTED_HOST_HINTS.has(rootDomain);
}

function buildSnippetIndex(evidencePack = null) {
  const referencesById = new Map();
  const snippetsById = new Map();

  if (Array.isArray(evidencePack?.references)) {
    for (const row of evidencePack.references) {
      const id = String(row?.id || '').trim();
      if (!id) {
        continue;
      }
      referencesById.set(id, row);
    }
  }

  if (Array.isArray(evidencePack?.snippets)) {
    for (const row of evidencePack.snippets) {
      const id = String(row?.id || '').trim();
      if (!id) {
        continue;
      }
      snippetsById.set(id, row);
    }
  } else if (evidencePack?.snippets && typeof evidencePack.snippets === 'object') {
    for (const [id, row] of Object.entries(evidencePack.snippets || {})) {
      const key = String(id || '').trim();
      if (!key) {
        continue;
      }
      snippetsById.set(key, row);
    }
  }

  if (snippetsById.size === 0 && evidencePack?.snippets_by_id && typeof evidencePack.snippets_by_id === 'object') {
    for (const [id, row] of Object.entries(evidencePack.snippets_by_id || {})) {
      const key = String(id || '').trim();
      if (!key) {
        continue;
      }
      snippetsById.set(key, row);
    }
  }

  return {
    referencesById,
    snippetsById
  };
}

function resolveCitationFromCandidate(source, candidate, evidenceIndexCache) {
  const evidenceRefs = Array.isArray(candidate?.evidenceRefs)
    ? [...new Set(candidate.evidenceRefs.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
  if (evidenceRefs.length === 0) {
    return null;
  }

  let index = evidenceIndexCache.get(source);
  if (!index) {
    index = buildSnippetIndex(source?.llmEvidencePack || null);
    evidenceIndexCache.set(source, index);
  }
  for (const refId of evidenceRefs) {
    const reference = index.referencesById.get(refId) || null;
    const snippet = index.snippetsById.get(refId) || null;
    const quote = normalizeWhitespace(snippet?.normalized_text || snippet?.text || reference?.content || '');
    const url = reference?.url || source?.finalUrl || source?.url;
    if (!url) {
      continue;
    }
    return {
      snippetId: refId,
      snippetHash: String(snippet?.snippet_hash || reference?.snippet_hash || '').trim(),
      sourceId: String(
        snippet?.source_id ||
        source?.sourceId ||
        source?.llmEvidencePack?.meta?.source_id ||
        ''
      ).trim(),
      quote,
      retrievedAt: String(
        snippet?.retrieved_at ||
        source?.llmEvidencePack?.meta?.updated_at ||
        source?.ts ||
        new Date().toISOString()
      ),
      extractionMethod: String(
        snippet?.extraction_method ||
        candidate?.method ||
        'llm_extract'
      ).trim(),
      referenceUrl: url,
      evidenceRefs
    };
  }
  return null;
}

export function runConsensusEngine({
  sourceResults,
  categoryConfig,
  fieldOrder,
  anchors,
  identityLock,
  productId,
  category,
  config = {},
  fieldRulesEngine = null
}) {
  const fields = unknownFieldMap(fieldOrder);
  const provenance = {};
  const candidates = {};
  const fieldsBelowPassTarget = [];
  const criticalFieldsBelowPassTarget = [];
  const newValuesProposed = [];

  fields.id = productId;
  fields.brand = identityLock.brand || 'unk';
  fields.model = identityLock.model || 'unk';
  fields.base_model = identityLock.model || fields.model;
  fields.category = category;
  fields.sku = identityLock.sku || 'unk';

  const usableSources = sourceResults.filter(
    (source) => source.identity?.match && (source.anchorCheck?.majorConflicts || []).length === 0
  );
  const evidenceIndexCache = new Map();

  const byField = new Map();

  for (const source of usableSources) {
    for (const candidate of source.fieldCandidates || []) {
      if (!candidate?.field || !hasValue(candidate.value)) {
        continue;
      }

      const normalized = canonicalValue(candidate.field, candidate.value);
      if (!hasValue(normalized.display)) {
        continue;
      }

      if (!byField.has(candidate.field)) {
        byField.set(candidate.field, []);
      }

      byField.get(candidate.field).push({
        field: candidate.field,
        value: normalized.display,
        displayValue: normalized.display,
        clusterKey: normalized.key,
        host: source.host,
        rootDomain: source.rootDomain,
        tier: source.tier,
        tierName: source.tierName,
        method: candidate.method,
        evidenceKey: `${source.url}#${candidate.keyPath}`,
        ts: source.ts || new Date().toISOString(),
        approvedDomain: Boolean(source.approvedDomain),
        instrumentedHost: Boolean(isInstrumentedEvidenceSource(source)),
        keyPath: candidate.keyPath,
        url: source.finalUrl || source.url,
        citation: resolveCitationFromCandidate(source, candidate, evidenceIndexCache),
        score: (TIER_WEIGHT[source.tier] || 0.4) * (METHOD_WEIGHT[candidate.method] || 0.4)
      });
    }
  }

  let agreementAccumulator = 0;
  let agreementFieldCount = 0;

  for (const field of fieldOrder) {
    const rows = byField.get(field) || [];
    candidates[field] = rows.map((row, index) => ({
      candidate_id: buildFallbackFieldCandidateId({
        productId,
        fieldKey: field,
        value: row.value,
        index: index + 1,
        variant: 'candidate',
      }),
      value: row.value,
      score: Number.parseFloat(Math.max(0, Math.min(1, row.score || 0)).toFixed(6)),
      host: row.host,
      rootDomain: row.rootDomain,
      source_id: row.rootDomain ? row.rootDomain.replace(/[^a-z0-9]+/gi, '_').toLowerCase() : '',
      url: row.url,
      tier: row.tier,
      method: row.method,
      evidenceKey: row.evidenceKey,
      ts: row.ts,
      approvedDomain: row.approvedDomain,
      evidence: {
        url: row.url,
        snippet_id: row.citation?.snippetId || '',
        snippet_hash: row.citation?.snippetHash || '',
        source_id: row.citation?.sourceId || '',
        quote: row.citation?.quote || '',
        quote_span: null,
        snippet_text: row.citation?.quote || ''
      }
    }));

    const anchorValue = anchors?.[field];
    if (hasValue(anchorValue)) {
      const normalizedAnchor = canonicalValue(field, anchorValue).display;
      fields[field] = normalizedAnchor;
      provenance[field] = {
        value: normalizedAnchor,
        anchor_locked: true,
        confirmations: 0,
        approved_confirmations: 0,
        pass_target: 1,
        meets_pass_target: true,
        confidence: 1,
        evidence: []
      };
      continue;
    }

    if (PASS_EXEMPT_FIELDS.has(field)) {
      provenance[field] = {
        value: fields[field],
        anchor_locked: false,
        confirmations: 0,
        approved_confirmations: 0,
        pass_target: 0,
        meets_pass_target: true,
        confidence: fields[field] === 'unk' ? 0 : 1,
        evidence: []
      };
      continue;
    }

    if (!rows.length) {
      provenance[field] = {
        value: 'unk',
        anchor_locked: false,
        confirmations: 0,
        approved_confirmations: 0,
        pass_target: passTargetForField(field),
        meets_pass_target: false,
        confidence: 0,
        evidence: []
      };
      fieldsBelowPassTarget.push(field);
      if (categoryConfig.criticalFieldSet.has(field)) {
        criticalFieldsBelowPassTarget.push(field);
      }
      continue;
    }

    const clusters = clusterCandidates(rows);

    // Apply selection_policy bonus if engine provides a string enum policy
    const fieldRule = fieldRulesEngine?.getFieldRule?.(field);
    const selectionPolicy = typeof fieldRule?.selection_policy === 'string'
      ? fieldRule.selection_policy : null;
    if (selectionPolicy) {
      applyPolicyBonus(clusters, selectionPolicy);
    }

    const { best, second } = selectBestCluster(clusters);
    const weightedMajority = !second || best.score >= (second.score * 1.1);

    const minimumRequired = 3;
    const approvedDomainCount = best?.approvedDomainCount || 0;
    const instrumentedCount = best?.instrumentedDomainCount || 0;

    const strictAccepted = approvedDomainCount >= minimumRequired && weightedMajority;
    const relaxedCandidate = Boolean(config.allowBelowPassTargetFill) && !INSTRUMENTED_FIELDS.has(field);

    let relaxedAccepted = false;
    if (relaxedCandidate && approvedDomainCount >= 2 && weightedMajority) {
      const approvedEvidence = (best?.evidence || []).filter((item) => item.approvedDomain);
      const hasTier1Manufacturer = approvedEvidence.some(
        (item) => item.tier === 1 && item.tierName === 'manufacturer'
      );

      const additionalCredibleDomains = new Set(
        approvedEvidence
          .filter((item) => item.tier <= 2)
          .filter((item) => !(item.tier === 1 && item.tierName === 'manufacturer'))
          .map((item) => item.rootDomain)
      );

      relaxedAccepted = hasTier1Manufacturer && additionalCredibleDomains.size >= 1;
    }

    let accepted = strictAccepted || relaxedAccepted;
    if (INSTRUMENTED_FIELDS.has(field)) {
      accepted = strictAccepted && instrumentedCount >= 3;
      relaxedAccepted = false;
    }

    const value = accepted ? best.display : 'unk';
    fields[field] = value;

    const passTarget = passTargetForField(field);
    const meetsPassTarget = approvedDomainCount >= passTarget;

    if (!meetsPassTarget) {
      fieldsBelowPassTarget.push(field);
      if (categoryConfig.criticalFieldSet.has(field)) {
        criticalFieldsBelowPassTarget.push(field);
      }
    }

    const confidenceBase = approvedDomainCount >= 3 ? 0.7 : approvedDomainCount / 4;
    const confidenceScore = Math.max(
      0,
      Math.min(1, confidenceBase + (weightedMajority ? 0.2 : 0) + Math.min(0.1, best.score / 10))
    );

    provenance[field] = {
      value,
      anchor_locked: false,
      confirmations: best.domainCount,
      approved_confirmations: approvedDomainCount,
      instrumented_confirmations: instrumentedCount,
      pass_target: passTarget,
      meets_pass_target: meetsPassTarget,
      accepted_below_pass_target: relaxedAccepted && !meetsPassTarget,
      weighted_majority: weightedMajority,
      confidence: confidenceScore,
      domains: [...best.domains],
      approved_domains: [...best.approvedDomains],
      evidence: best.evidence.map((evidence) => ({
        url: evidence.url,
        host: evidence.host,
        rootDomain: evidence.rootDomain,
        tier: evidence.tier,
        tierName: evidence.tierName,
        method: evidence.method,
        keyPath: evidence.keyPath,
        approvedDomain: evidence.approvedDomain,
        snippet_id: evidence.citation?.snippetId || '',
        snippet_hash: evidence.citation?.snippetHash || '',
        source_id: evidence.citation?.sourceId || '',
        quote: evidence.citation?.quote || '',
        retrieved_at: evidence.citation?.retrievedAt || evidence.ts,
        extraction_method: evidence.citation?.extractionMethod || evidence.method,
        evidence_refs: evidence.citation?.evidenceRefs || []
      }))
    };

    agreementAccumulator += second ? best.score / (best.score + second.score) : 1;
    agreementFieldCount += 1;
  }

  if (fields.connection === 'wired' && fields.battery_hours === 'unk') {
    fields.battery_hours = 'n/a';
    if (provenance.battery_hours) {
      provenance.battery_hours.value = 'n/a';
      provenance.battery_hours.meets_pass_target = true;
    }
  }

  for (const [field, allowedValues] of Object.entries(KNOWN_LIST_VALUES)) {
    const current = fields[field];
    if (!hasValue(current) || current === 'n/a') {
      continue;
    }
    const values = splitListValue(current).map((item) => item.toLowerCase());
    for (const value of values) {
      if (!allowedValues.includes(value)) {
        newValuesProposed.push({ field, value });
      }
    }
  }

  return {
    fields,
    provenance,
    candidates,
    fieldsBelowPassTarget: [...new Set(fieldsBelowPassTarget)],
    criticalFieldsBelowPassTarget: [...new Set(criticalFieldsBelowPassTarget)],
    newValuesProposed,
    agreementScore: agreementFieldCount ? agreementAccumulator / agreementFieldCount : 0
  };
}

// ---------------------------------------------------------------------------
// Object-form selection_policy reducer — post-consensus list → scalar
// ---------------------------------------------------------------------------

export function applySelectionPolicyReducers({ fields, candidates, fieldRulesEngine }) {
  const result = { fields: { ...fields }, applied: [] };
  if (!fieldRulesEngine) {
    return result;
  }

  for (const field of fieldRulesEngine.getAllFieldKeys()) {
    const rule = fieldRulesEngine.getFieldRule(field);
    const policy = rule?.selection_policy;
    if (!policy || typeof policy !== 'object') {
      continue;
    }
    if (!policy.source_field) {
      continue;
    }

    const sourceFieldCandidates = candidates[policy.source_field];
    if (!sourceFieldCandidates || sourceFieldCandidates.length === 0) {
      continue;
    }

    const values = sourceFieldCandidates
      .map((c) => Number.parseFloat(c.value))
      .filter((v) => !Number.isNaN(v))
      .sort((a, b) => a - b);

    if (values.length === 0) {
      continue;
    }

    if (values.length === 1) {
      result.fields[field] = String(values[0]);
      result.applied.push({ field, reason: 'single_value', value: values[0] });
      continue;
    }

    const tolerance = policy.tolerance_ms || 0;
    const range = values[values.length - 1] - values[0];

    if (range <= tolerance) {
      const mid = Math.floor(values.length / 2);
      const median = values.length % 2 === 0
        ? (values[mid - 1] + values[mid]) / 2
        : values[mid];
      result.fields[field] = String(median);
      result.applied.push({ field, reason: 'median_within_tolerance', value: median });
    } else {
      result.fields[field] = 'unk';
      result.applied.push({ field, reason: 'exceeds_tolerance', range, tolerance });
    }
  }

  return result;
}
