import { EvidenceAuditor } from './evidenceAudit.js';
import { AggressiveDomExtractor } from './aggressiveDom.js';
import { AggressiveReasoningResolver } from './aggressiveReasoning.js';
import { SearchTracker } from './searchTracker.js';
import { CortexClient } from '../llm/cortex_client.js';

function isKnownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function fieldPath(field) {
  return `fields.${String(field || '').trim()}`;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function buildCandidatesFromRecord({ normalized, provenance, fieldOrder = [] }) {
  const out = {};
  for (const field of fieldOrder || []) {
    const value = normalized?.fields?.[field];
    if (!isKnownValue(value)) {
      continue;
    }
    const evidence = Array.isArray(provenance?.[field]?.evidence) ? provenance[field].evidence : [];
    const refs = evidence
      .map((row, idx) => String(row?.snippetId || row?.snippet_id || row?.id || '').trim() || `prov_${field}_${idx + 1}`)
      .filter(Boolean);
    const primaryEvidence = evidence[0] || {};
    const primaryQuote = String(primaryEvidence?.quote || '').trim();
    out[field] = [{
      field,
      value: String(value),
      confidence: Number(provenance?.[field]?.confidence || 0.7),
      evidenceRefs: refs,
      snippetId: refs[0] || '',
      quote: primaryQuote || String(value),
      quoteSpan: Array.isArray(primaryEvidence?.quoteSpan)
        ? primaryEvidence.quoteSpan
        : (Array.isArray(primaryEvidence?.quote_span) ? primaryEvidence.quote_span : null)
    }];
  }
  return out;
}

function toSnippetMap(evidencePack = {}) {
  const map = new Map();
  for (const row of evidencePack?.snippets || []) {
    const id = String(row?.id || '').trim();
    if (id) {
      map.set(id, row);
    }
  }
  if (evidencePack?.snippets && typeof evidencePack.snippets === 'object' && !Array.isArray(evidencePack.snippets)) {
    for (const [id, row] of Object.entries(evidencePack.snippets || {})) {
      const token = String(id || '').trim();
      if (token) {
        map.set(token, row);
      }
    }
  }
  return map;
}

function toReferenceMap(evidencePack = {}) {
  const map = new Map();
  for (const row of evidencePack?.references || []) {
    const id = String(row?.id || '').trim();
    if (id) {
      map.set(id, row);
    }
  }
  return map;
}

function mergeEvidencePackWithProvenance({ evidencePack = {}, provenance = {} }) {
  const snippetsById = toSnippetMap(evidencePack);
  const referencesById = toReferenceMap(evidencePack);
  const now = new Date().toISOString();
  for (const [field, row] of Object.entries(provenance || {})) {
    const evidence = Array.isArray(row?.evidence) ? row.evidence : [];
    for (let idx = 0; idx < evidence.length; idx += 1) {
      const ev = evidence[idx] || {};
      const snippetId = String(ev?.snippetId || ev?.snippet_id || ev?.id || '').trim() || `prov_${field}_${idx + 1}`;
      if (!snippetId) {
        continue;
      }
      const quote = String(ev?.quote || '').trim();
      if (!quote) {
        continue;
      }
      if (!snippetsById.has(snippetId)) {
        snippetsById.set(snippetId, {
          id: snippetId,
          source_id: String(ev?.source_id || 'provenance'),
          text: quote,
          normalized_text: quote,
          snippet_hash: String(ev?.snippet_hash || ''),
          url: String(ev?.url || ''),
          retrieved_at: String(ev?.retrieved_at || now),
          extraction_method: String(ev?.extraction_method || 'aggressive_provenance')
        });
      }
      if (!referencesById.has(snippetId)) {
        referencesById.set(snippetId, {
          id: snippetId,
          source_id: String(ev?.source_id || 'provenance'),
          url: String(ev?.url || ''),
          type: 'provenance',
          content: quote,
          snippet_hash: String(ev?.snippet_hash || '')
        });
      }
    }
  }
  return {
    ...evidencePack,
    references: [...referencesById.values()],
    snippets: [...snippetsById.values()],
    snippets_by_id: Object.fromEntries([...snippetsById.entries()])
  };
}

function mergeCandidates(base = {}, extra = {}) {
  const out = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(extra || {})]);
  for (const key of keys) {
    out[key] = [
      ...(Array.isArray(base?.[key]) ? base[key] : []),
      ...(Array.isArray(extra?.[key]) ? extra[key] : [])
    ];
  }
  return out;
}

