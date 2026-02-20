/**
 * Domain x Field Matrix (IP04-4A).
 *
 * Builds a matrix showing which domains contribute which fields,
 * with yield rates, acceptance rates, and quality scores.
 * Used for source prioritization and gap analysis.
 */

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeField(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Build a domain x field matrix from source intel data.
 *
 * @param {object} params
 * @param {object} params.domains - Source intel domain data (from sourceIntel.js)
 * @param {string[]} params.fieldOrder - Ordered list of field names
 * @returns {{ matrix, domain_summary, field_summary, top_domains_per_field }}
 */
export function buildDomainFieldMatrix({ domains = {}, fieldOrder = [] }) {
  const matrix = {};
  const domainSummary = {};
  const fieldSummary = {};

  for (const [domainKey, domainData] of Object.entries(domains)) {
    const host = normalizeHost(domainData?.rootDomain || domainKey);
    if (!host) continue;

    const fieldRewards = domainData?.field_rewards || domainData?.per_field || {};
    const row = {};
    let fieldsContributed = 0;
    let totalYield = 0;

    for (const [rewardKey, rewardData] of Object.entries(fieldRewards)) {
      const field = normalizeField(rewardKey.split('::')[0] || rewardKey);
      if (!field) continue;

      const accepted = Number(rewardData?.accepted || rewardData?.count || 0) || 0;
      const attempted = Number(rewardData?.attempted || rewardData?.attempts || 1) || 1;
      const yieldRate = attempted > 0 ? accepted / attempted : 0;

      row[field] = {
        accepted,
        attempted,
        yield_rate: Number(yieldRate.toFixed(4)),
        score: Number(rewardData?.score || rewardData?.field_reward_strength || 0) || 0
      };

      if (accepted > 0) fieldsContributed += 1;
      totalYield += yieldRate;

      if (!fieldSummary[field]) {
        fieldSummary[field] = { domains_contributing: 0, total_accepted: 0, total_attempted: 0 };
      }
      fieldSummary[field].total_accepted += accepted;
      fieldSummary[field].total_attempted += attempted;
      if (accepted > 0) fieldSummary[field].domains_contributing += 1;
    }

    matrix[host] = row;
    domainSummary[host] = {
      fields_contributed: fieldsContributed,
      mean_yield: fieldsContributed > 0 ? Number((totalYield / Object.keys(row).length).toFixed(4)) : 0,
      planner_score: Number(domainData?.planner_score || 0) || 0,
      total_attempts: Number(domainData?.attempts || 0) || 0,
      identity_match_rate: Number(domainData?.identity_match_rate || 0) || 0
    };
  }

  // Compute field yield rates
  for (const field of Object.keys(fieldSummary)) {
    const fs = fieldSummary[field];
    fs.yield_rate = fs.total_attempted > 0
      ? Number((fs.total_accepted / fs.total_attempted).toFixed(4))
      : 0;
  }

  // Top domains per field
  const topDomainsPerField = {};
  for (const field of (fieldOrder.length > 0 ? fieldOrder : Object.keys(fieldSummary))) {
    const nf = normalizeField(field);
    const candidates = [];
    for (const [host, row] of Object.entries(matrix)) {
      if (row[nf] && row[nf].accepted > 0) {
        candidates.push({ domain: host, ...row[nf] });
      }
    }
    candidates.sort((a, b) => b.yield_rate - a.yield_rate || b.accepted - a.accepted);
    topDomainsPerField[nf] = candidates.slice(0, 10);
  }

  return {
    matrix,
    domain_count: Object.keys(matrix).length,
    field_count: Object.keys(fieldSummary).length,
    domain_summary: domainSummary,
    field_summary: fieldSummary,
    top_domains_per_field: topDomainsPerField
  };
}

/**
 * Find fields with no contributing domains (coverage gaps).
 */
export function findFieldCoverageGaps({ fieldSummary = {}, fieldOrder = [] }) {
  const allFields = fieldOrder.length > 0 ? fieldOrder : Object.keys(fieldSummary);
  const gaps = [];
  const weak = [];

  for (const field of allFields) {
    const nf = normalizeField(field);
    const fs = fieldSummary[nf];
    if (!fs || fs.domains_contributing === 0) {
      gaps.push({ field: nf, reason: 'no_contributing_domains' });
    } else if (fs.domains_contributing === 1) {
      weak.push({ field: nf, reason: 'single_source_dependency', domains: fs.domains_contributing });
    } else if (fs.yield_rate < 0.3) {
      weak.push({ field: nf, reason: 'low_yield_rate', yield_rate: fs.yield_rate });
    }
  }

  return { gaps, weak, total_gaps: gaps.length, total_weak: weak.length };
}
