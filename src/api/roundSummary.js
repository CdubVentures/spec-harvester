function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback = 0) {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function unwrapPayload(row) {
  if (!row) return {};
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return { ...p, ...row, payload: undefined };
}

export function buildRoundSummaryFromEvents(events) {
  const rows = Array.isArray(events) ? events : [];

  const roundRows = rows.filter((r) => r?.event === 'convergence_round_completed');
  const stopRow = rows.find((r) => r?.event === 'convergence_stop') || null;

  if (roundRows.length > 0) {
    const rounds = roundRows.map((r) => {
      const d = unwrapPayload(r);
      return {
        round: toInt(d.round, 0),
        needset_size: toInt(d.needset_size, 0),
        missing_required_count: toInt(d.missing_required_count, 0),
        critical_count: toInt(d.critical_count, 0),
        confidence: toFloat(d.confidence, 0),
        validated: Boolean(d.validated),
        improved: Boolean(d.improved),
        improvement_reasons: Array.isArray(d.improvement_reasons) ? d.improvement_reasons : []
      };
    });

    const stopData = unwrapPayload(stopRow);
    return {
      rounds,
      stop_reason: stopRow ? String(stopData.stop_reason || '') || null : null,
      round_count: rounds.length
    };
  }

  const runCompleted = rows.find((r) => r?.event === 'run_completed');
  if (runCompleted) {
    const rc = unwrapPayload(runCompleted);
    const needsetRow = rows.find((r) => r?.event === 'needset_computed');
    const nd = unwrapPayload(needsetRow);
    const missingRequired = Array.isArray(rc.missing_required_fields)
      ? rc.missing_required_fields
      : [];
    const criticalBelow = Array.isArray(rc.critical_fields_below_pass_target)
      ? rc.critical_fields_below_pass_target
      : [];

    return {
      rounds: [{
        round: 0,
        needset_size: toInt(nd.needset_size, 0),
        missing_required_count: missingRequired.length,
        critical_count: criticalBelow.length,
        confidence: toFloat(rc.confidence, 0),
        validated: Boolean(rc.validated),
        improved: false,
        improvement_reasons: []
      }],
      stop_reason: null,
      round_count: 1
    };
  }

  return {
    rounds: [],
    stop_reason: null,
    round_count: 0
  };
}
