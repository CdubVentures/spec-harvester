import {
  ANCHOR_FIELDS,
  COMMONLY_WRONG_FIELDS,
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

export function runConsensusEngine({
  sourceResults,
  categoryConfig,
  fieldOrder,
  anchors,
  identityLock,
  productId,
  category,
  config = {}
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
        instrumentedHost: Boolean(source.tierName === 'lab' || source.role === 'review'),
        keyPath: candidate.keyPath,
        url: source.url
      });
    }
  }

  let agreementAccumulator = 0;
  let agreementFieldCount = 0;

  for (const field of fieldOrder) {
    const rows = byField.get(field) || [];
    candidates[field] = rows.map((row) => ({
      value: row.value,
      host: row.host,
      tier: row.tier,
      method: row.method,
      evidenceKey: row.evidenceKey,
      ts: row.ts,
      approvedDomain: row.approvedDomain
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
        approvedDomain: evidence.approvedDomain
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
