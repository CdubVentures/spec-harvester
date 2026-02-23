export function computeCompoundRange({ ruleMin = null, ruleMax = null, componentMin = null, componentMax = null } = {}) {
  const hasRule = ruleMin !== null || ruleMax !== null;
  const hasComponent = componentMin !== null || componentMax !== null;
  const sources = [
    ...(hasRule ? ['field_rule'] : []),
    ...(hasComponent ? ['component_db'] : [])
  ];

  const mins = [ruleMin, componentMin].filter(v => v !== null);
  const maxes = [ruleMax, componentMax].filter(v => v !== null);

  return {
    min: mins.length > 0 ? Math.max(...mins) : null,
    max: maxes.length > 0 ? Math.min(...maxes) : null,
    sources
  };
}

export function evaluateCompoundRange(value, compoundRange) {
  const { min, max, sources } = compoundRange;
  const isCompound = sources.length > 1;

  if (min !== null && value < min) {
    return {
      ok: false,
      reason_code: isCompound ? 'compound_range_conflict' : 'out_of_range',
      effective_min: min,
      effective_max: max,
      actual: value,
      sources,
      violated_bound: 'min'
    };
  }

  if (max !== null && value > max) {
    return {
      ok: false,
      reason_code: isCompound ? 'compound_range_conflict' : 'out_of_range',
      effective_min: min,
      effective_max: max,
      actual: value,
      sources,
      violated_bound: 'max'
    };
  }

  return { ok: true };
}
