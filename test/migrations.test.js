import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyKeyMigrations,
  buildMigrationPlan,
  classifyFieldRulesVersionChange
} from '../src/field-rules/migrations.js';

test('classifyFieldRulesVersionChange marks major bump on removed field', () => {
  const previousRules = {
    version: '1.2.0',
    fields: {
      weight: { contract: { type: 'number', shape: 'scalar' } },
      sensor: { contract: { type: 'string', shape: 'scalar' } }
    }
  };
  const nextRules = {
    fields: {
      weight: { contract: { type: 'number', shape: 'scalar' } }
    }
  };

  const version = classifyFieldRulesVersionChange({
    previousRules,
    nextRules,
    previousVersion: '1.2.0'
  });
  assert.equal(version.bump, 'major');
  assert.equal(version.previous_version, '1.2.0');
  assert.equal(version.next_version, '2.0.0');
  assert.deepEqual(version.removed_fields, ['sensor']);
});

test('classifyFieldRulesVersionChange marks minor bump on added field', () => {
  const previousRules = {
    version: '1.2.0',
    fields: {
      weight: { contract: { type: 'number', shape: 'scalar' } }
    }
  };
  const nextRules = {
    fields: {
      weight: { contract: { type: 'number', shape: 'scalar' } },
      sensor: { contract: { type: 'string', shape: 'scalar' } }
    }
  };

  const version = classifyFieldRulesVersionChange({
    previousRules,
    nextRules,
    previousVersion: '1.2.0'
  });
  assert.equal(version.bump, 'minor');
  assert.equal(version.next_version, '1.3.0');
  assert.deepEqual(version.added_fields, ['sensor']);
});

test('buildMigrationPlan preserves explicit migration rows', () => {
  const previousRules = {
    version: '1.0.0',
    fields: {
      connection: { contract: { type: 'string', shape: 'scalar' } }
    }
  };
  const nextRules = {
    fields: {
      connection_type: { contract: { type: 'string', shape: 'scalar' } }
    }
  };
  const plan = buildMigrationPlan({
    previousRules,
    nextRules,
    keyMigrations: {
      version: '2.0.0',
      previous_version: '1.0.0',
      migrations: [
        {
          type: 'rename',
          from: 'connection',
          to: 'connection_type',
          reason: 'split for explicit key naming'
        }
      ]
    }
  });

  assert.equal(plan.bump, 'major');
  assert.equal(plan.version, '2.0.0');
  assert.equal(plan.migrations.length, 1);
  assert.equal(plan.migrations[0].type, 'rename');
  assert.equal(typeof plan.key_map, 'object');
  assert.equal(plan.key_map.connection, 'connection_type');
});

test('applyKeyMigrations handles rename merge split and deprecate', () => {
  const migrated = applyKeyMigrations(
    {
      mouse_side_connector: 'usb-c',
      sensor_latency: '1.0ms',
      sensor_latency_list: '0.8ms,1.0ms',
      connection: 'wireless',
      paracord: 'yes'
    },
    {
      migrations: [
        {
          type: 'rename',
          from: 'mouse_side_connector',
          to: 'device_side_connector'
        },
        {
          type: 'merge',
          from: ['sensor_latency', 'sensor_latency_list'],
          to: 'sensor_latency'
        },
        {
          type: 'split',
          from: 'connection',
          to: ['connection_type', 'wireless_technology']
        },
        {
          type: 'deprecate',
          field: 'paracord'
        }
      ]
    }
  );

  assert.equal(migrated.mouse_side_connector, undefined);
  assert.equal(migrated.device_side_connector, 'usb-c');
  assert.equal(Array.isArray(migrated.sensor_latency), true);
  assert.equal(migrated.connection, undefined);
  assert.equal(migrated.connection_type, 'wireless');
  assert.equal(migrated.wireless_technology, 'wireless');
  assert.equal(migrated.paracord, undefined);
  assert.equal(typeof migrated._deprecated, 'object');
  assert.equal(migrated._deprecated.paracord, 'yes');
});
