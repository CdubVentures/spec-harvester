import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNewKey,
  applyAddKey,
  applyDeleteKey,
  applyRenameKey,
  rewriteConstraints,
  reorderKey,
  reorderGroup,
  deriveGroups,
} from '../src/studio/keyOperations.js';

const baseRules = () => ({
  sensor: {
    label: 'Sensor',
    group: 'core',
    constraints: ['sensor requires sensor_brand'],
  },
  sensor_brand: {
    label: 'Sensor Brand',
    group: 'core',
    constraints: [],
  },
  dpi_max: {
    label: 'Max DPI',
    group: 'performance',
    constraints: ['dpi_max >= 100'],
  },
  weight: {
    label: 'Weight',
    group: 'physical',
    constraints: ['weight <= 200'],
  },
});

const baseOrder = () => ['sensor', 'sensor_brand', 'dpi_max', 'weight'];

describe('validateNewKey', () => {
  it('rejects empty string', () => {
    const err = validateNewKey('', []);
    assert.ok(err !== null);
  });

  it('rejects whitespace-only string', () => {
    const err = validateNewKey('   ', []);
    assert.ok(err !== null);
  });

  it('rejects keys with spaces', () => {
    const err = validateNewKey('my key', []);
    assert.ok(err !== null);
  });

  it('rejects keys with uppercase letters', () => {
    const err = validateNewKey('MyKey', []);
    assert.ok(err !== null);
  });

  it('rejects keys starting with number', () => {
    const err = validateNewKey('3dpi', []);
    assert.ok(err !== null);
  });

  it('rejects keys starting with underscore', () => {
    const err = validateNewKey('_hidden', []);
    assert.ok(err !== null);
  });

  it('rejects keys starting with __', () => {
    const err = validateNewKey('__name', []);
    assert.ok(err !== null);
  });

  it('rejects keys with special characters', () => {
    const err = validateNewKey('dpi-max', []);
    assert.ok(err !== null);
  });

  it('rejects keys with dots', () => {
    const err = validateNewKey('dpi.max', []);
    assert.ok(err !== null);
  });

  it('rejects duplicate keys (exact match)', () => {
    const err = validateNewKey('sensor', ['sensor', 'weight']);
    assert.ok(err !== null);
  });

  it('rejects duplicate keys (case-insensitive)', () => {
    const err = validateNewKey('sensor', ['Sensor', 'weight']);
    assert.ok(err !== null);
  });

  it('rejects keys longer than 64 characters', () => {
    const longKey = 'a'.repeat(65);
    const err = validateNewKey(longKey, []);
    assert.ok(err !== null);
  });

  it('accepts valid key', () => {
    const err = validateNewKey('polling_rate', []);
    assert.equal(err, null);
  });

  it('accepts key with numbers after first letter', () => {
    const err = validateNewKey('usb2_port', []);
    assert.equal(err, null);
  });

  it('accepts key at max length (64)', () => {
    const key = 'a'.repeat(64);
    const err = validateNewKey(key, []);
    assert.equal(err, null);
  });
});

describe('applyAddKey', () => {
  it('adds key at end when no afterKey specified', () => {
    const result = applyAddKey(baseOrder(), baseRules(), 'polling_rate');
    assert.deepStrictEqual(result.fieldOrder, [
      'sensor', 'sensor_brand', 'dpi_max', 'weight', 'polling_rate',
    ]);
    assert.ok('polling_rate' in result.rules);
  });

  it('adds key after specified key', () => {
    const result = applyAddKey(baseOrder(), baseRules(), 'polling_rate', { afterKey: 'sensor_brand' });
    assert.deepStrictEqual(result.fieldOrder, [
      'sensor', 'sensor_brand', 'polling_rate', 'dpi_max', 'weight',
    ]);
  });

  it('creates default rule skeleton with group', () => {
    const result = applyAddKey(baseOrder(), baseRules(), 'polling_rate', { group: 'performance' });
    const rule = result.rules.polling_rate;
    assert.equal(rule.group, 'performance');
    assert.ok('label' in rule);
    assert.ok('constraints' in rule);
    assert.deepStrictEqual(rule.constraints, []);
  });

  it('does not mutate original objects', () => {
    const order = baseOrder();
    const rules = baseRules();
    applyAddKey(order, rules, 'polling_rate');
    assert.equal(order.length, 4);
    assert.ok(!('polling_rate' in rules));
  });

  it('humanizes label from key', () => {
    const result = applyAddKey([], {}, 'max_polling_rate');
    assert.equal(result.rules.max_polling_rate.label, 'Max Polling Rate');
  });
});

