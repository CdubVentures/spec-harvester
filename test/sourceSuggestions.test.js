import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPromotionSuggestions,
  buildDemotionSuggestions,
  buildSourceSuggestionReport
} from '../src/intel/sourceSuggestions.js';

// ---------------------------------------------------------------------------
// IP04-4B — Promotion / Demotion Suggestions Tests
// ---------------------------------------------------------------------------

const GOOD_DOMAIN = {
  rootDomain: 'rtings.com',
  approved_attempts: 0,
  candidate_attempts: 30,
  attempts: 30,
  products_seen: 25,
  identity_match_rate: 0.99,
  major_anchor_conflict_count: 0,
  major_anchor_conflict_rate: 0.0,
  fields_accepted_count: 18,
  accepted_critical_fields_count: 3,
  planner_score: 0.88,
  http_ok_rate: 0.97,
  acceptance_yield: 0.45,
  field_reward_strength: 0.72
};

const BAD_DOMAIN = {
  rootDomain: 'sketchy-site.com',
  approved_attempts: 0,
  candidate_attempts: 15,
  attempts: 15,
  products_seen: 10,
  identity_match_rate: 0.35,
  major_anchor_conflict_count: 8,
  major_anchor_conflict_rate: 0.53,
  fields_accepted_count: 0,
  accepted_critical_fields_count: 0,
  planner_score: 0.12,
  http_ok_rate: 0.40,
  acceptance_yield: 0.0,
  field_reward_strength: -0.5
};

const DEAD_DOMAIN = {
  rootDomain: 'defunct-store.com',
  approved_attempts: 0,
  candidate_attempts: 12,
  attempts: 12,
  products_seen: 8,
  identity_match_rate: 0.0,
  major_anchor_conflict_count: 0,
  major_anchor_conflict_rate: 0.0,
  fields_accepted_count: 0,
  accepted_critical_fields_count: 0,
  planner_score: 0.05,
  http_ok_rate: 0.08,
  acceptance_yield: 0.0,
  field_reward_strength: 0.0
};

const MEDIOCRE_DOMAIN = {
  rootDomain: 'average-review.com',
  approved_attempts: 0,
  candidate_attempts: 10,
  attempts: 10,
  products_seen: 8,
  identity_match_rate: 0.80,
  major_anchor_conflict_count: 1,
  major_anchor_conflict_rate: 0.1,
  fields_accepted_count: 3,
  accepted_critical_fields_count: 0,
  planner_score: 0.55,
  http_ok_rate: 0.90,
  acceptance_yield: 0.15,
  field_reward_strength: 0.20
};

const ALREADY_APPROVED = {
  rootDomain: 'official-mfg.com',
  approved_attempts: 50,
  candidate_attempts: 0,
  attempts: 50,
  products_seen: 40,
  identity_match_rate: 0.99,
  major_anchor_conflict_count: 0,
  major_anchor_conflict_rate: 0.0,
  fields_accepted_count: 100,
  accepted_critical_fields_count: 20,
  planner_score: 0.95,
  http_ok_rate: 0.99,
  acceptance_yield: 0.60,
  field_reward_strength: 0.90
};

function makeDomains(...entries) {
  const result = {};
  for (const entry of entries) {
    result[entry.rootDomain] = entry;
  }
  return result;
}

// --- Promotion suggestions ---

test('promotion: identifies domains that meet all promotion thresholds', () => {
  const result = buildPromotionSuggestions({
    domains: makeDomains(GOOD_DOMAIN, MEDIOCRE_DOMAIN)
  });
  assert.equal(result.suggestion_count, 1);
  assert.equal(result.suggestions[0].rootDomain, 'rtings.com');
  assert.equal(result.suggestions[0].action, 'promote');
});

test('promotion: excludes already-approved domains', () => {
  const result = buildPromotionSuggestions({
    domains: makeDomains(ALREADY_APPROVED)
  });
  assert.equal(result.suggestion_count, 0);
});

test('promotion: excludes domains below minimum products_seen', () => {
  const lowSeen = { ...GOOD_DOMAIN, rootDomain: 'low.com', products_seen: 5 };
  const result = buildPromotionSuggestions({
    domains: makeDomains(lowSeen)
  });
  assert.equal(result.suggestion_count, 0);
});

