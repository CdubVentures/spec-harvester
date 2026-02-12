import { nowIso } from '../utils/common.js';
import { normalizeFieldList, toRawFieldKey } from '../utils/fieldKeys.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function hasKnownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase();
}

function ensureThresholds(artifact = {}) {
  return {
    min_validated_seen: Math.max(1, toInt(artifact?.thresholds?.min_validated_seen, 50)),
    expected_rate: Math.max(0, Math.min(1, Number.parseFloat(String(artifact?.thresholds?.expected_rate ?? 0.85)) || 0.85)),
    rare_rate: Math.max(0, Math.min(1, Number.parseFloat(String(artifact?.thresholds?.rare_rate ?? 0.25)) || 0.25)),
    rare_override_min_seen: Math.max(1, toInt(artifact?.thresholds?.rare_override_min_seen, 20)),
    rare_override_not_publicly_disclosed_ratio: Math.max(
      0,
      Math.min(
        1,
        Number.parseFloat(String(artifact?.thresholds?.rare_override_not_publicly_disclosed_ratio ?? 0.65)) || 0.65
      )
    )
  };
}

function ensureFieldRow(row = {}) {
  return {
    validated_seen: toInt(row.validated_seen, 0),
    validated_filled: toInt(row.validated_filled, 0),
    filled_rate_validated: Number.parseFloat(String(row.filled_rate_validated || 0)) || 0,
    classification: String(row.classification || 'sometimes'),
    unknown_reason_counts: row.unknown_reason_counts && typeof row.unknown_reason_counts === 'object'
      ? row.unknown_reason_counts
      : {},
    top_domains: Array.isArray(row.top_domains) ? row.top_domains : [],
    domain_stats: row.domain_stats && typeof row.domain_stats === 'object'
      ? row.domain_stats
      : {}
  };
}

function classifyField(row, thresholds) {
  const validatedSeen = toInt(row.validated_seen, 0);
  const filledRate = validatedSeen > 0
    ? Number.parseFloat((row.validated_filled / Math.max(1, validatedSeen)).toFixed(6))
    : 0;
  row.filled_rate_validated = filledRate;

  const reasonCounts = row.unknown_reason_counts || {};
  const unknownTotal = Object.values(reasonCounts).reduce(
    (sum, value) => sum + toInt(value, 0),
    0
  );
  const notPublicCount = toInt(reasonCounts.not_publicly_disclosed, 0);
  const notPublicRatio = unknownTotal > 0
    ? notPublicCount / unknownTotal
    : 0;

  let classification = 'sometimes';
  if (validatedSeen >= thresholds.min_validated_seen && filledRate >= thresholds.expected_rate) {
    classification = 'expected';
  } else if (validatedSeen >= thresholds.min_validated_seen && filledRate < thresholds.rare_rate) {
    classification = 'rare';
  } else if (
    validatedSeen >= thresholds.rare_override_min_seen &&
    filledRate < Math.max(thresholds.rare_rate, 0.5) &&
    notPublicRatio >= thresholds.rare_override_not_publicly_disclosed_ratio
  ) {
    classification = 'rare';
  }

  row.classification = classification;
  return row;
}

function updateTopDomains(row) {
  const stats = row.domain_stats || {};
  const top = Object.entries(stats)
    .map(([rootDomain, item]) => {
      const seen = toInt(item.seen, 0);
      const filled = toInt(item.filled, 0);
      return {
        rootDomain,
        filled,
        seen,
        rate: seen > 0 ? round(filled / seen, 6) : 0
      };
    })
    .sort((a, b) => b.rate - a.rate || b.seen - a.seen || a.rootDomain.localeCompare(b.rootDomain))
    .slice(0, 12);
  row.top_domains = top;
}

function bestEvidenceDomain(provenanceRow = {}) {
  const evidence = Array.isArray(provenanceRow?.evidence) ? provenanceRow.evidence : [];
  if (!evidence.length) {
    return '';
  }
  const ranked = [...evidence].sort((a, b) => {
    const at = Number.parseInt(String(a.tier ?? 99), 10) || 99;
    const bt = Number.parseInt(String(b.tier ?? 99), 10) || 99;
    if (at !== bt) {
      return at - bt;
    }
    return String(a.url || '').localeCompare(String(b.url || ''));
  });
  const best = ranked[0] || {};
  return normalizeDomain(best.rootDomain || best.host || '');
}

export function defaultFieldAvailability() {
  return {
    version: 1,
    updated_at: nowIso(),
    fields: {},
    thresholds: {
      min_validated_seen: 50,
      expected_rate: 0.85,
      rare_rate: 0.25,
      rare_override_min_seen: 20,
      rare_override_not_publicly_disclosed_ratio: 0.65
    }
  };
}