function auditStatusMap(audits = []) {
  const map = new Map();
  for (const row of audits || []) {
    const field = String(row?.field || '').trim();
    if (!field) {
      continue;
    }
    map.set(field, String(row?.status || 'REJECT').toUpperCase());
  }
  return map;
}

function applyAcceptedToRecord({ acceptedByField = {}, normalized, provenance }) {
  let filled = 0;
  for (const [field, candidates] of Object.entries(acceptedByField || {})) {
    const best = Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : null;
    if (!best || !isKnownValue(best.value)) {
      continue;
    }
    normalized.fields[field] = String(best.value);
    const bucket = provenance[field] && typeof provenance[field] === 'object' ? provenance[field] : {};
    bucket.value = String(best.value);
    bucket.confidence = Math.max(toNumber(bucket.confidence, 0), toNumber(best.confidence, 0.8));
    bucket.meets_pass_target = true;
    bucket.evidence = Array.isArray(bucket.evidence) ? bucket.evidence : [];
    if (String(best.quote || '').trim()) {
      bucket.evidence.push({
        url: 'aggressive://audit',
        host: 'aggressive.local',
        rootDomain: 'aggressive.local',
        tier: 2,
        tierName: 'database',
        method: 'aggressive_evidence_audit',
        keyPath: `aggressive.audit.${field}`,
        approvedDomain: false,
        snippetId: String(best.snippetId || ''),
        quote: String(best.quote || '')
      });
    }
    provenance[field] = bucket;
    filled += 1;
  }
  return filled;
}

function applyRejectedToUnknown({ audits = [], normalized, provenance }) {
  let demoted = 0;
  for (const row of audits || []) {
    const field = String(row?.field || '').trim();
    const status = String(row?.status || '').toUpperCase();
    if (!field || status === 'ACCEPT') {
      continue;
    }
    if (!isKnownValue(normalized?.fields?.[field])) {
      continue;
    }
    normalized.fields[field] = 'unk';
    const bucket = provenance[field] && typeof provenance[field] === 'object' ? provenance[field] : {};
    bucket.value = 'unk';
    bucket.confidence = Math.min(toNumber(bucket.confidence, 0.5), 0.25);
    bucket.meets_pass_target = false;
    bucket.unknown_reason = status === 'CONFLICT'
      ? 'conflicting_sources_unresolved'
      : 'not_supported_by_evidence';
    provenance[field] = bucket;
    demoted += 1;
  }
  return demoted;
}

export class AggressiveOrchestrator {
  constructor({
    storage,
    config = {},
    logger = null,
    cortexClient = null,
    evidenceAuditor = null,
    domExtractor = null,
    reasoningResolver = null
  } = {}) {
    this.storage = storage;
    this.config = config;
    this.logger = logger;
    this.cortexClient = cortexClient || new CortexClient({ config });
    this.evidenceAuditor = evidenceAuditor || new EvidenceAuditor({ config });
    this.domExtractor = domExtractor || new AggressiveDomExtractor({
      cortexClient: this.cortexClient,
      config
    });
    this.reasoningResolver = reasoningResolver || new AggressiveReasoningResolver({
      cortexClient: this.cortexClient,
      config
    });
    this.maxDeepFields = Math.max(0, toInt(config.cortexMaxDeepFieldsPerProduct, 12));
    this.maxSearchQueries = Math.max(0, toInt(config.aggressiveMaxSearchQueries, 5));
    this.maxTimePerProductMs = Math.max(30_000, toInt(config.aggressiveMaxTimePerProductMs, 600_000));
    this.auditEnabled = toBool(config.aggressiveEvidenceAuditEnabled, true);
  }

