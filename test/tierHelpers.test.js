import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTierNumber,
  parseTierPreferenceFromRule,
  parseTierPreferenceFromNeedRow
} from '../src/utils/tierHelpers.js';

describe('toTierNumber', () => {
  it('returns null for null/undefined/empty', () => {
    assert.equal(toTierNumber(null), null);
    assert.equal(toTierNumber(undefined), null);
    assert.equal(toTierNumber(''), null);
  });

  it('passes through numeric values', () => {
    assert.equal(toTierNumber(1), 1);
    assert.equal(toTierNumber(2), 2);
    assert.equal(toTierNumber(3), 3);
    assert.equal(toTierNumber(4), 4);
  });

  it('parses numeric strings', () => {
    assert.equal(toTierNumber('1'), 1);
    assert.equal(toTierNumber('3'), 3);
  });

  it('parses tier N patterns', () => {
    assert.equal(toTierNumber('tier 1'), 1);
    assert.equal(toTierNumber('Tier 2'), 2);
    assert.equal(toTierNumber('tier3'), 3);
  });

  it('maps keyword manufacturer to tier 1', () => {
    assert.equal(toTierNumber('manufacturer'), 1);
  });

  it('maps keyword lab/review to tier 2', () => {
    assert.equal(toTierNumber('lab'), 2);
    assert.equal(toTierNumber('review'), 2);
    assert.equal(toTierNumber('lab review'), 2);
  });

  it('maps keyword retailer to tier 3', () => {
    assert.equal(toTierNumber('retailer'), 3);
  });

  it('maps keyword store to tier 3', () => {
    assert.equal(toTierNumber('store'), 3);
  });

  it('maps keyword database/community/aggregator to tier 4', () => {
    assert.equal(toTierNumber('database'), 4);
    assert.equal(toTierNumber('community'), 4);
    assert.equal(toTierNumber('aggregator'), 4);
  });

  it('returns null for nonsense', () => {
    assert.equal(toTierNumber('nonsense'), null);
    assert.equal(toTierNumber('banana'), null);
  });

  it('floors fractional numbers', () => {
    assert.equal(toTierNumber(2.7), 2);
  });
});

describe('parseTierPreferenceFromRule', () => {
  it('returns empty array for empty/null rule', () => {
    assert.deepEqual(parseTierPreferenceFromRule(), []);
    assert.deepEqual(parseTierPreferenceFromRule(null), []);
    assert.deepEqual(parseTierPreferenceFromRule({}), []);
  });

  it('parses numeric tier_preference from rule evidence', () => {
    const rule = { evidence: { tier_preference: [1, 2] } };
    assert.deepEqual(parseTierPreferenceFromRule(rule), [1, 2]);
  });

  it('deduplicates tiers', () => {
    const rule = { evidence: { tier_preference: [1, 2, 1, 2] } };
    assert.deepEqual(parseTierPreferenceFromRule(rule), [1, 2]);
  });

  it('parses string tier values', () => {
    const rule = { evidence: { tier_preference: ['manufacturer', 'lab'] } };
    assert.deepEqual(parseTierPreferenceFromRule(rule), [1, 2]);
  });

  it('filters invalid tier values', () => {
    const rule = { evidence: { tier_preference: [1, 'nonsense', 2] } };
    assert.deepEqual(parseTierPreferenceFromRule(rule), [1, 2]);
  });
});

describe('parseTierPreferenceFromNeedRow', () => {
  it('returns needRow tier_preference when available', () => {
    const needRow = { tier_preference: [1, 3] };
    assert.deepEqual(parseTierPreferenceFromNeedRow(needRow, {}), [1, 3]);
  });

  it('falls back to rule tier_preference when needRow is empty', () => {
    const rule = { evidence: { tier_preference: [2, 3] } };
    assert.deepEqual(parseTierPreferenceFromNeedRow({}, rule), [2, 3]);
  });

  it('returns default [1,2,3] when both empty', () => {
    assert.deepEqual(parseTierPreferenceFromNeedRow({}, {}), [1, 2, 3]);
  });

  it('needRow wins over rule when both present', () => {
    const needRow = { tier_preference: [1] };
    const rule = { evidence: { tier_preference: [2, 3] } };
    assert.deepEqual(parseTierPreferenceFromNeedRow(needRow, rule), [1]);
  });

  it('handles null/undefined inputs', () => {
    assert.deepEqual(parseTierPreferenceFromNeedRow(null, null), [1, 2, 3]);
    assert.deepEqual(parseTierPreferenceFromNeedRow(undefined, undefined), [1, 2, 3]);
  });
});
