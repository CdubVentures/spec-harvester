import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpecDb } from '../src/db/specDb.js';
import { reEvaluateEnumPolicy } from '../src/db/seed.js';

const CATEGORY = 'mouse';

async function createTempSpecDb() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'enum-policy-transition-'));
  const dbPath = path.join(tempRoot, 'spec.sqlite');
  const specDb = new SpecDb({ dbPath, category: CATEGORY });
  return { tempRoot, specDb };
}

async function cleanupTempSpecDb(tempRoot, specDb) {
  try { specDb?.close?.(); } catch { /* best-effort */ }
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function getListValue(specDb, fieldKey, value) {
  return specDb.db.prepare(
    'SELECT * FROM list_values WHERE category = ? AND field_key = ? AND value = ?'
  ).get(CATEGORY, fieldKey, value) || null;
}

test('G5 — closed → open_prefer_known: pipeline value transitions from needs_review to accepted suggestion', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertListValue({
      fieldKey: 'switch_type',
      value: 'Cherry MX Red',
      normalizedValue: 'cherry mx red',
      source: 'known_values',
      enumPolicy: 'closed',
      needsReview: false,
    });
    specDb.upsertListValue({
      fieldKey: 'switch_type',
      value: 'Gateron Yellow',
      normalizedValue: 'gateron yellow',
      source: 'pipeline',
      enumPolicy: 'closed',
      needsReview: true,
    });

    const before = getListValue(specDb, 'switch_type', 'Gateron Yellow');
    assert.equal(before.needs_review, 1, 'pipeline value starts as needs_review under closed');
    assert.equal(before.enum_policy, 'closed');

    reEvaluateEnumPolicy(specDb, 'switch_type', 'open_prefer_known', new Set(['cherry mx red']));

    const after = getListValue(specDb, 'switch_type', 'Gateron Yellow');
    assert.equal(after.needs_review, 0, 'pipeline value should become suggestion under open_prefer_known');
    assert.equal(after.enum_policy, 'open_prefer_known', 'enum_policy updated to new policy');

    const known = getListValue(specDb, 'switch_type', 'Cherry MX Red');
    assert.equal(known.needs_review, 0, 'known value stays accepted');
    assert.equal(known.enum_policy, 'open_prefer_known', 'known value policy updated');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G5 — open_prefer_known → closed: pipeline value without known match transitions to needs_review', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertListValue({
      fieldKey: 'switch_type',
      value: 'Cherry MX Red',
      normalizedValue: 'cherry mx red',
      source: 'known_values',
      enumPolicy: 'open_prefer_known',
      needsReview: false,
    });
    specDb.upsertListValue({
      fieldKey: 'switch_type',
      value: 'Gateron Yellow',
      normalizedValue: 'gateron yellow',
      source: 'pipeline',
      enumPolicy: 'open_prefer_known',
      needsReview: false,
    });

    const before = getListValue(specDb, 'switch_type', 'Gateron Yellow');
    assert.equal(before.needs_review, 0, 'pipeline value starts as suggestion under open');

    reEvaluateEnumPolicy(specDb, 'switch_type', 'closed', new Set(['cherry mx red']));

    const after = getListValue(specDb, 'switch_type', 'Gateron Yellow');
    assert.equal(after.needs_review, 1, 'pipeline value not in known set must need review under closed');
    assert.equal(after.enum_policy, 'closed', 'enum_policy updated to closed');

    const known = getListValue(specDb, 'switch_type', 'Cherry MX Red');
    assert.equal(known.needs_review, 0, 'known value stays accepted under closed');
    assert.equal(known.enum_policy, 'closed', 'known value policy updated');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G5 — overridden pipeline values are not affected by policy change', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertListValue({
      fieldKey: 'switch_type',
      value: 'Custom Switch',
      normalizedValue: 'custom switch',
      source: 'pipeline',
      enumPolicy: 'open_prefer_known',
      needsReview: false,
      overridden: true,
    });

    reEvaluateEnumPolicy(specDb, 'switch_type', 'closed', new Set([]));

    const row = getListValue(specDb, 'switch_type', 'Custom Switch');
    assert.equal(row.needs_review, 0, 'overridden value should not be touched');
    assert.equal(row.enum_policy, 'closed', 'enum_policy still updated even on overridden rows');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G5 — pipeline value matching known set is not flagged under closed', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertListValue({
      fieldKey: 'switch_type',
      value: 'Cherry MX Red',
      normalizedValue: 'cherry mx red',
      source: 'pipeline',
      enumPolicy: 'open_prefer_known',
      needsReview: false,
    });

    reEvaluateEnumPolicy(specDb, 'switch_type', 'closed', new Set(['cherry mx red']));

    const row = getListValue(specDb, 'switch_type', 'Cherry MX Red');
    assert.equal(row.needs_review, 0, 'pipeline value matching known set should not be flagged');
    assert.equal(row.enum_policy, 'closed');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G5 — manual source values are not affected by policy change', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertListValue({
      fieldKey: 'switch_type',
      value: 'User Custom',
      normalizedValue: 'user custom',
      source: 'manual',
      enumPolicy: 'open_prefer_known',
      needsReview: false,
    });

    reEvaluateEnumPolicy(specDb, 'switch_type', 'closed', new Set([]));

    const row = getListValue(specDb, 'switch_type', 'User Custom');
    assert.equal(row.needs_review, 0, 'manual values should not be affected by policy change');
    assert.equal(row.enum_policy, 'closed', 'enum_policy still updated');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});
