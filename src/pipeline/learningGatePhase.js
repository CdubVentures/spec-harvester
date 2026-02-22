import { evaluateLearningGate } from '../learning/learningUpdater.js';

export function evaluateFieldLearningGates({
  fieldOrder,
  fields,
  provenance,
  category,
  runId,
  fieldRulesEngine,
  config
}) {
  const gateResults = [];
  const acceptedUpdates = [];

  for (const field of fieldOrder) {
    const value = fields[field];
    if (value === 'unk') continue;

    const prov = provenance[field] || {};
    const confidence = prov.confidence || 0;
    const evidence = Array.isArray(prov.evidence) ? prov.evidence : [];
    const refsFound = evidence.length;
    const tierHistory = evidence.map((e) => e.tier).filter(Boolean);

    const rule = fieldRulesEngine?.getRule?.(field);
    const componentRef = rule?.parse_template === 'component_reference' ? field : null;
    const componentReviewStatus = componentRef ? 'pending' : null;

    const gateResult = evaluateLearningGate({
      field,
      confidence,
      refsFound,
      minRefs: 2,
      fieldStatus: 'accepted',
      tierHistory,
      componentRef,
      componentReviewStatus,
      config
    });

    gateResults.push({
      field,
      value,
      confidence,
      refsFound,
      tierHistory,
      accepted: gateResult.accepted,
      reason: gateResult.reason
    });

    if (gateResult.accepted) {
      acceptedUpdates.push({
        field,
        value,
        evidenceRefs: evidence.map((e) => ({ url: e.url, tier: e.tier })),
        acceptanceStats: {
          confirmations: prov.confirmations || 0,
          approved: prov.approved_confirmations || 0
        },
        sourceRunId: runId
      });
    }
  }

  return { gateResults, acceptedUpdates };
}

export function emitLearningGateEvents({ gateResults, logger, runId }) {
  for (const result of gateResults) {
    logger.info('learning_gate_result', {
      field: result.field,
      value: result.value,
      confidence: result.confidence,
      refs_found: result.refsFound,
      tier_history: result.tierHistory,
      accepted: result.accepted,
      reason: result.reason,
      source_run_id: runId
    });
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function populateLearningStores({
  gateResults,
  acceptedUpdates,
  provenance,
  category,
  runId,
  stores,
  fieldRulesEngine
}) {
  const acceptedFields = new Set(acceptedUpdates.map((u) => u.field));

  for (const update of acceptedUpdates) {
    const prov = provenance[update.field] || {};
    const evidence = Array.isArray(prov.evidence) ? prov.evidence : [];

    for (const ref of update.evidenceRefs) {
      stores.urlMemory.upsert({
        field: update.field,
        category,
        url: ref.url,
        sourceRunId: update.sourceRunId
      });

      const domain = extractDomain(ref.url);
      if (domain) {
        stores.domainFieldYield.recordUsed({ domain, field: update.field, category });
      }
    }

    for (const ev of evidence) {
      if (ev.quote) {
        stores.fieldAnchors.insert({
          field: update.field,
          category,
          phrase: ev.quote,
          sourceUrl: ev.url,
          sourceRunId: update.sourceRunId
        });
      }
    }

    const rule = fieldRulesEngine?.getRule?.(update.field);
    if (rule?.parse_template === 'component_reference') {
      stores.componentLexicon.insert({
        field: update.field,
        category,
        value: update.value,
        sourceRunId: update.sourceRunId
      });
    }
  }

  for (const result of gateResults) {
    const prov = provenance[result.field] || {};
    const evidence = Array.isArray(prov.evidence) ? prov.evidence : [];

    for (const ev of evidence) {
      const domain = extractDomain(ev.url);
      if (domain && !acceptedFields.has(result.field)) {
        stores.domainFieldYield.recordSeen({ domain, field: result.field, category });
      }
    }

    if (acceptedFields.has(result.field)) {
      const evidence2 = Array.isArray(prov.evidence) ? prov.evidence : [];
      for (const ev of evidence2) {
        const domain = extractDomain(ev.url);
        if (domain) {
          stores.domainFieldYield.recordSeen({ domain, field: result.field, category });
        }
      }
    }
  }
}