export function availabilityClassForField(artifact = {}, field) {
  const key = String(field || '').trim();
  if (!key) {
    return 'sometimes';
  }
  return String(artifact?.fields?.[key]?.classification || 'sometimes');
}

export function summarizeAvailability(artifact = {}) {
  const rows = Object.entries(artifact?.fields || {});
  const counts = {
    expected: 0,
    sometimes: 0,
    rare: 0
  };
  const expectedUnknown = [];
  for (const [field, rowRaw] of rows) {
    const row = ensureFieldRow(rowRaw);
    const klass = String(row.classification || 'sometimes');
    if (counts[klass] !== undefined) {
      counts[klass] += 1;
    } else {
      counts.sometimes += 1;
    }
    if (klass !== 'expected') {
      continue;
    }
    const unknownRate = row.validated_seen > 0
      ? round((row.validated_seen - row.validated_filled) / row.validated_seen, 6)
      : 0;
    expectedUnknown.push({
      field,
      validated_seen: row.validated_seen,
      validated_filled: row.validated_filled,
      unknown_rate: unknownRate,
      top_unknown_reason: Object.entries(row.unknown_reason_counts || {})
        .sort((a, b) => toInt(b[1], 0) - toInt(a[1], 0))[0]?.[0] || ''
    });
  }
  expectedUnknown.sort((a, b) => b.unknown_rate - a.unknown_rate || b.validated_seen - a.validated_seen);
  return {
    counts,
    top_expected_unknown: expectedUnknown.slice(0, 15)
  };
}

export function classifyMissingFields({
  artifact = {},
  missingFields = [],
  fieldOrder = []
}) {
  const normalized = normalizeFieldList(missingFields, { fieldOrder });
  const result = {
    expected: [],
    sometimes: [],
    rare: []
  };
  for (const field of normalized) {
    const classification = availabilityClassForField(artifact, field);
    if (classification === 'expected') {
      result.expected.push(field);
    } else if (classification === 'rare') {
      result.rare.push(field);
    } else {
      result.sometimes.push(field);
    }
  }
  return result;
}

export function updateFieldAvailability({
  artifact,
  fieldOrder = [],
  normalized,
  summary,
  provenance,
  validated = false,
  seenAt = nowIso()
}) {
  const next = artifact && typeof artifact === 'object'
    ? artifact
    : defaultFieldAvailability();
  const thresholds = ensureThresholds(next);
  next.thresholds = thresholds;
  next.fields = next.fields || {};

  const normalizedFields = normalized?.fields || {};
  const fieldReasoning = summary?.field_reasoning || {};
  const relevantFields = normalizeFieldList(fieldOrder && fieldOrder.length ? fieldOrder : Object.keys(normalizedFields), {
    fieldOrder
  });

  for (const field of relevantFields) {
    const row = ensureFieldRow(next.fields[field]);

    if (validated) {
      row.validated_seen += 1;
      if (hasKnownValue(normalizedFields[field])) {
        row.validated_filled += 1;
      }
    }

    const unknownReason = String(fieldReasoning?.[field]?.unknown_reason || '').trim();
    if (unknownReason) {
      row.unknown_reason_counts[unknownReason] = toInt(row.unknown_reason_counts[unknownReason], 0) + 1;
    }

    const domain = bestEvidenceDomain((provenance || {})[field] || {});
    if (domain) {
      if (!row.domain_stats[domain]) {
        row.domain_stats[domain] = {
          seen: 0,
          filled: 0
        };
      }
      row.domain_stats[domain].seen += 1;
      if (hasKnownValue(normalizedFields[field])) {
        row.domain_stats[domain].filled += 1;
      }
    }

    classifyField(row, thresholds);
    updateTopDomains(row);
    next.fields[field] = row;
  }

  next.updated_at = seenAt;
  return next;
}

export function availabilitySearchEffort({
  artifact = {},
  missingFields = [],
  fieldOrder = []
}) {
  const buckets = classifyMissingFields({
    artifact,
    missingFields,
    fieldOrder
  });
  return {
    expected_count: buckets.expected.length,
    sometimes_count: buckets.sometimes.length,
    rare_count: buckets.rare.length,
    missing_expected_fields: buckets.expected,
    missing_sometimes_fields: buckets.sometimes,
    missing_rare_fields: buckets.rare
  };
}

export function undisclosedThresholdForField({
  field,
  artifact = {},
  highYieldDomainCount = 0
}) {
  const classification = availabilityClassForField(artifact, toRawFieldKey(field));
  let threshold = 80;
  if (classification === 'expected') {
    threshold = 130;
  } else if (classification === 'rare') {
    threshold = 35;
  } else {
    threshold = 80;
  }
  if (highYieldDomainCount > 0) {
    threshold += classification === 'rare' ? 12 : 24;
  }
  return Math.max(20, threshold);
}
