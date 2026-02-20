import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIdentityToken,
  ambiguityLevelFromFamilyCount,
  normalizeAmbiguityLevel,
  resolveIdentityLockStatus
} from '../src/utils/identityNormalize.js';

describe('normalizeIdentityToken', () => {
  it('lowercases and trims whitespace', () => {
    assert.equal(normalizeIdentityToken('  Razer  '), 'razer');
  });

  it('collapses multiple spaces', () => {
    assert.equal(normalizeIdentityToken('Viper   V3   Pro'), 'viper v3 pro');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(normalizeIdentityToken(null), '');
    assert.equal(normalizeIdentityToken(undefined), '');
    assert.equal(normalizeIdentityToken(''), '');
  });

  it('coerces numbers to string', () => {
    assert.equal(normalizeIdentityToken(42), '42');
  });
});

describe('ambiguityLevelFromFamilyCount', () => {
  it('returns unknown for 0', () => {
    assert.equal(ambiguityLevelFromFamilyCount(0), 'unknown');
  });

  it('returns easy for 1', () => {
    assert.equal(ambiguityLevelFromFamilyCount(1), 'easy');
  });

  it('returns medium for 2-3', () => {
    assert.equal(ambiguityLevelFromFamilyCount(2), 'medium');
    assert.equal(ambiguityLevelFromFamilyCount(3), 'medium');
  });

  it('returns hard for 4-5', () => {
    assert.equal(ambiguityLevelFromFamilyCount(4), 'hard');
    assert.equal(ambiguityLevelFromFamilyCount(5), 'hard');
  });

  it('returns very_hard for 6-8', () => {
    assert.equal(ambiguityLevelFromFamilyCount(6), 'very_hard');
    assert.equal(ambiguityLevelFromFamilyCount(8), 'very_hard');
  });

  it('returns extra_hard for 9+', () => {
    assert.equal(ambiguityLevelFromFamilyCount(9), 'extra_hard');
    assert.equal(ambiguityLevelFromFamilyCount(100), 'extra_hard');
  });

  it('handles string input', () => {
    assert.equal(ambiguityLevelFromFamilyCount('4'), 'hard');
  });

  it('handles null/undefined with unknown', () => {
    assert.equal(ambiguityLevelFromFamilyCount(null), 'unknown');
    assert.equal(ambiguityLevelFromFamilyCount(undefined), 'unknown');
  });

  it('handles negative numbers as unknown', () => {
    assert.equal(ambiguityLevelFromFamilyCount(-1), 'unknown');
  });
});

describe('normalizeAmbiguityLevel', () => {
  it('normalizes easy and its aliases', () => {
    assert.equal(normalizeAmbiguityLevel('easy'), 'easy');
    assert.equal(normalizeAmbiguityLevel('low'), 'easy');
    assert.equal(normalizeAmbiguityLevel('EASY'), 'easy');
  });

  it('normalizes medium and its aliases', () => {
    assert.equal(normalizeAmbiguityLevel('medium'), 'medium');
    assert.equal(normalizeAmbiguityLevel('mid'), 'medium');
  });

  it('normalizes hard and its aliases', () => {
    assert.equal(normalizeAmbiguityLevel('hard'), 'hard');
    assert.equal(normalizeAmbiguityLevel('high'), 'hard');
  });

  it('normalizes very_hard and its aliases', () => {
    assert.equal(normalizeAmbiguityLevel('very_hard'), 'very_hard');
    assert.equal(normalizeAmbiguityLevel('very-hard'), 'very_hard');
    assert.equal(normalizeAmbiguityLevel('very hard'), 'very_hard');
  });

  it('normalizes extra_hard and its aliases', () => {
    assert.equal(normalizeAmbiguityLevel('extra_hard'), 'extra_hard');
    assert.equal(normalizeAmbiguityLevel('extra-hard'), 'extra_hard');
    assert.equal(normalizeAmbiguityLevel('extra hard'), 'extra_hard');
  });

  it('falls back to count-based level when string is empty', () => {
    assert.equal(normalizeAmbiguityLevel('', 4), 'hard');
    assert.equal(normalizeAmbiguityLevel('', 1), 'easy');
  });

  it('falls back to count-based level when string is unrecognized', () => {
    assert.equal(normalizeAmbiguityLevel('garbage', 6), 'very_hard');
  });

  it('returns unknown when both string and count give nothing', () => {
    assert.equal(normalizeAmbiguityLevel('', 0), 'unknown');
    assert.equal(normalizeAmbiguityLevel(null, 0), 'unknown');
    assert.equal(normalizeAmbiguityLevel(undefined), 'unknown');
  });

  it('string match takes priority over count', () => {
    assert.equal(normalizeAmbiguityLevel('easy', 9), 'easy');
  });
});

describe('resolveIdentityLockStatus', () => {
  it('returns locked_full with brand + model + variant', () => {
    assert.equal(
      resolveIdentityLockStatus({ brand: 'Razer', model: 'Viper V3 Pro', variant: 'Wireless' }),
      'locked_full'
    );
  });

  it('returns locked_full with brand + model + sku', () => {
    assert.equal(
      resolveIdentityLockStatus({ brand: 'Razer', model: 'Viper V3 Pro', sku: 'RZ01-123' }),
      'locked_full'
    );
  });

  it('returns locked_brand_model with brand + model only', () => {
    assert.equal(
      resolveIdentityLockStatus({ brand: 'Razer', model: 'Viper V3 Pro' }),
      'locked_brand_model'
    );
  });

  it('returns locked_partial with only brand', () => {
    assert.equal(
      resolveIdentityLockStatus({ brand: 'Razer' }),
      'locked_partial'
    );
  });

  it('returns unlocked for empty object', () => {
    assert.equal(resolveIdentityLockStatus({}), 'unlocked');
  });

  it('returns unlocked for undefined', () => {
    assert.equal(resolveIdentityLockStatus(), 'unlocked');
  });

  it('ignores whitespace-only values', () => {
    assert.equal(
      resolveIdentityLockStatus({ brand: '  ', model: '' }),
      'unlocked'
    );
  });
});
