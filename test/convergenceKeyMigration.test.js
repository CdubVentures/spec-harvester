import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndMigrateKeys } from '../src/pipeline/runOrchestrator.js';

const MIGRATION_MAP = {
  'fields.mouse_sensor': 'fields.sensor',
  'fields.mouse_dpi': 'fields.max_dpi',
  'fields.mouse_weight': 'fields.weight',
  'fields.polling_hz': 'fields.polling_rate'
};

const KNOWN_KEYS = new Set([
  'fields.sensor',
  'fields.max_dpi',
  'fields.weight',
  'fields.polling_rate',
  'fields.cable_type',
  'fields.switch_type'
]);

test('migrates old keys to new keys', () => {
  const input = {
    'fields.mouse_sensor': 'Focus Pro 35K',
    'fields.cable_type': 'USB-C'
  };

  const result = validateAndMigrateKeys({ data: input, migrationMap: MIGRATION_MAP, knownKeys: KNOWN_KEYS });
  assert.equal(result.migrated['fields.sensor'], 'Focus Pro 35K');
  assert.equal(result.migrated['fields.cable_type'], 'USB-C');
  assert.ok(!result.migrated['fields.mouse_sensor']);
});

test('passes through known keys unchanged', () => {
  const input = {
    'fields.sensor': 'Focus Pro 35K',
    'fields.weight': '55g'
  };

  const result = validateAndMigrateKeys({ data: input, migrationMap: MIGRATION_MAP, knownKeys: KNOWN_KEYS });
  assert.equal(result.migrated['fields.sensor'], 'Focus Pro 35K');
  assert.equal(result.migrated['fields.weight'], '55g');
  assert.equal(result.unknown.length, 0);
});

test('flags unknown keys that are not in migration map or known set', () => {
  const input = {
    'fields.sensor': 'Focus Pro 35K',
    'fields.banana_count': '7',
    'fields.foo_bar': 'baz'
  };

  const result = validateAndMigrateKeys({ data: input, migrationMap: MIGRATION_MAP, knownKeys: KNOWN_KEYS });
  assert.equal(result.migrated['fields.sensor'], 'Focus Pro 35K');
  assert.ok(!result.migrated['fields.banana_count']);
  assert.ok(!result.migrated['fields.foo_bar']);
  assert.deepStrictEqual(result.unknown.sort(), ['fields.banana_count', 'fields.foo_bar']);
});

test('handles multiple migrations in same input', () => {
  const input = {
    'fields.mouse_sensor': 'Focus Pro 35K',
    'fields.mouse_dpi': '35000',
    'fields.polling_hz': '8000'
  };

  const result = validateAndMigrateKeys({ data: input, migrationMap: MIGRATION_MAP, knownKeys: KNOWN_KEYS });
  assert.equal(result.migrated['fields.sensor'], 'Focus Pro 35K');
  assert.equal(result.migrated['fields.max_dpi'], '35000');
  assert.equal(result.migrated['fields.polling_rate'], '8000');
  assert.equal(Object.keys(result.migrated).length, 3);
  assert.equal(result.migratedKeys.length, 3);
});

test('returns migratedKeys listing which keys were renamed', () => {
  const input = {
    'fields.mouse_sensor': 'Focus Pro 35K',
    'fields.cable_type': 'USB-C'
  };

  const result = validateAndMigrateKeys({ data: input, migrationMap: MIGRATION_MAP, knownKeys: KNOWN_KEYS });
  assert.equal(result.migratedKeys.length, 1);
  assert.deepStrictEqual(result.migratedKeys, [
    { from: 'fields.mouse_sensor', to: 'fields.sensor' }
  ]);
});

test('empty input returns empty result', () => {
  const result = validateAndMigrateKeys({ data: {}, migrationMap: MIGRATION_MAP, knownKeys: KNOWN_KEYS });
  assert.deepStrictEqual(result.migrated, {});
  assert.deepStrictEqual(result.unknown, []);
  assert.deepStrictEqual(result.migratedKeys, []);
});

test('handles null and undefined gracefully', () => {
  const result = validateAndMigrateKeys({ data: null, migrationMap: {}, knownKeys: new Set() });
  assert.deepStrictEqual(result.migrated, {});
  assert.deepStrictEqual(result.unknown, []);
  assert.deepStrictEqual(result.migratedKeys, []);
});
