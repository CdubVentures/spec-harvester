function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function toTierNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.max(1, Math.floor(direct));
  }
  const token = String(value || '').trim().toLowerCase();
  if (!token) return null;
  const match = token.match(/tier\s*([1-9])/i);
  if (match) return Number.parseInt(match[1], 10);
  if (token.includes('manufacturer')) return 1;
  if (token.includes('lab') || token.includes('review')) return 2;
  if (token.includes('retailer') || token.includes('store')) return 3;
  if (token.includes('database') || token.includes('community') || token.includes('aggregator')) return 4;
  return null;
}

export function parseTierPreferenceFromRule(fieldRule = {}) {
  const rule = isObject(fieldRule) ? fieldRule : {};
  const evidence = isObject(rule.evidence) ? rule.evidence : {};
  const raw = Array.isArray(evidence.tier_preference) ? evidence.tier_preference : [];
  const tiers = [];
  for (const entry of raw) {
    const tier = toTierNumber(entry);
    if (!tier) continue;
    if (!tiers.includes(tier)) tiers.push(tier);
  }
  return tiers;
}

export function parseTierPreferenceFromNeedRow(needRow = {}, fieldRule = {}) {
  const row = isObject(needRow) ? needRow : {};
  const fromNeed = Array.isArray(row.tier_preference)
    ? row.tier_preference.map((v) => toTierNumber(v)).filter((v) => Number.isFinite(v))
    : [];
  if (fromNeed.length > 0) {
    return [...new Set(fromNeed)];
  }
  const fromRule = parseTierPreferenceFromRule(fieldRule);
  if (fromRule.length > 0) {
    return fromRule;
  }
  return [1, 2, 3];
}
