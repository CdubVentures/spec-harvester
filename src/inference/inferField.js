import { extractRootDomain, nowIso } from '../utils/common.js';
import { toRawFieldKey } from '../utils/fieldKeys.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasKnownValue(value) {
  const token = normalizeToken(value);
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function precisionRank(precision) {
  if (precision === 'day') return 3;
  if (precision === 'month') return 2;
  if (precision === 'year') return 1;
  return 0;
}

function canonicalDateValue(value, precision = 'day') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (precision === 'year') {
    return raw.slice(0, 4);
  }
  if (precision === 'month') {
    return raw.slice(0, 7);
  }
  return raw.slice(0, 10);
}

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const epoch = Date.parse(`${raw}T00:00:00Z`);
    if (Number.isFinite(epoch)) {
      return { value: raw, precision: 'day', epoch };
    }
  }

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const valueFull = `${raw}-01`;
    const epoch = Date.parse(`${valueFull}T00:00:00Z`);
    if (Number.isFinite(epoch)) {
      return { value: valueFull, precision: 'month', epoch };
    }
  }

  if (/^\d{4}$/.test(raw)) {
    const valueFull = `${raw}-01-01`;
    const epoch = Date.parse(`${valueFull}T00:00:00Z`);
    if (Number.isFinite(epoch)) {
      return { value: valueFull, precision: 'year', epoch };
    }
  }

  return null;
}

function daysBetween(leftEpoch, rightEpoch) {
  return Math.abs(leftEpoch - rightEpoch) / 86_400_000;
}

function sourceUrl(source = {}) {
  return String(source.finalUrl || source.url || '').trim();
}

function sourceRootDomain(source = {}) {
  return String(source.rootDomain || extractRootDomain(source.host || '') || '').toLowerCase();
}

function sourceMapByUrl(sourceResults = []) {
  const map = new Map();
  for (const source of sourceResults || []) {
    const url = sourceUrl(source);
    if (!url) {
      continue;
    }
    map.set(url, source);
  }
  return map;
}

function parseSourceHintToken(token) {
  const text = String(token || '');
  if (text.startsWith('source:')) {
    return text.slice('source:'.length);
  }
  return '';
}

function parseReleaseDateCandidates({
  temporalEvidence = {},
  sourceResults = []
}) {
  const candidates = [];
  const byUrl = sourceMapByUrl(sourceResults);

  for (const row of temporalEvidence.top_dates || []) {
    const parsed = parseIsoDate(row.value);
    if (!parsed) {
      continue;
    }
    const urls = (row.sources || [])
      .map((item) => parseSourceHintToken(item))
      .filter(Boolean);
    const supporting = [];
    for (const url of urls) {
      const source = byUrl.get(url) || {};
      supporting.push({
        url,
        host: String(source.host || '').toLowerCase(),
        rootDomain: sourceRootDomain(source),
        role: String(source.role || '').toLowerCase(),
        tier: toInt(source.tier, 4),
        quote: `Temporal date hint ${row.value} (${row.precision || parsed.precision})`
      });
    }
    if (!supporting.length && String(row.value || '').trim()) {
      supporting.push({
        url: '',
        host: '',
        rootDomain: '',
        role: '',
        tier: 4,
        quote: `Temporal date hint ${row.value}`
      });
    }
    candidates.push({
      value: parsed.value,
      precision: row.precision || parsed.precision,
      epoch: parsed.epoch,
      supporting
    });
  }

  // Include explicit release_date candidates if extractors found them on source pages.
  for (const source of sourceResults || []) {
    const url = sourceUrl(source);
    for (const candidate of source.fieldCandidates || []) {
      const field = toRawFieldKey(candidate.field);
      if (field !== 'release_date') {
        continue;
      }
      const parsed = parseIsoDate(candidate.value);
      if (!parsed) {
        continue;
      }
      candidates.push({
        value: parsed.value,
        precision: parsed.precision,
        epoch: parsed.epoch,
        explicit: true,
        supporting: [
          {
            url,
            host: String(source.host || '').toLowerCase(),
            rootDomain: sourceRootDomain(source),
            role: String(source.role || '').toLowerCase(),
            tier: toInt(source.tier, 4),
            quote: String(candidate.value || '').slice(0, 180)
          }
        ]
      });
    }
  }

  return candidates;
}

