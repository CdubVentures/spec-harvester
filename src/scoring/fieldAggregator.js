import {
  ANCHOR_FIELDS,
  COMMONLY_WRONG_FIELDS,
  INSTRUMENTED_FIELDS,
  INSTRUMENTED_HOST_HINTS,
  KNOWN_LIST_VALUES,
  MOUSE_FIELD_ORDER
} from '../constants.js';

const TIER_WEIGHT = {
  1: 1,
  2: 0.8,
  3: 0.5
};

const METHOD_WEIGHT = {
  network_json: 1,
  pdf_table: 0.95,
  pdf_kv: 0.93,
  pdf: 0.82,
  scanned_pdf_ocr_table: 0.88,
  scanned_pdf_ocr_kv: 0.86,
  scanned_pdf_ocr_text: 0.78,
  json_ld: 0.9,
  microdata: 0.88,
  opengraph: 0.8,
  microformat: 0.78,
  rdfa: 0.78,
  twitter_card: 0.78,
  embedded_state: 0.85,
  ldjson: 0.75,
  dom: 0.4
};

const PASS_TARGET_EXEMPT_FIELDS = new Set([
  'id',
  'brand',
  'model',
  'base_model',
  'category',
  'sku'
]);

function unknownFieldMap() {
  const map = {};
  for (const field of MOUSE_FIELD_ORDER) {
    map[field] = 'unk';
  }
  return map;
}

function toArray(set) {
  return [...set.values()];
}

