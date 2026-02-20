import test from 'node:test';
import assert from 'node:assert/strict';
import { applyListUnionReducers } from '../src/scoring/listUnionReducer.js';

// ---------------------------------------------------------------------------
// item_union reducer tests
//
// Architecture (per Pass 1 agreement):
//   - Runs post-consensus in runProduct.js (NOT in consensusEngine.js)
//   - Reads list_rules.item_union (string enum) from field rules
//   - Merges list items from approved-domain candidates only
//   - Supported: 'set_union', 'ordered_union'
//   - Deferred:  'evidence_union' (treated as no-op)
//   - Default:   absent → no-op (winner-takes-all)
//   - list_rules enforcement (dedupe/sort/max) happens downstream in runtimeGate
// ---------------------------------------------------------------------------

function mockEngine(rules = {}) {
  return {
    getFieldRule(field) { return rules[field] || null; },
    getAllFieldKeys() { return Object.keys(rules); }
  };
}

function cand(value, opts = {}) {
  return {
    value: String(value),
    approvedDomain: opts.approvedDomain !== false,
    tier: opts.tier ?? 2,
    score: opts.score ?? 0.8,
    rootDomain: opts.rootDomain || `domain-${Math.random().toString(36).slice(2, 6)}.com`,
    method: opts.method || 'html_table'
  };
}

// =========================================================================
// SECTION 1: No-op scenarios
// =========================================================================

test('item_union: no engine → returns fields unchanged', () => {
  const fields = { colors: 'Black, White' };
  const result = applyListUnionReducers({
    fields,
    candidates: { colors: [cand('Black, White'), cand('Black, Red')] },
    fieldRulesEngine: null
  });
  assert.equal(result.fields.colors, 'Black, White');
  assert.equal(result.applied.length, 0);
});

test('item_union: no item_union in rule → field unchanged', () => {
  const engine = mockEngine({
    colors: {
      contract: {
        type: 'string',
        shape: 'list',
        list_rules: { dedupe: true, sort: 'none' }
      }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: { colors: [cand('Black, White'), cand('Black, Red')] },
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.colors, 'Black, White');
  assert.equal(result.applied.length, 0);
});

test('item_union: winner value is unk → skip', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'unk' },
    candidates: { colors: [cand('Black, Red')] },
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.colors, 'unk');
  assert.equal(result.applied.length, 0);
});

test('item_union: single candidate → no-op (nothing to merge)', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: { colors: [cand('Black, White', { rootDomain: 'a.com' })] },
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.colors, 'Black, White');
});

test('item_union: field not in candidates → skip', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: {},
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.colors, 'Black, White');
});