describe('applyDeleteKey', () => {
  it('removes key from fieldOrder', () => {
    const result = applyDeleteKey(baseOrder(), baseRules(), 'dpi_max');
    assert.ok(!result.fieldOrder.includes('dpi_max'));
    assert.equal(result.fieldOrder.length, 3);
  });

  it('removes key from rules', () => {
    const result = applyDeleteKey(baseOrder(), baseRules(), 'dpi_max');
    assert.ok(!('dpi_max' in result.rules));
  });

  it('removes constraints referencing deleted key from other rules', () => {
    const result = applyDeleteKey(baseOrder(), baseRules(), 'sensor_brand');
    const sensorConstraints = result.rules.sensor.constraints;
    assert.equal(sensorConstraints.length, 0);
  });

  it('does not remove unrelated constraints', () => {
    const result = applyDeleteKey(baseOrder(), baseRules(), 'sensor_brand');
    assert.deepStrictEqual(result.rules.dpi_max.constraints, ['dpi_max >= 100']);
    assert.deepStrictEqual(result.rules.weight.constraints, ['weight <= 200']);
  });

  it('does not mutate original objects', () => {
    const order = baseOrder();
    const rules = baseRules();
    applyDeleteKey(order, rules, 'dpi_max');
    assert.equal(order.length, 4);
    assert.ok('dpi_max' in rules);
  });
});

describe('applyRenameKey', () => {
  it('renames key in fieldOrder', () => {
    const result = applyRenameKey(baseOrder(), baseRules(), 'dpi_max', 'max_dpi');
    assert.ok(result.fieldOrder.includes('max_dpi'));
    assert.ok(!result.fieldOrder.includes('dpi_max'));
    assert.equal(result.fieldOrder.indexOf('max_dpi'), 2);
  });

  it('moves rule to new key', () => {
    const result = applyRenameKey(baseOrder(), baseRules(), 'dpi_max', 'max_dpi');
    assert.ok('max_dpi' in result.rules);
    assert.ok(!('dpi_max' in result.rules));
    assert.equal(result.rules.max_dpi.label, 'Max DPI');
  });

  it('rewrites constraints referencing renamed key (left side)', () => {
    const result = applyRenameKey(baseOrder(), baseRules(), 'dpi_max', 'max_dpi');
    assert.deepStrictEqual(result.rules.max_dpi.constraints, ['max_dpi >= 100']);
  });

  it('rewrites constraints referencing renamed key (right side of requires)', () => {
    const result = applyRenameKey(baseOrder(), baseRules(), 'sensor_brand', 'brand');
    assert.deepStrictEqual(result.rules.sensor.constraints, ['sensor requires brand']);
  });

  it('rewrites constraints referencing renamed key on right side of comparison', () => {
    const rules = baseRules();
    rules.weight.constraints = ['weight <= dpi_max'];
    const result = applyRenameKey(baseOrder(), rules, 'dpi_max', 'max_dpi');
    assert.deepStrictEqual(result.rules.weight.constraints, ['weight <= max_dpi']);
  });

  it('returns rename pair', () => {
    const result = applyRenameKey(baseOrder(), baseRules(), 'dpi_max', 'max_dpi');
    assert.deepStrictEqual(result.rename, ['dpi_max', 'max_dpi']);
  });

  it('does not mutate original objects', () => {
    const order = baseOrder();
    const rules = baseRules();
    applyRenameKey(order, rules, 'dpi_max', 'max_dpi');
    assert.ok(order.includes('dpi_max'));
    assert.ok('dpi_max' in rules);
  });

  it('updates label when label matched old key', () => {
    const rules = baseRules();
    rules.sensor.label = 'sensor';
    const result = applyRenameKey(baseOrder(), rules, 'sensor', 'optical_sensor');
    assert.equal(result.rules.optical_sensor.label, 'Optical Sensor');
  });
});

