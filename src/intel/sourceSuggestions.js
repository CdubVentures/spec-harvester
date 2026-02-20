/**
 * Source Promotion / Demotion Suggestions (IP04-4B).
 *
 * Analyses domain stats from sourceIntel and generates:
 *   - Promotion suggestions: candidate domains that should be elevated to approved
 *   - Demotion suggestions: domains that should be added to the deny list
 */

const DEFAULT_PROMOTION_THRESHOLDS = {
  min_products_seen: 20,
  min_identity_match_rate: 0.98,
  max_major_anchor_conflicts: 0,
  min_fields_accepted: 10,
  min_critical_fields: 1
};

const DEFAULT_DEMOTION_THRESHOLDS = {
  min_attempts: 8,
  max_identity_match_rate: 0.50,
  max_http_ok_rate: 0.30,
  max_anchor_conflict_rate: 0.40,
  min_negative_field_reward: -0.30
};

function num(value) {
  return Number(value || 0) || 0;
}

/**
 * Generate promotion suggestions for candidate domains.
 */
export function buildPromotionSuggestions({ domains = {}, thresholds = {} } = {}) {
  const t = { ...DEFAULT_PROMOTION_THRESHOLDS, ...thresholds };
  const suggestions = [];

  for (const entry of Object.values(domains)) {
    if (num(entry.approved_attempts) > 0) continue;
    if (num(entry.products_seen) < t.min_products_seen) continue;
    if (num(entry.identity_match_rate) < t.min_identity_match_rate) continue;
    if (num(entry.major_anchor_conflict_count) > t.max_major_anchor_conflicts) continue;
    if (num(entry.fields_accepted_count) < t.min_fields_accepted) continue;
    if (num(entry.accepted_critical_fields_count) < t.min_critical_fields) continue;

    suggestions.push({
      rootDomain: entry.rootDomain || '',
      action: 'promote',
      products_seen: num(entry.products_seen),
      identity_match_rate: num(entry.identity_match_rate),
      major_anchor_conflict_count: num(entry.major_anchor_conflict_count),
      fields_accepted_count: num(entry.fields_accepted_count),
      accepted_critical_fields_count: num(entry.accepted_critical_fields_count),
      planner_score: num(entry.planner_score),
      http_ok_rate: num(entry.http_ok_rate),
      acceptance_yield: num(entry.acceptance_yield),
      field_reward_strength: num(entry.field_reward_strength)
    });
  }

  suggestions.sort((a, b) => b.planner_score - a.planner_score);

  return {
    thresholds: { ...t },
    suggestion_count: suggestions.length,
    suggestions
  };
}

/**
 * Generate demotion suggestions for domains that should be deny-listed.
 */
export function buildDemotionSuggestions({ domains = {}, thresholds = {} } = {}) {
  const t = { ...DEFAULT_DEMOTION_THRESHOLDS, ...thresholds };
  const suggestions = [];

  for (const entry of Object.values(domains)) {
    if (num(entry.attempts) < t.min_attempts) continue;

    const reasons = [];

    if (num(entry.identity_match_rate) < (t.max_identity_match_rate ?? 0.50)) {
      reasons.push(`low identity_match_rate: ${num(entry.identity_match_rate).toFixed(3)}`);
    }
    if (num(entry.http_ok_rate) < (t.max_http_ok_rate ?? 0.30)) {
      reasons.push(`low http_ok_rate: ${num(entry.http_ok_rate).toFixed(3)}`);
    }
    if (num(entry.major_anchor_conflict_rate) > (t.max_anchor_conflict_rate ?? 0.40)) {
      reasons.push(`high anchor_conflict_rate: ${num(entry.major_anchor_conflict_rate).toFixed(3)}`);
    }
    if (num(entry.field_reward_strength) < (t.min_negative_field_reward ?? -0.30)) {
      reasons.push(`negative field_reward_strength: ${num(entry.field_reward_strength).toFixed(3)}`);
    }

    if (reasons.length === 0) continue;

    suggestions.push({
      rootDomain: entry.rootDomain || '',
      action: 'demote',
      reasons,
      reason_count: reasons.length,
      attempts: num(entry.attempts),
      identity_match_rate: num(entry.identity_match_rate),
      http_ok_rate: num(entry.http_ok_rate),
      major_anchor_conflict_rate: num(entry.major_anchor_conflict_rate),
      field_reward_strength: num(entry.field_reward_strength),
      planner_score: num(entry.planner_score)
    });
  }

  suggestions.sort((a, b) => b.reason_count - a.reason_count || a.planner_score - b.planner_score);

  return {
    thresholds: { ...t },
    suggestion_count: suggestions.length,
    suggestions
  };
}

/**
 * Build a combined promotion + demotion report.
 */
export function buildSourceSuggestionReport({
  domains = {},
  promotionThresholds = {},
  demotionThresholds = {}
} = {}) {
  return {
    generated_at: new Date().toISOString(),
    total_domains: Object.keys(domains).length,
    promotions: buildPromotionSuggestions({ domains, thresholds: promotionThresholds }),
    demotions: buildDemotionSuggestions({ domains, thresholds: demotionThresholds })
  };
}