test('item_union: unknown policy string (evidence_union) → no-op', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'evidence_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: {
      colors: [
        cand('Black, White', { rootDomain: 'a.com' }),
        cand('Red', { rootDomain: 'b.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.colors, 'Black, White');
});

// =========================================================================
// SECTION 2: set_union
// =========================================================================

test('item_union set_union: merges unique items from approved candidates', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: {
      colors: [
        cand('Black, White', { tier: 1, score: 0.9, rootDomain: 'a.com' }),
        cand('Black, Red, Blue', { tier: 2, score: 0.8, rootDomain: 'b.com' }),
        cand('White, Green', { tier: 2, score: 0.7, rootDomain: 'c.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.colors.split(',').map((s) => s.trim());
  // Winner items first: Black, White
  assert.equal(items[0], 'Black');
  assert.equal(items[1], 'White');
  // Then unique items from additional approved candidates
  assert.ok(items.includes('Red'));
  assert.ok(items.includes('Blue'));
  assert.ok(items.includes('Green'));
  assert.equal(items.length, 5);
});

test('item_union set_union: non-approved candidates excluded from merge', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: {
      colors: [
        cand('Black, White', { rootDomain: 'a.com' }),
        cand('Black, Red', { approvedDomain: false, rootDomain: 'b.com' }),
        cand('White, Green', { rootDomain: 'c.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.colors.split(',').map((s) => s.trim());
  assert.ok(!items.includes('Red'), 'Red from non-approved candidate should be excluded');
  assert.ok(items.includes('Green'), 'Green from approved candidate should be included');
  assert.equal(items.length, 3);
});

test('item_union set_union: deduplicates case-insensitively', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: {
      colors: [
        cand('Black, White', { rootDomain: 'a.com' }),
        cand('black, white, Red', { rootDomain: 'b.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.colors.split(',').map((s) => s.trim());
  // "black" and "white" match case-insensitively → not added again
  assert.equal(items.length, 3);
  assert.equal(items[0], 'Black');
  assert.equal(items[1], 'White');
  assert.ok(items.some((i) => i.toLowerCase() === 'red'));
});

test('item_union set_union: all candidates have same items → no change', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black, White' },
    candidates: {
      colors: [
        cand('Black, White', { rootDomain: 'a.com' }),
        cand('Black, White', { rootDomain: 'b.com' }),
        cand('White, Black', { rootDomain: 'c.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.colors.split(',').map((s) => s.trim());
  assert.equal(items.length, 2);
  assert.equal(items[0], 'Black');
  assert.equal(items[1], 'White');
});

test('item_union set_union: candidates sorted by tier (asc) then score (desc)', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black' },
    candidates: {
      colors: [
        cand('Black', { tier: 2, score: 0.5, rootDomain: 'a.com' }),
        cand('Green', { tier: 3, score: 0.9, rootDomain: 'c.com' }),
        cand('Red', { tier: 1, score: 0.9, rootDomain: 'b.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.colors.split(',').map((s) => s.trim());
  // Winner: Black
  // Tier 1 candidate adds Red first (highest priority)
  // Then tier 2: (winner only, no new items)
  // Then tier 3: Green last
  assert.equal(items[0], 'Black');
  assert.equal(items[1], 'Red');
  assert.equal(items[2], 'Green');
});

// =========================================================================
// SECTION 3: ordered_union
// =========================================================================

test('item_union ordered_union: preserves candidate internal order', () => {
  const engine = mockEngine({
    features: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'ordered_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { features: 'USB-C, Bluetooth' },
    candidates: {
      features: [
        cand('USB-C, Bluetooth', { tier: 1, score: 0.9, rootDomain: 'a.com' }),
        cand('2.4GHz, USB-C, RGB', { tier: 2, score: 0.8, rootDomain: 'b.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.features.split(',').map((s) => s.trim());
  // Winner: USB-C, Bluetooth
  // Candidate 2 contributes: 2.4GHz, RGB (USB-C already present)
  // Internal order preserved: 2.4GHz before RGB
  assert.equal(items[0], 'USB-C');
  assert.equal(items[1], 'Bluetooth');
  const idx24 = items.indexOf('2.4GHz');
  const idxRGB = items.indexOf('RGB');
  assert.ok(idx24 >= 0, '2.4GHz should be present');
  assert.ok(idxRGB >= 0, 'RGB should be present');
  assert.ok(idx24 < idxRGB, '2.4GHz should come before RGB (candidate internal order)');
});

test('item_union ordered_union: multiple candidates ranked by tier/score', () => {
  const engine = mockEngine({
    features: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'ordered_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { features: 'A' },
    candidates: {
      features: [
        cand('A', { tier: 2, score: 0.5, rootDomain: 'a.com' }),
        cand('C, D', { tier: 2, score: 0.7, rootDomain: 'c.com' }),
        cand('B', { tier: 1, score: 0.9, rootDomain: 'b.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.features.split(',').map((s) => s.trim());
  // Winner: A
  // Tier 1 candidate (B, score 0.9): add B
  // Tier 2 candidate (C, D, score 0.7): add C, D
  // Tier 2 candidate (A, score 0.5): already present
  assert.equal(items[0], 'A');
  assert.equal(items[1], 'B');
  assert.ok(items.includes('C'));
  assert.ok(items.includes('D'));
  assert.equal(items.length, 4);
});

// =========================================================================
// SECTION 4: Numeric lists + tracking
// =========================================================================

test('item_union set_union: numeric list values', () => {
  const engine = mockEngine({
    dpi_levels: {
      contract: { type: 'number', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { dpi_levels: '800, 1600' },
    candidates: {
      dpi_levels: [
        cand('800, 1600', { rootDomain: 'a.com' }),
        cand('800, 3200, 6400', { rootDomain: 'b.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  const items = result.fields.dpi_levels.split(',').map((s) => s.trim());
  assert.ok(items.includes('800'));
  assert.ok(items.includes('1600'));
  assert.ok(items.includes('3200'));
  assert.ok(items.includes('6400'));
  assert.equal(items.length, 4);
});

test('item_union: applied array tracks merge details', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black' },
    candidates: {
      colors: [
        cand('Black', { rootDomain: 'a.com' }),
        cand('Red', { rootDomain: 'b.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  assert.ok(result.applied.length > 0);
  const entry = result.applied.find((a) => a.field === 'colors');
  assert.ok(entry, 'applied should contain an entry for the merged field');
  assert.equal(entry.policy, 'set_union');
  assert.ok(entry.added_count >= 1, 'should track how many items were added');
});

test('item_union: multiple fields processed independently', () => {
  const engine = mockEngine({
    colors: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'set_union' } }
    },
    features: {
      contract: { type: 'string', shape: 'list', list_rules: { item_union: 'ordered_union' } }
    },
    weight: {
      contract: { type: 'number', shape: 'scalar' }
    }
  });
  const result = applyListUnionReducers({
    fields: { colors: 'Black', features: 'USB-C', weight: '80' },
    candidates: {
      colors: [
        cand('Black', { rootDomain: 'a.com' }),
        cand('Red', { rootDomain: 'b.com' })
      ],
      features: [
        cand('USB-C', { rootDomain: 'a.com' }),
        cand('Bluetooth', { rootDomain: 'c.com' })
      ],
      weight: [
        cand('80', { rootDomain: 'a.com' })
      ]
    },
    fieldRulesEngine: engine
  });
  // colors: set_union → Black, Red
  const colorItems = result.fields.colors.split(',').map((s) => s.trim());
  assert.ok(colorItems.includes('Red'));
  // features: ordered_union → USB-C, Bluetooth
  const featureItems = result.fields.features.split(',').map((s) => s.trim());
  assert.ok(featureItems.includes('Bluetooth'));
  // weight: no item_union → unchanged
  assert.equal(result.fields.weight, '80');
});
