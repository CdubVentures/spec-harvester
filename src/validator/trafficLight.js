function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function hasValue(value) {
  const token = normalizeToken(value);
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined';
}

function evidenceRank(row = {}) {
  const method = normalizeToken(row.method);
  if (method === 'component_db') {
    return 100;
  }
  const tier = toInt(row.tier, 99);
  if (tier === 1) {
    return 90;
  }
  if (tier === 2) {
    return 70;
  }
  if (tier === 3) {
    return 50;
  }
  return 20;
}

function bestEvidence(evidence = []) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return null;
  }
  return [...evidence]
    .sort((a, b) => evidenceRank(b) - evidenceRank(a))
    .find((row) => row && typeof row === 'object') || null;
}

function colorFromEvidence(evidenceRow = null) {
  if (!evidenceRow) {
    return 'red';
  }
  if (normalizeToken(evidenceRow.method) === 'component_db') {
    return 'green';
  }
  const tier = toInt(evidenceRow.tier, 99);
  if (tier === 1) {
    return 'green';
  }
  if (tier === 2) {
    return 'yellow';
  }
  return 'red';
}

function reasonFromColor({
  color,
  evidenceRow,
  unknownReason
}) {
  if (unknownReason) {
    return unknownReason;
  }
  if (color === 'green') {
    if (normalizeToken(evidenceRow?.method) === 'component_db') {
      return 'validated_component_library';
    }
    return 'tier1_or_manufacturer';
  }
  if (color === 'yellow') {
    return 'trusted_lab_or_database';
  }
  return 'low_trust_or_weak_evidence';
}

export function buildTrafficLight({
  fieldOrder = [],
  provenance = {},
  fieldReasoning = {}
}) {
  const byField = {};
  const counts = {
    green: 0,
    yellow: 0,
    red: 0
  };

  for (const field of fieldOrder || Object.keys(provenance || {})) {
    const row = provenance?.[field] || {};
    const unknownReason = normalizeToken(fieldReasoning?.[field]?.unknown_reason) || '';
    const value = row.value;
    if (!hasValue(value)) {
      byField[field] = {
        color: 'red',
        reason: unknownReason || 'unknown_value',
        confidence: Number(row.confidence || 0),
        source_tier: null,
        source_tier_name: null,
        source_method: null,
        source_url: null,
        unknown_reason: unknownReason || null
      };
      counts.red += 1;
      continue;
    }

    const evidence = bestEvidence(row.evidence || []);
    const color = colorFromEvidence(evidence);
    byField[field] = {
      color,
      reason: reasonFromColor({
        color,
        evidenceRow: evidence,
        unknownReason
      }),
      confidence: Number(row.confidence || 0),
      source_tier: evidence?.tier ?? null,
      source_tier_name: evidence?.tierName || null,
      source_method: evidence?.method || null,
      source_url: evidence?.url || null,
      unknown_reason: unknownReason || null
    };
    counts[color] += 1;
  }

  return {
    by_field: byField,
    counts
  };
}
