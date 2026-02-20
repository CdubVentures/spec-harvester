import { normalizeWhitespace } from '../utils/common.js';
import {
  clamp01,
  evaluateTargetMatchText,
  normalizeToken
} from '../pipeline/pipelineSharedHelpers.js';

const SURFACE_METHOD_MAP = {
  json_ld: 'json_ld',
  microdata: 'microdata',
  rdfa: 'rdfa',
  microformats: 'microformat',
  opengraph: 'opengraph',
  twitter: 'twitter_card'
};

const PASS_TARGET_EXEMPT_FIELDS = new Set(['id', 'brand', 'model', 'base_model', 'category', 'sku']);

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flattenObject(value, prefix = '', out = [], depth = 0) {
  if (value === null || value === undefined || depth > 8) {
    return out;
  }

  if (Array.isArray(value)) {
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      out.push({ path: prefix, value });
      return out;
    }
    value.forEach((item, index) => {
      flattenObject(item, `${prefix}[${index}]`, out, depth + 1);
    });
    return out;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${k}` : k;
      flattenObject(v, next, out, depth + 1);
    }
    return out;
  }

  out.push({ path: prefix, value });
  return out;
}

function normalizeValueToken(value = '') {
  return normalizeWhitespace(String(value || '')).toLowerCase();
}

function toNodesForSurface(surface = '', payload = null, cap = 200) {
  const limit = Math.max(1, Math.min(1000, toInt(cap, 200)));
  if (surface === 'opengraph' || surface === 'twitter') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    return [payload];
  }
  if (!Array.isArray(payload)) return [];
  return payload.slice(0, limit);
}

function mergeIdentityCandidates(target = {}, next = {}) {
  const out = { ...(target || {}) };
  for (const [field, value] of Object.entries(next || {})) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || normalized.toLowerCase() === 'unk') {
      continue;
    }
    const existing = normalizeWhitespace(out?.[field] || '');
    if (!existing || existing.toLowerCase() === 'unk' || existing.length < normalized.length) {
      out[field] = normalized;
    }
  }
  return out;
}

function baseCandidateKey(candidate = {}, canonicalUrl = '') {
  const keyPath = normalizeToken(candidate?.keyPath || candidate?.key_path || '');
  const value = normalizeValueToken(candidate?.value || '');
  const url = normalizeToken(canonicalUrl || '');
  return `${keyPath}|${value}|${url}`;
}

export function mergeStructuredMetadataCandidates({
  baseCandidates = [],
  sidecarResult = null,
  identityTarget = {},
  canonicalUrl = '',
  pickFieldFromPath = null,
  normalizeByField = null,
  gatherIdentityCandidates = null,
  shouldIgnoreDimensionPath = null,
  targetMatchThreshold = 0.55
} = {}) {
  const sourceCandidates = Array.isArray(baseCandidates) ? [...baseCandidates] : [];
  const dedupeSeen = new Set(sourceCandidates.map((row) => baseCandidateKey(row, canonicalUrl)));
  const sidecar = sidecarResult && typeof sidecarResult === 'object' ? sidecarResult : {};
  const surfaces = sidecar?.surfaces && typeof sidecar.surfaces === 'object' ? sidecar.surfaces : {};
  const statsFromSidecar = sidecar?.stats && typeof sidecar.stats === 'object' ? sidecar.stats : {};
  const rejectedFieldCandidates = [];
  const snippetRows = [];
  let identityCandidates = {};
  let addedCount = 0;

  const surfaceKeys = ['json_ld', 'microdata', 'rdfa', 'microformats', 'opengraph', 'twitter'];
  for (const surface of surfaceKeys) {
    const method = SURFACE_METHOD_MAP[surface] || surface;
    const nodes = toNodesForSurface(surface, surfaces[surface], 250);
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const node = nodes[nodeIndex];
      const flattened = flattenObject(node, '');
      if (typeof gatherIdentityCandidates === 'function') {
        const foundIdentity = gatherIdentityCandidates(flattened);
        identityCandidates = mergeIdentityCandidates(identityCandidates, foundIdentity);
      }

      const match = evaluateTargetMatchText({
        text: normalizeWhitespace(JSON.stringify(node || {}).slice(0, 8000)),
        identityTarget,
        threshold: targetMatchThreshold
      });
      const clusterId = `${surface}_node_${String(nodeIndex + 1).padStart(2, '0')}`;

      for (const item of flattened) {
        if (typeof pickFieldFromPath !== 'function') {
          continue;
        }
        const field = pickFieldFromPath(item.path);
        if (!field) {
          continue;
        }
        if (typeof shouldIgnoreDimensionPath === 'function' && shouldIgnoreDimensionPath(field, item.path)) {
          continue;
        }

        const value = typeof normalizeByField === 'function'
          ? normalizeByField(field, item.value)
          : normalizeWhitespace(item.value);
        if (!value || String(value).toLowerCase() === 'unk') {
          continue;
        }
        if (field.endsWith('_link') && !/^https?:\/\//i.test(String(value))) {
          continue;
        }

        const keyPath = `structured.${surface}[${nodeIndex}].${String(item.path || '').trim()}`;
        const candidate = {
          field,
          value,
          method,
          source_surface: method,
          keyPath,
          page_product_cluster_id: clusterId,
          target_match_score: match.target_match_score,
          target_match_passed: match.target_match_passed
        };
        if (!candidate.target_match_passed) {
          candidate.identity_reject_reason = match.identity_reject_reason || 'cluster_mismatch';
        }

        const canAccept = candidate.target_match_passed || PASS_TARGET_EXEMPT_FIELDS.has(field);
        if (!canAccept) {
          rejectedFieldCandidates.push(candidate);
          continue;
        }

        const dedupeKey = baseCandidateKey(candidate, canonicalUrl);
        if (dedupeSeen.has(dedupeKey)) {
          continue;
        }
        dedupeSeen.add(dedupeKey);
        sourceCandidates.push(candidate);
        addedCount += 1;

        snippetRows.push({
          source_surface: method,
          method,
          key_path: keyPath,
          value_preview: normalizeWhitespace(String(value)).slice(0, 220),
          page_product_cluster_id: clusterId,
          target_match_score: Number(match.target_match_score || 0),
          target_match_passed: Boolean(match.target_match_passed),
          identity_reject_reason: String(match.identity_reject_reason || '').trim() || null
        });
      }
    }
  }

  const computedStats = {
    json_ld_count: Array.isArray(surfaces.json_ld) ? surfaces.json_ld.length : 0,
    microdata_count: Array.isArray(surfaces.microdata) ? surfaces.microdata.length : 0,
    rdfa_count: Array.isArray(surfaces.rdfa) ? surfaces.rdfa.length : 0,
    microformats_count: Array.isArray(surfaces.microformats) ? surfaces.microformats.length : 0,
    opengraph_count: surfaces.opengraph && typeof surfaces.opengraph === 'object' && !Array.isArray(surfaces.opengraph)
      ? Object.keys(surfaces.opengraph).length
      : 0,
    twitter_count: surfaces.twitter && typeof surfaces.twitter === 'object' && !Array.isArray(surfaces.twitter)
      ? Object.keys(surfaces.twitter).length
      : 0
  };
  const stats = {
    json_ld_count: toInt(statsFromSidecar.json_ld_count, computedStats.json_ld_count),
    microdata_count: toInt(statsFromSidecar.microdata_count, computedStats.microdata_count),
    rdfa_count: toInt(statsFromSidecar.rdfa_count, computedStats.rdfa_count),
    microformats_count: toInt(statsFromSidecar.microformats_count, computedStats.microformats_count),
    opengraph_count: toInt(statsFromSidecar.opengraph_count, computedStats.opengraph_count),
    twitter_count: toInt(statsFromSidecar.twitter_count, computedStats.twitter_count),
    structured_candidates: addedCount,
    structured_rejected_candidates: rejectedFieldCandidates.length
  };

  return {
    fieldCandidates: sourceCandidates,
    identityCandidates,
    stats,
    snippetRows,
    rejectedFieldCandidates,
    errors: Array.isArray(sidecar?.errors)
      ? sidecar.errors.map((row) => String(row || '').trim()).filter(Boolean)
      : []
  };
}