test('promotion: excludes domains with anchor conflicts', () => {
  const conflicted = { ...GOOD_DOMAIN, rootDomain: 'conflict.com', major_anchor_conflict_count: 3 };
  const result = buildPromotionSuggestions({
    domains: makeDomains(conflicted)
  });
  assert.equal(result.suggestion_count, 0);
});

test('promotion: custom thresholds override defaults', () => {
  const result = buildPromotionSuggestions({
    domains: makeDomains(MEDIOCRE_DOMAIN),
    thresholds: {
      min_products_seen: 5,
      min_identity_match_rate: 0.70,
      max_major_anchor_conflicts: 2,
      min_fields_accepted: 2,
      min_critical_fields: 0
    }
  });
  assert.equal(result.suggestion_count, 1);
  assert.equal(result.suggestions[0].rootDomain, 'average-review.com');
});

test('promotion: sorted by planner_score descending', () => {
  const good2 = { ...GOOD_DOMAIN, rootDomain: 'better.com', planner_score: 0.95 };
  const result = buildPromotionSuggestions({
    domains: makeDomains(GOOD_DOMAIN, good2)
  });
  assert.equal(result.suggestions[0].rootDomain, 'better.com');
  assert.equal(result.suggestions[1].rootDomain, 'rtings.com');
});

// --- Demotion suggestions ---

test('demotion: flags domains with very low identity match rate', () => {
  const result = buildDemotionSuggestions({
    domains: makeDomains(BAD_DOMAIN)
  });
  assert.ok(result.suggestions.some((s) => s.rootDomain === 'sketchy-site.com'));
  const item = result.suggestions.find((s) => s.rootDomain === 'sketchy-site.com');
  assert.equal(item.action, 'demote');
  assert.ok(item.reasons.length > 0);
});

test('demotion: flags domains with persistent HTTP failures', () => {
  const result = buildDemotionSuggestions({
    domains: makeDomains(DEAD_DOMAIN)
  });
  assert.ok(result.suggestions.some((s) => s.rootDomain === 'defunct-store.com'));
  const item = result.suggestions.find((s) => s.rootDomain === 'defunct-store.com');
  assert.ok(item.reasons.some((r) => r.includes('http_ok_rate')));
});

test('demotion: flags domains with high conflict rate', () => {
  const result = buildDemotionSuggestions({
    domains: makeDomains(BAD_DOMAIN)
  });
  const item = result.suggestions.find((s) => s.rootDomain === 'sketchy-site.com');
  assert.ok(item.reasons.some((r) => r.includes('anchor_conflict')));
});

test('demotion: does not flag healthy domains', () => {
  const result = buildDemotionSuggestions({
    domains: makeDomains(GOOD_DOMAIN, MEDIOCRE_DOMAIN)
  });
  assert.equal(result.suggestion_count, 0);
});

test('demotion: requires minimum attempts before suggesting', () => {
  const tooFew = { ...BAD_DOMAIN, rootDomain: 'new.com', attempts: 2 };
  const result = buildDemotionSuggestions({
    domains: makeDomains(tooFew)
  });
  assert.equal(result.suggestion_count, 0);
});

test('demotion: custom thresholds override defaults', () => {
  const result = buildDemotionSuggestions({
    domains: makeDomains(MEDIOCRE_DOMAIN),
    thresholds: {
      max_identity_match_rate: 0.85,
      min_attempts: 5
    }
  });
  assert.equal(result.suggestion_count, 1);
});

// --- Combined report ---

test('report: generates combined promotion + demotion report', () => {
  const report = buildSourceSuggestionReport({
    domains: makeDomains(GOOD_DOMAIN, BAD_DOMAIN, DEAD_DOMAIN, MEDIOCRE_DOMAIN, ALREADY_APPROVED)
  });
  assert.ok(report.generated_at);
  assert.ok(report.promotions.suggestion_count >= 1);
  assert.ok(report.demotions.suggestion_count >= 1);
  assert.equal(report.total_domains, 5);
});

test('report: handles empty domains', () => {
  const report = buildSourceSuggestionReport({ domains: {} });
  assert.equal(report.total_domains, 0);
  assert.equal(report.promotions.suggestion_count, 0);
  assert.equal(report.demotions.suggestion_count, 0);
});

test('report: includes threshold metadata', () => {
  const report = buildSourceSuggestionReport({
    domains: makeDomains(GOOD_DOMAIN)
  });
  assert.ok(report.promotions.thresholds);
  assert.ok(report.demotions.thresholds);
});