  isEnabled(roundContext = null) {
    if (toBool(this.config.aggressiveModeEnabled, false)) {
      return true;
    }
    return String(roundContext?.mode || '').toLowerCase() === 'aggressive';
  }

  async run({
    category = '',
    productId = '',
    identity = {},
    normalized,
    provenance,
    evidencePack = {},
    fieldOrder = [],
    criticalFieldSet = new Set(),
    fieldsBelowPassTarget = [],
    criticalFieldsBelowPassTarget = [],
    discoveryResult = {},
    sourceResults = [],
    roundContext = null
  } = {}) {
    if (!this.isEnabled(roundContext)) {
      return {
        enabled: false,
        stage: 'disabled'
      };
    }
    const deadline = Date.now() + this.maxTimePerProductMs;
    const hasTimeBudget = () => Date.now() < deadline;

    const trackerKey = this.storage.resolveOutputKey(
      '_aggressive',
      category,
      productId,
      'search_tracker.json'
    );
    const tracker = new SearchTracker({
      storage: this.storage,
      key: trackerKey,
      category,
      productId
    });
    await tracker.load();
    tracker.recordQueries((discoveryResult?.search_attempts || []).map((row) => row?.query || row), {
      source: 'discovery'
    });
    tracker.recordVisitedUrls((sourceResults || []).map((row) => row?.finalUrl || row?.url).filter(Boolean), {
      source: 'crawl'
    });
    if (this.maxSearchQueries > 0) {
      const remainingQueries = (discoveryResult?.candidate_queries || []).slice(0, this.maxSearchQueries);
      tracker.addFrontier(
        remainingQueries.map((query) => ({
          url: `query://${encodeURIComponent(String(query))}`,
          reason: 'candidate_query'
        }))
      );
    }

    const auditEvidencePack = mergeEvidencePackWithProvenance({
      evidencePack,
      provenance
    });

    const candidatesStage2 = buildCandidatesFromRecord({
      normalized,
      provenance,
      fieldOrder
    });
    const auditStage2 = this.auditEnabled
      ? await Promise.resolve(this.evidenceAuditor.auditCandidates({
        productId,
        identity,
        candidatesByField: candidatesStage2,
        evidencePack: auditEvidencePack
      }))
      : {
        audits: [],
        accepted_by_field: {},
        rejected_fields: 0
      };
    const demotedStage2 = applyRejectedToUnknown({
      audits: auditStage2.audits,
      normalized,
      provenance
    });

    const targetFields = [...new Set([
      ...fieldsBelowPassTarget,
      ...criticalFieldsBelowPassTarget
    ])];
    const domStage3 = hasTimeBudget()
      ? await this.domExtractor.extractFromDom(
        evidencePack?.meta?.html || evidencePack?.meta?.raw_html || evidencePack?.html || '',
        targetFields,
        {
          ...identity,
          productId
        },
        {
          source_id: evidencePack?.meta?.host || 'dom'
        },
        {
          forceDeep: false
        }
      )
      : {
        fieldCandidates: [],
        sidecar: null
      };
    const domCandidates = {};
    for (const row of domStage3.fieldCandidates || []) {
      const field = String(row?.field || '').trim();
      if (!field) {
        continue;
      }
      if (!domCandidates[field]) {
        domCandidates[field] = [];
      }
      domCandidates[field].push(row);
    }
    const mergedStage3Candidates = mergeCandidates(candidatesStage2, domCandidates);
    const reasoningStage3 = hasTimeBudget()
      ? await this.reasoningResolver.resolve({
        conflictsByField: mergedStage3Candidates,
        criticalFieldSet,
        forceDeep: false
      })
      : {
        resolved_by_field: {}
      };
    const reasoningCandidates = {};
    for (const [field, row] of Object.entries(reasoningStage3.resolved_by_field || {})) {
      reasoningCandidates[field] = [row];
    }

    const stage3Merged = mergeCandidates(mergedStage3Candidates, reasoningCandidates);
    const auditStage3 = this.auditEnabled
      ? await Promise.resolve(this.evidenceAuditor.auditCandidates({
        productId,
        identity,
        candidatesByField: stage3Merged,
        evidencePack: auditEvidencePack
      }))
      : {
        audits: [],
        accepted_by_field: {},
        rejected_fields: 0
      };
    applyAcceptedToRecord({
      acceptedByField: auditStage3.accepted_by_field,
      normalized,
      provenance
    });
    const demotedStage3 = applyRejectedToUnknown({
      audits: auditStage3.audits,
      normalized,
      provenance
    });

    const statusMap = auditStatusMap(auditStage3.audits);
    const criticalMissing = (criticalFieldsBelowPassTarget || []).filter((field) => (
      !isKnownValue(normalized?.fields?.[field]) || statusMap.get(field) !== 'ACCEPT'
    ));
    const needsDeep = criticalMissing.length > 0;

    let deepResult = null;
    if (needsDeep && this.maxDeepFields > 0 && hasTimeBudget()) {
      const deepTasks = criticalMissing.slice(0, this.maxDeepFields).map((field, idx) => ({
        id: `critical-gap-${idx + 1}`,
        type: 'critical_gap_fill',
        critical: true,
        payload: { field }
      }));
      deepResult = await this.cortexClient.runPass({
        tasks: deepTasks,
        context: {
          confidence: toNumber(this.config.aggressiveConfidenceThreshold, 0.85) - 0.05,
          critical_conflicts_remain: false,
          critical_gaps_remain: true,
          evidence_audit_failed_on_critical: true
        }
      });
    }

    const finalCandidates = mergeCandidates(stage3Merged, {});
    const auditFinal = this.auditEnabled
      ? await Promise.resolve(this.evidenceAuditor.auditCandidates({
        productId,
        identity,
        candidatesByField: finalCandidates,
        evidencePack: auditEvidencePack
      }))
      : {
        audits: [],
        accepted_by_field: {},
        rejected_fields: 0
      };
    applyAcceptedToRecord({
      acceptedByField: auditFinal.accepted_by_field,
      normalized,
      provenance
    });
    const demotedFinal = applyRejectedToUnknown({
      audits: auditFinal.audits,
      normalized,
      provenance
    });

    tracker.recordFieldYield(
      Object.entries(normalized?.fields || {})
        .filter(([, value]) => isKnownValue(value))
        .map(([field]) => ({
          field,
          url: ''
        }))
    );
    const trackerSummary = await tracker.save();

    return {
      enabled: true,
      stage: hasTimeBudget() ? 'completed' : 'budget_exhausted',
      model_usage: {
        low_calls: 1 + (domStage3?.sidecar ? 1 : 0),
        high_calls: Number(deepResult?.plan?.deep_task_count || 0) > 0 ? 1 : 0
      },
      escalation: {
        deep_triggered: Boolean(deepResult),
        deep_task_count: Number(deepResult?.plan?.deep_task_count || 0),
        deep_task_cap: this.maxDeepFields,
        critical_missing_count: criticalMissing.length
      },
      evidence_audit: {
        enabled: this.auditEnabled,
        stage2_rejected_fields: auditStage2.rejected_fields,
        stage3_rejected_fields: auditStage3.rejected_fields,
        final_rejected_fields: auditFinal.rejected_fields,
        demoted_stage2: demotedStage2,
        demoted_stage3: demotedStage3,
        demoted_final: demotedFinal
      },
      search_tracker: trackerSummary,
      budget: {
        max_time_ms: this.maxTimePerProductMs,
        timed_out: !hasTimeBudget()
      }
    };
  }
}
