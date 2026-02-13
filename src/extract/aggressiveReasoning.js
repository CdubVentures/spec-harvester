function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortCandidates(candidates = []) {
  return [...(Array.isArray(candidates) ? candidates : [])].sort((a, b) => (
    toNumber(b?.confidence, 0) - toNumber(a?.confidence, 0)
  ));
}

function uniqueValues(candidates = []) {
  return [...new Set(
    candidates
      .map((row) => String(row?.value || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

export class AggressiveReasoningResolver {
  constructor({
    cortexClient,
    config = {}
  } = {}) {
    this.cortexClient = cortexClient;
    this.modelFast = String(config.cortexModelFast || 'gpt-5-low');
    this.modelDeep = String(config.cortexModelReasoningDeep || 'gpt-5-high');
  }

  async resolve({
    conflictsByField = {},
    criticalFieldSet = new Set(),
    forceDeep = false
  } = {}) {
    const resolvedByField = {};
    const unresolved = [];
    const deepFields = [];
    const fastFields = [];

    for (const [field, rawCandidates] of Object.entries(conflictsByField || {})) {
      const candidates = sortCandidates(rawCandidates);
      if (candidates.length === 0) {
        continue;
      }
      const values = uniqueValues(candidates);
      const isCritical = criticalFieldSet.has(field);
      const useDeep = forceDeep || isCritical;
      if (useDeep) {
        deepFields.push(field);
      } else {
        fastFields.push(field);
      }

      if (values.length <= 1) {
        resolvedByField[field] = candidates[0];
        continue;
      }

      const top = candidates[0];
      const second = candidates[1];
      const margin = toNumber(top?.confidence, 0) - toNumber(second?.confidence, 0);
      if (margin >= 0.2) {
        resolvedByField[field] = top;
      } else {
        unresolved.push({
          field,
          reason: 'close_confidence_conflict',
          values
        });
      }
    }

    let sidecar = null;
    if (this.cortexClient && typeof this.cortexClient.runPass === 'function' && deepFields.length > 0) {
      const result = await this.cortexClient.runPass({
        tasks: deepFields.map((field, idx) => ({
          id: `reasoning-${idx + 1}`,
          type: 'critical_conflict_resolution',
          critical: true,
          payload: { field, model_hint: this.modelDeep }
        })),
        context: {
          confidence: 0.8,
          critical_conflicts_remain: true,
          critical_gaps_remain: false
        }
      });
      sidecar = {
        mode: result.mode,
        deep_task_count: Number(result?.plan?.deep_task_count || 0),
        fallback_to_non_sidecar: Boolean(result?.fallback_to_non_sidecar)
      };
    }

    return {
      model_fast: this.modelFast,
      model_deep: this.modelDeep,
      resolved_by_field: resolvedByField,
      unresolved,
      deep_fields: deepFields,
      fast_fields: fastFields,
      sidecar
    };
  }
}
