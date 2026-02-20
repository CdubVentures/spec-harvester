import { splitListValue } from '../utils/common.js';

// ---------------------------------------------------------------------------
// item_union reducer — post-consensus list merge across candidates
//
// Supported policies:
//   set_union     — winner items first, then unique items from other approved
//                   candidates (sorted by tier/score)
//   ordered_union — same merge order, preserves each candidate's internal
//                   item order
//
// Deferred:
//   evidence_union — requires per-item evidence tracking (no-op for now)
//
// Default (absent): no-op (winner-takes-all, standard consensus behavior)
// ---------------------------------------------------------------------------

const SUPPORTED_POLICIES = new Set(['set_union', 'ordered_union']);

function hasKnownValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

function dedupeKey(item) {
  return String(item).trim().toLowerCase();
}

function sortCandidatesByRank(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

function applyUnion(winnerItems, rankedCandidates) {
  const seen = new Set(winnerItems.map(dedupeKey));
  const merged = [...winnerItems];

  for (const candidate of rankedCandidates) {
    const items = splitListValue(candidate.value);
    for (const item of items) {
      const key = dedupeKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
  }

  return merged;
}

export function applyListUnionReducers({ fields, candidates, fieldRulesEngine }) {
  const result = { fields: { ...fields }, applied: [] };
  if (!fieldRulesEngine) {
    return result;
  }

  for (const field of fieldRulesEngine.getAllFieldKeys()) {
    const rule = fieldRulesEngine.getFieldRule(field);
    const policy = rule?.contract?.list_rules?.item_union;
    if (!policy || !SUPPORTED_POLICIES.has(policy)) {
      continue;
    }

    const winnerValue = result.fields[field];
    if (!hasKnownValue(winnerValue)) {
      continue;
    }

    const fieldCandidates = candidates[field];
    if (!Array.isArray(fieldCandidates) || fieldCandidates.length < 2) {
      continue;
    }

    const approvedCandidates = fieldCandidates.filter((c) => c.approvedDomain);
    if (approvedCandidates.length < 2) {
      continue;
    }

    const winnerItems = splitListValue(winnerValue);
    const ranked = sortCandidatesByRank(approvedCandidates);
    const merged = applyUnion(winnerItems, ranked);

    if (merged.length === winnerItems.length) {
      continue;
    }

    const addedCount = merged.length - winnerItems.length;
    result.fields[field] = merged.join(', ');
    result.applied.push({
      field,
      policy,
      before_count: winnerItems.length,
      after_count: merged.length,
      added_count: addedCount
    });
  }

  return result;
}