function sortByScore(entries) {
  return entries.sort((a, b) => {
    if (b.domainCount !== a.domainCount) {
      return b.domainCount - a.domainCount;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.value.localeCompare(b.value);
  });
}

function passTargetForField(field) {
  if (ANCHOR_FIELDS.includes(field)) {
    return 1;
  }
  return COMMONLY_WRONG_FIELDS.has(field) ? 5 : 3;
}

function isInstrumentedSource(source) {
  if (source.role === 'review' && source.tier <= 2) {
    return true;
  }
  return INSTRUMENTED_HOST_HINTS.has(source.rootDomain);
}

function calcConfidenceForField(entry) {
  if (!entry) {
    return 0;
  }
  const density = Math.min(1, entry.domainCount / 5);
  const quality = Math.min(1, entry.score / 5);
  return Math.min(1, (density * 0.7) + (quality * 0.3));
}

function projectEntry(entry, allowTier3) {
  const filteredEvidence = entry.evidence.filter((ev) => allowTier3 || ev.tier <= 2);
  if (filteredEvidence.length === 0) {
    return {
      ...entry,
      domainCount: 0,
      instrumentedCount: 0,
      score: 0,
      domains: new Set(),
      instrumentedDomains: new Set(),
      evidence: []
    };
  }

  const domains = new Set(filteredEvidence.map((ev) => ev.rootDomain));
  const instrumentedDomains = new Set(
    filteredEvidence
      .filter((ev) => INSTRUMENTED_HOST_HINTS.has(ev.rootDomain) || ev.role === 'review')
      .map((ev) => ev.rootDomain)
  );

  const score = filteredEvidence.reduce((acc, ev) => {
    const methodWeight = METHOD_WEIGHT[ev.method] || 0.4;
    const tierWeight = TIER_WEIGHT[ev.tier] || 0.3;
    return acc + (methodWeight * tierWeight);
  }, 0);

  return {
    ...entry,
    domains,
    instrumentedDomains,
    score,
    domainCount: domains.size,
    instrumentedCount: instrumentedDomains.size,
    evidence: filteredEvidence
  };
}

export function aggregateFieldValues(sourceResults, identityLock, productId) {
  const fields = unknownFieldMap();
  const provenance = {};
  const fieldsBelowPassTarget = [];
  const newValuesProposed = [];

  fields.id = productId;
  fields.brand = identityLock.brand || 'unk';
  fields.model = identityLock.model || 'unk';
  fields.base_model = identityLock.model || 'unk';
  fields.category = 'mouse';
  fields.sku = identityLock.sku || 'unk';

  const evidenceMap = new Map();

  for (const source of sourceResults) {
    if (!source.identity?.match) {
      continue;
    }
    if ((source.anchorCheck?.majorConflicts || []).length > 0) {
      continue;
    }

    for (const candidate of source.fieldCandidates || []) {
      const field = candidate.field;
      const value = candidate.value;
      if (!field || !value || value === 'unk') {
        continue;
      }

      const methodWeight = METHOD_WEIGHT[candidate.method] || 0.4;
      const tierWeight = TIER_WEIGHT[source.tier] || 0.3;
      const weighted = methodWeight * tierWeight;

      if (!evidenceMap.has(field)) {
        evidenceMap.set(field, new Map());
      }
      const byValue = evidenceMap.get(field);
      if (!byValue.has(value)) {
        byValue.set(value, {
          value,
          score: 0,
          domains: new Set(),
          methods: new Set(),
          tiers: new Set(),
          evidence: [],
          instrumentedDomains: new Set()
        });
      }

      const row = byValue.get(value);
      row.score += weighted;
      row.domains.add(source.rootDomain);
      row.methods.add(candidate.method);
      row.tiers.add(source.tier);
      row.evidence.push({
        url: source.url,
        host: source.host,
        rootDomain: source.rootDomain,
        tier: source.tier,
        role: source.role,
        method: candidate.method,
        keyPath: candidate.keyPath
      });

      if (isInstrumentedSource(source)) {
        row.instrumentedDomains.add(source.rootDomain);
      }
    }
  }

  for (const field of MOUSE_FIELD_ORDER) {
    const byValue = evidenceMap.get(field);
    if (!byValue || byValue.size === 0) {
      provenance[field] = {
        value: fields[field],
        confirmations: 0,
        pass_target: passTargetForField(field),
        meets_pass_target: false,
        confidence: 0,
        evidence: []
      };

      if (!ANCHOR_FIELDS.includes(field) && !PASS_TARGET_EXEMPT_FIELDS.has(field)) {
        fieldsBelowPassTarget.push(field);
      }
      continue;
    }

    const hasTier12Evidence = toArray(new Set(byValue.values())).some((entry) =>
      entry.evidence.some((ev) => ev.tier <= 2)
    );
    const ranked = sortByScore(
      toArray(new Set(byValue.values()))
        .map((entry) => projectEntry(entry, !hasTier12Evidence))
        .filter((entry) => entry.domainCount > 0)
    );

    if (!ranked.length) {
      provenance[field] = {
        value: fields[field],
        confirmations: 0,
        pass_target: passTargetForField(field),
        meets_pass_target: false,
        confidence: 0,
        evidence: []
      };
      if (!ANCHOR_FIELDS.includes(field) && !PASS_TARGET_EXEMPT_FIELDS.has(field)) {
        fieldsBelowPassTarget.push(field);
      }
      continue;
    }

    const best = ranked[0];
    const passTarget = passTargetForField(field);
    const hasPasses = best.domainCount >= passTarget;

    let accepted = hasPasses;
    if (!ANCHOR_FIELDS.includes(field) && INSTRUMENTED_FIELDS.has(field)) {
      accepted = best.instrumentedCount >= 3;
    }

    if (
      !ANCHOR_FIELDS.includes(field) &&
      !accepted &&
      !PASS_TARGET_EXEMPT_FIELDS.has(field)
    ) {
      fieldsBelowPassTarget.push(field);
      fields[field] = 'unk';
    } else {
      fields[field] = best.value;
    }

    provenance[field] = {
      value: fields[field],
      confirmations: best.domainCount,
      instrumented_confirmations: best.instrumentedCount,
      pass_target: passTarget,
      meets_pass_target: accepted,
      confidence: calcConfidenceForField(best),
      tier_best: Math.min(...best.tiers),
      method_best: best.methods.values().next().value,
      domains: [...best.domains],
      evidence: best.evidence
    };
  }

  if (fields.connection === 'wired' && fields.battery_hours === 'unk') {
    fields.battery_hours = 'n/a';
    if (provenance.battery_hours) {
      provenance.battery_hours.value = 'n/a';
      provenance.battery_hours.meets_pass_target = true;
    }
  }

  for (const [field, allowedValues] of Object.entries(KNOWN_LIST_VALUES)) {
    const value = fields[field];
    if (!value || value === 'unk' || value === 'n/a') {
      continue;
    }

    const parts = value
      .toLowerCase()
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    for (const part of parts) {
      if (!allowedValues.includes(part)) {
        newValuesProposed.push({ field, value: part });
      }
    }
  }

  return {
    fields,
    provenance,
    fieldsBelowPassTarget: [...new Set(fieldsBelowPassTarget)],
    newValuesProposed
  };
}

export function tsvRowFromFields(fields) {
  return MOUSE_FIELD_ORDER.map((field) => fields[field] ?? 'unk').join('\t');
}