describe('rewriteConstraints', () => {
  it('rewrites left side of comparison', () => {
    const result = rewriteConstraints(['old_key >= 100'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['new_key >= 100']);
  });

  it('rewrites right side of comparison', () => {
    const result = rewriteConstraints(['weight <= old_key'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['weight <= new_key']);
  });

  it('rewrites left side of requires', () => {
    const result = rewriteConstraints(['old_key requires sensor'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['new_key requires sensor']);
  });

  it('rewrites right side of requires', () => {
    const result = rewriteConstraints(['sensor requires old_key'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['sensor requires new_key']);
  });

  it('rewrites both sides if both match', () => {
    const result = rewriteConstraints(['old_key >= old_key'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['new_key >= new_key']);
  });

  it('does not rewrite unrelated constraints', () => {
    const result = rewriteConstraints(['weight <= 200'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['weight <= 200']);
  });

  it('handles multiple constraints', () => {
    const result = rewriteConstraints(
      ['old_key >= 100', 'weight <= old_key', 'sensor requires color'],
      'old_key',
      'new_key',
    );
    assert.deepStrictEqual(result, [
      'new_key >= 100',
      'weight <= new_key',
      'sensor requires color',
    ]);
  });

  it('handles empty constraints array', () => {
    const result = rewriteConstraints([], 'old_key', 'new_key');
    assert.deepStrictEqual(result, []);
  });

  it('handles undefined/null constraints gracefully', () => {
    const result = rewriteConstraints(undefined, 'old_key', 'new_key');
    assert.deepStrictEqual(result, []);
  });

  it('does not partially match key names', () => {
    const result = rewriteConstraints(['old_key_extra >= 100'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['old_key_extra >= 100']);
  });

  it('preserves == operator', () => {
    const result = rewriteConstraints(['old_key == 50'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['new_key == 50']);
  });

  it('preserves != operator', () => {
    const result = rewriteConstraints(['old_key != unk'], 'old_key', 'new_key');
    assert.deepStrictEqual(result, ['new_key != unk']);
  });
});

describe('deriveGroups', () => {
  it('returns groups in insertion order from fieldOrder', () => {
    const result = deriveGroups(baseOrder(), baseRules());
    assert.deepStrictEqual(result.map(([g]) => g), ['core', 'performance', 'physical']);
  });

  it('returns groups in field-order insertion order (not alphabetical)', () => {
    const order = ['weight', 'dpi_max', 'sensor', 'sensor_brand'];
    const result = deriveGroups(order, baseRules());
    assert.deepStrictEqual(result.map(([g]) => g), ['physical', 'performance', 'core']);
  });

  it('assigns keys to their group in order', () => {
    const result = deriveGroups(baseOrder(), baseRules());
    const coreGroup = result.find(([g]) => g === 'core');
    assert.deepStrictEqual(coreGroup[1], ['sensor', 'sensor_brand']);
  });

  it('defaults unknown group to ungrouped', () => {
    const rules = { ...baseRules(), polling_rate: { label: 'Polling Rate' } };
    const order = [...baseOrder(), 'polling_rate'];
    const result = deriveGroups(order, rules);
    const ug = result.find(([g]) => g === 'ungrouped');
    assert.ok(ug);
    assert.deepStrictEqual(ug[1], ['polling_rate']);
  });

  it('handles empty fieldOrder', () => {
    const result = deriveGroups([], baseRules());
    assert.deepStrictEqual(result, []);
  });

  it('skips keys not in ruleMap', () => {
    const result = deriveGroups(['sensor', 'nonexistent'], baseRules());
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], ['core', ['sensor']]);
  });

  it('reads ui.group in preference to flat group', () => {
    const rules = { sensor: { label: 'Sensor', group: 'flat_group', ui: { group: 'ui_group' } } };
    const result = deriveGroups(['sensor'], rules);
    assert.deepStrictEqual(result[0][0], 'ui_group');
  });
});

describe('reorderKey', () => {
  it('moves key within the same group', () => {
    const result = reorderKey(baseOrder(), baseRules(), 'sensor', 'sensor_brand');
    assert.deepStrictEqual(result, ['sensor_brand', 'sensor', 'dpi_max', 'weight']);
  });

  it('moves key from one group after key in another group', () => {
    const result = reorderKey(baseOrder(), baseRules(), 'weight', 'sensor');
    assert.deepStrictEqual(result, ['sensor', 'weight', 'sensor_brand', 'dpi_max']);
  });

  it('returns same order when active equals over', () => {
    const order = baseOrder();
    const result = reorderKey(order, baseRules(), 'sensor', 'sensor');
    assert.deepStrictEqual(result, order);
  });

  it('does not mutate original array', () => {
    const order = baseOrder();
    reorderKey(order, baseRules(), 'sensor', 'sensor_brand');
    assert.deepStrictEqual(order, ['sensor', 'sensor_brand', 'dpi_max', 'weight']);
  });

  it('handles moving last key to first position', () => {
    const rules = baseRules();
    const result = reorderKey(baseOrder(), rules, 'weight', 'sensor');
    assert.equal(result[0], 'sensor');
    assert.equal(result[1], 'weight');
  });

  it('returns original if activeKey not found', () => {
    const order = baseOrder();
    const result = reorderKey(order, baseRules(), 'nonexistent', 'sensor');
    assert.deepStrictEqual(result, order);
  });

  it('returns original if overKey not found', () => {
    const order = baseOrder();
    const result = reorderKey(order, baseRules(), 'sensor', 'nonexistent');
    assert.deepStrictEqual(result, order);
  });
});

describe('reorderGroup', () => {
  it('moves an entire group block before another group', () => {
    const result = reorderGroup(baseOrder(), baseRules(), 'physical', 'core');
    const groups = deriveGroups(result, baseRules());
    assert.deepStrictEqual(groups.map(([g]) => g), ['physical', 'core', 'performance']);
  });

  it('moves a group block after another group', () => {
    const result = reorderGroup(baseOrder(), baseRules(), 'core', 'physical');
    const groups = deriveGroups(result, baseRules());
    assert.deepStrictEqual(groups.map(([g]) => g), ['performance', 'core', 'physical']);
  });

  it('returns same order when active equals over', () => {
    const order = baseOrder();
    const result = reorderGroup(order, baseRules(), 'core', 'core');
    assert.deepStrictEqual(result, order);
  });

  it('does not mutate original array', () => {
    const order = baseOrder();
    reorderGroup(order, baseRules(), 'physical', 'core');
    assert.deepStrictEqual(order, ['sensor', 'sensor_brand', 'dpi_max', 'weight']);
  });

  it('preserves key order within moved group', () => {
    const result = reorderGroup(baseOrder(), baseRules(), 'core', 'physical');
    const coreIdx0 = result.indexOf('sensor');
    const coreIdx1 = result.indexOf('sensor_brand');
    assert.ok(coreIdx0 < coreIdx1);
  });

  it('handles single-key group', () => {
    const result = reorderGroup(baseOrder(), baseRules(), 'performance', 'core');
    const groups = deriveGroups(result, baseRules());
    assert.deepStrictEqual(groups.map(([g]) => g), ['performance', 'core', 'physical']);
    assert.deepStrictEqual(groups[0][1], ['dpi_max']);
  });

  it('returns original if activeGroup not found', () => {
    const order = baseOrder();
    const result = reorderGroup(order, baseRules(), 'nonexistent', 'core');
    assert.deepStrictEqual(result, order);
  });

  it('returns original if overGroup not found', () => {
    const order = baseOrder();
    const result = reorderGroup(order, baseRules(), 'core', 'nonexistent');
    assert.deepStrictEqual(result, order);
  });
});
