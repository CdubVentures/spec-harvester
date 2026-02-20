import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArticleExtractorPolicyMap,
  resolveArticleExtractionPolicy
} from '../src/extract/articleExtractorPolicy.js';

test('article extractor policy: normalizes host map and aliases', () => {
  const map = normalizeArticleExtractorPolicyMap({
    'https://www.RTINGS.com/path': {
      mode: 'readability',
      enabled: 'true',
      min_chars: 550,
      min_score: 30,
      max_chars: 22000
    }
  });

  assert.equal(Boolean(map['rtings.com']), true);
  assert.equal(map['rtings.com'].mode, 'prefer_readability');
  assert.equal(map['rtings.com'].enabled, true);
  assert.equal(map['rtings.com'].minChars, 550);
  assert.equal(map['rtings.com'].minScore, 30);
  assert.equal(map['rtings.com'].maxChars, 22000);
});

test('article extractor policy: resolves subdomain match and applies overrides', () => {
  const policy = resolveArticleExtractionPolicy({
    articleExtractorV2Enabled: true,
    articleExtractorMinChars: 700,
    articleExtractorMinScore: 45,
    articleExtractorMaxChars: 24000,
    articleExtractorDomainPolicyMap: {
      'rtings.com': {
        mode: 'prefer_fallback',
        enabled: true,
        minChars: 420,
        minScore: 20,
        maxChars: 18000
      }
    }
  }, {
    url: 'https://www.rtings.com/monitor/reviews/example'
  });

  assert.equal(policy.overrideApplied, true);
  assert.equal(policy.matchedHost, 'rtings.com');
  assert.equal(policy.mode, 'prefer_fallback');
  assert.equal(policy.enabled, true);
  assert.equal(policy.minChars, 420);
  assert.equal(policy.minScore, 20);
  assert.equal(policy.maxChars, 18000);
});