function chooseReleaseDateCandidate(candidates, policy = {}) {
  const minSources = Math.max(1, toInt(policy.min_sources, 2));
  const maxWindowDays = Math.max(1, toInt(policy.max_window_days, 45));

  const explicitTier1 = candidates
    .filter((row) => row.explicit)
    .filter((row) => row.supporting.some((item) => item.tier <= 1))
    .sort((a, b) => a.epoch - b.epoch || precisionRank(b.precision) - precisionRank(a.precision));
  if (explicitTier1.length > 0) {
    const winner = explicitTier1[0];
    return {
      candidate: winner,
      basis: 'explicit_release',
      precision: winner.precision || 'day',
      confidence: 0.93,
      support: winner.supporting
    };
  }

  if (!candidates.length) {
    return null;
  }

  const sorted = [...candidates]
    .sort((a, b) => a.epoch - b.epoch || precisionRank(b.precision) - precisionRank(a.precision));
  let best = null;

  for (const pivot of sorted) {
    const inWindow = sorted.filter((row) => daysBetween(row.epoch, pivot.epoch) <= maxWindowDays);
    const support = inWindow.flatMap((row) => row.supporting || []);
    const domains = new Set(
      support
        .map((item) => String(item.rootDomain || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const domainCount = domains.size;
    const score = (domainCount * 10) + inWindow.length;
    if (!best || score > best.score) {
      best = {
        pivot,
        inWindow,
        support,
        domainCount,
        score
      };
    }
  }

  if (!best || best.domainCount < minSources) {
    return null;
  }

  const earliest = [...best.inWindow]
    .sort((a, b) => a.epoch - b.epoch || precisionRank(b.precision) - precisionRank(a.precision))[0];
  const roles = new Set(best.support.map((item) => String(item.role || '').toLowerCase()).filter(Boolean));
  const basis = roles.has('manufacturer')
    ? 'support_first_seen'
    : (best.domainCount >= Math.max(2, minSources) ? 'multi_source_consensus' : 'earliest_review');
  const confidence = Math.min(0.88, 0.62 + (best.domainCount * 0.06));

  return {
    candidate: earliest,
    basis,
    precision: earliest.precision || 'day',
    confidence: Number.parseFloat(confidence.toFixed(4)),
    support: best.support
  };
}

function ensureProvenanceBucket(provenance = {}, field) {
  if (!provenance[field]) {
    provenance[field] = {
      value: 'unk',
      confirmations: 0,
      approved_confirmations: 0,
      pass_target: 1,
      meets_pass_target: false,
      confidence: 0,
      evidence: []
    };
  }
  return provenance[field];
}

function applyReleaseDateInference({
  categoryConfig,
  normalized,
  provenance,
  sourceResults,
  temporalEvidence,
  policy,
  logger
}) {
  const decisions = {
    field: 'release_date',
    applied: false,
    reason: '',
    release_date: '',
    release_date_precision: '',
    release_date_basis: '',
    release_date_confidence: 0,
    evidence_refs: []
  };
  const fieldOrder = new Set(categoryConfig?.fieldOrder || []);
  const currentValue = normalized?.fields?.release_date;
  if (hasKnownValue(currentValue)) {
    decisions.reason = 'existing_value_present';
    return decisions;
  }

  const candidates = parseReleaseDateCandidates({
    temporalEvidence,
    sourceResults
  });
  const selected = chooseReleaseDateCandidate(candidates, policy);
  if (!selected) {
    decisions.reason = 'insufficient_temporal_consensus';
    return decisions;
  }

  const releaseDate = canonicalDateValue(selected.candidate.value, selected.precision);
  if (!releaseDate) {
    decisions.reason = 'invalid_inferred_value';
    return decisions;
  }

  normalized.fields.release_date = releaseDate;
  if (fieldOrder.has('release_date_precision')) {
    normalized.fields.release_date_precision = selected.precision;
  }
  if (fieldOrder.has('release_date_basis')) {
    normalized.fields.release_date_basis = selected.basis;
  }
  if (fieldOrder.has('release_date_confidence')) {
    normalized.fields.release_date_confidence = String(selected.confidence);
  }

  const releaseBucket = ensureProvenanceBucket(provenance, 'release_date');
  releaseBucket.value = releaseDate;
  releaseBucket.confirmations = Math.max(1, toInt(releaseBucket.confirmations, 0));
  releaseBucket.approved_confirmations = Math.max(1, toInt(releaseBucket.approved_confirmations, 0));
  releaseBucket.pass_target = Math.max(1, toInt(releaseBucket.pass_target, 1));
  releaseBucket.meets_pass_target = true;
  releaseBucket.confidence = Math.max(Number(releaseBucket.confidence || 0), Number(selected.confidence || 0.7));
  const evidence = [];
  for (const [index, row] of selected.support.slice(0, 8).entries()) {
    evidence.push({
      url: row.url || 'inference://temporal',
      host: row.host || '',
      rootDomain: row.rootDomain || '',
      tier: row.tier || 2,
      tierName: row.tier <= 1 ? 'manufacturer' : 'database',
      method: 'temporal_inferred',
      keyPath: `inference.release_date.${index + 1}`,
      approvedDomain: row.tier <= 2,
      snippet_id: `temporal:${index + 1}`,
      quote: String(row.quote || '').slice(0, 200)
    });
  }
  releaseBucket.evidence = [
    ...(Array.isArray(releaseBucket.evidence) ? releaseBucket.evidence : []),
    ...evidence
  ];

  decisions.applied = true;
  decisions.reason = 'inferred_from_temporal_evidence';
  decisions.release_date = releaseDate;
  decisions.release_date_precision = selected.precision;
  decisions.release_date_basis = selected.basis;
  decisions.release_date_confidence = selected.confidence;
  decisions.evidence_refs = evidence.map((row) => ({
    url: row.url,
    snippet_id: row.snippet_id,
    quote: row.quote
  }));
  logger?.info?.('inference_field_applied', {
    field: 'release_date',
    release_date: releaseDate,
    precision: selected.precision,
    basis: selected.basis,
    confidence: selected.confidence,
    evidence_count: evidence.length
  });
  return decisions;
}

export function applyInferencePolicies({
  categoryConfig,
  normalized,
  provenance,
  summaryHint = {},
  sourceResults = [],
  logger = null
}) {
  const policy = categoryConfig?.schema?.inference_policy || {};
  const now = nowIso();
  const decisions = {};
  const filledFields = [];

  for (const [field, fieldPolicyRaw] of Object.entries(policy)) {
    const fieldPolicy = fieldPolicyRaw && typeof fieldPolicyRaw === 'object' ? fieldPolicyRaw : {};
    if (!fieldPolicy.enabled) {
      continue;
    }
    const type = String(fieldPolicy.type || '').trim().toLowerCase();
    if (field === 'release_date' && type === 'date_estimate') {
      const decision = applyReleaseDateInference({
        categoryConfig,
        normalized,
        provenance,
        sourceResults,
        temporalEvidence: summaryHint.temporal_evidence || {},
        policy: fieldPolicy,
        logger
      });
      decisions[field] = decision;
      if (decision.applied) {
        filledFields.push(field);
      } else {
        logger?.info?.('inference_field_skipped', {
          field,
          reason: decision.reason || 'no_inference'
        });
      }
      continue;
    }

    decisions[field] = {
      field,
      applied: false,
      reason: type ? `unsupported_policy_type:${type}` : 'missing_policy_type'
    };
    logger?.info?.('inference_field_skipped', {
      field,
      reason: decisions[field].reason
    });
  }

  return {
    applied_count: filledFields.length,
    filled_fields: [...new Set(filledFields)],
    decisions,
    updated_at: now
  };
}
