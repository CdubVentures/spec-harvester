import { nowIso } from '../utils/common.js';

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function normalizePath(url) {
  try {
    const parsed = new URL(url);
    const pathname = String(parsed.pathname || '/').replace(/\/+/g, '/');
    if (!pathname || pathname === '/') {
      return '/';
    }
    return pathname.endsWith('/') ? pathname.slice(0, -1).toLowerCase() : pathname.toLowerCase();
  } catch {
    return '/';
  }
}

function ensureBucket(map, key) {
  if (!map[key]) {
    map[key] = {
      attempts: 0,
      fields: {},
      updated_at: nowIso()
    };
  }
  return map[key];
}

function ensureFieldRow(bucket, field) {
  if (!bucket.fields[field]) {
    bucket.fields[field] = {
      seen: 0,
      accepted: 0,
      yield: 0
    };
  }
  return bucket.fields[field];
}

function buildAcceptedEvidenceMap(provenance = {}) {
  const map = {
    byDomainField: new Set(),
    byPathField: new Set(),
    byHostField: new Set()
  };
  for (const [field, row] of Object.entries(provenance || {})) {
    if (String(row?.value || '').trim().toLowerCase() === 'unk') {
      continue;
    }
    for (const evidence of row?.evidence || []) {
      const domain = String(evidence.rootDomain || evidence.host || '').toLowerCase();
      const host = String(evidence.host || '').toLowerCase();
      const path = normalizePath(evidence.url || '');
      if (domain) {
        map.byDomainField.add(`${domain}||${field}`);
        map.byPathField.add(`${domain}||${path}||${field}`);
      }
      if (host) {
        map.byHostField.add(`${host}||${field}`);
      }
    }
  }
  return map;
}

function updateFromSource({
  source,
  artifact,
  acceptedMap
}) {
  const domain = String(source.rootDomain || source.host || '').toLowerCase();
  const host = String(source.host || '').toLowerCase();
  const path = normalizePath(source.finalUrl || source.url || '');
  const fingerprint = String(source.fingerprint?.id || '').trim();
  const fieldsSeen = new Set(
    (source.fieldCandidates || [])
      .map((candidate) => String(candidate.field || '').trim())
      .filter(Boolean)
  );

  if (!domain || !fieldsSeen.size) {
    return;
  }

  const domainBucket = ensureBucket(artifact.by_domain, domain);
  domainBucket.attempts += 1;
  domainBucket.updated_at = nowIso();

  const pathKey = `${domain}||${path}`;
  const pathBucket = ensureBucket(artifact.by_path, pathKey);
  pathBucket.attempts += 1;
  pathBucket.updated_at = nowIso();

  const hostBucket = ensureBucket(artifact.by_host, host || domain);
  hostBucket.attempts += 1;
  hostBucket.updated_at = nowIso();

  let fingerprintBucket = null;
  if (fingerprint) {
    fingerprintBucket = ensureBucket(artifact.by_fingerprint, fingerprint);
    fingerprintBucket.attempts += 1;
    fingerprintBucket.updated_at = nowIso();
  }

  for (const field of fieldsSeen) {
    const domainRow = ensureFieldRow(domainBucket, field);
    const pathRow = ensureFieldRow(pathBucket, field);
    const hostRow = ensureFieldRow(hostBucket, field);

    domainRow.seen += 1;
    pathRow.seen += 1;
    hostRow.seen += 1;

    const domainAccepted = acceptedMap.byDomainField.has(`${domain}||${field}`);
    const pathAccepted = acceptedMap.byPathField.has(`${domain}||${path}||${field}`);
    const hostAccepted = acceptedMap.byHostField.has(`${host}||${field}`);
    if (domainAccepted) {
      domainRow.accepted += 1;
    }
    if (pathAccepted) {
      pathRow.accepted += 1;
    }
    if (hostAccepted) {
      hostRow.accepted += 1;
    }

    domainRow.yield = round(domainRow.accepted / Math.max(1, domainRow.seen), 6);
    pathRow.yield = round(pathRow.accepted / Math.max(1, pathRow.seen), 6);
    hostRow.yield = round(hostRow.accepted / Math.max(1, hostRow.seen), 6);

    if (fingerprintBucket) {
      const fpRow = ensureFieldRow(fingerprintBucket, field);
      fpRow.seen += 1;
      if (domainAccepted || pathAccepted || hostAccepted) {
        fpRow.accepted += 1;
      }
      fpRow.yield = round(fpRow.accepted / Math.max(1, fpRow.seen), 6);
    }
  }
}

export function defaultFieldYield() {
  return {
    version: 1,
    updated_at: nowIso(),
    by_domain: {},
    by_path: {},
    by_host: {},
    by_fingerprint: {},
    stats: {
      updates_total: 0
    }
  };
}

export function updateFieldYield({
  artifact,
  provenance,
  sourceResults = [],
  seenAt = nowIso()
}) {
  const next = artifact && typeof artifact === 'object'
    ? artifact
    : defaultFieldYield();
  next.stats = next.stats || { updates_total: 0 };
  next.stats.updates_total += 1;

  const acceptedMap = buildAcceptedEvidenceMap(provenance);
  for (const source of sourceResults || []) {
    updateFromSource({
      source,
      artifact: next,
      acceptedMap
    });
  }
  next.updated_at = seenAt;
  return next;
}
