import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpecDb } from '../src/db/specDb.js';
import { buildComponentIdentifier } from '../src/utils/componentIdentifier.js';

const CATEGORY = 'mouse';

async function createTempSpecDb() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'component-merge-'));
  const dbPath = path.join(tempRoot, 'spec.sqlite');
  const specDb = new SpecDb({ dbPath, category: CATEGORY });
  return { tempRoot, specDb };
}

async function cleanupTempSpecDb(tempRoot, specDb) {
  try { specDb?.close?.(); } catch { /* best-effort */ }
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function getIdentityRow(specDb, componentType, canonicalName, maker = '') {
  return specDb.db.prepare(
    'SELECT * FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?'
  ).get(CATEGORY, componentType, canonicalName, maker) || null;
}

function getAllIdentities(specDb, componentType, canonicalName) {
  return specDb.db.prepare(
    'SELECT * FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ?'
  ).all(CATEGORY, componentType, canonicalName);
}

function getComponentValues(specDb, componentType, componentName, componentMaker) {
  return specDb.db.prepare(
    'SELECT * FROM component_values WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?'
  ).all(CATEGORY, componentType, componentName, componentMaker);
}

function getLinks(specDb, componentType, componentName, componentMaker) {
  return specDb.db.prepare(
    'SELECT * FROM item_component_links WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?'
  ).all(CATEGORY, componentType, componentName, componentMaker);
}

function getAliases(specDb, componentIdentityId) {
  return specDb.db.prepare(
    'SELECT * FROM component_aliases WHERE component_id = ?'
  ).all(componentIdentityId);
}

function getKeyReviewStates(specDb, componentIdentifier) {
  return specDb.db.prepare(
    'SELECT * FROM key_review_state WHERE category = ? AND component_identifier = ?'
  ).all(CATEGORY, componentIdentifier);
}

function seedTwoIdentitiesWithCollision(specDb) {
  const targetId = specDb.upsertComponentIdentity({
    componentType: 'sensor',
    canonicalName: 'IMX989',
    maker: 'Sony',
    source: 'component_db',
  })?.id;
  specDb.upsertComponentValue({
    componentType: 'sensor',
    componentName: 'IMX989',
    componentMaker: 'Sony',
    propertyKey: 'megapixels',
    value: '200',
    confidence: 1.0,
    source: 'component_db',
  });
  specDb.upsertComponentValue({
    componentType: 'sensor',
    componentName: 'IMX989',
    componentMaker: 'Sony',
    propertyKey: 'sensor_size',
    value: '1 inch',
    confidence: 0.9,
    source: 'component_db',
  });

  const sourceId = specDb.upsertComponentIdentity({
    componentType: 'sensor',
    canonicalName: 'IMX989',
    maker: '',
    source: 'pipeline',
  })?.id;
  specDb.upsertComponentValue({
    componentType: 'sensor',
    componentName: 'IMX989',
    componentMaker: '',
    propertyKey: 'megapixels',
    value: '200.3',
    confidence: 0.8,
    source: 'pipeline',
  });
  specDb.upsertComponentValue({
    componentType: 'sensor',
    componentName: 'IMX989',
    componentMaker: '',
    propertyKey: 'pixel_size',
    value: '0.6μm',
    confidence: 0.7,
    source: 'pipeline',
  });

  specDb.upsertItemComponentLink({
    productId: 'product-A',
    fieldKey: 'sensor',
    componentType: 'sensor',
    componentName: 'IMX989',
    componentMaker: 'Sony',
    matchType: 'exact',
    matchScore: 1.0,
  });
  specDb.upsertItemComponentLink({
    productId: 'product-B',
    fieldKey: 'sensor',
    componentType: 'sensor',
    componentName: 'IMX989',
    componentMaker: '',
    matchType: 'fuzzy',
    matchScore: 0.8,
  });

  specDb.insertAlias(targetId, 'imx989', 'component_db');
  specDb.insertAlias(sourceId, 'imx 989', 'pipeline');

  const targetIdentifier = buildComponentIdentifier('sensor', 'IMX989', 'Sony');
  const sourceIdentifier = buildComponentIdentifier('sensor', 'IMX989', '');

  specDb.upsertKeyReviewState({
    category: CATEGORY,
    targetKind: 'component_key',
    fieldKey: 'sensor',
    componentIdentifier: targetIdentifier,
    componentIdentityId: targetId,
    propertyKey: '__name',
    aiConfirmSharedStatus: 'confirmed',
  });
  specDb.upsertKeyReviewState({
    category: CATEGORY,
    targetKind: 'component_key',
    fieldKey: 'sensor',
    componentIdentifier: sourceIdentifier,
    componentIdentityId: sourceId,
    propertyKey: '__name',
    aiConfirmSharedStatus: 'pending',
  });
  specDb.upsertKeyReviewState({
    category: CATEGORY,
    targetKind: 'component_key',
    fieldKey: 'sensor',
    componentIdentifier: sourceIdentifier,
    componentIdentityId: sourceId,
    propertyKey: 'pixel_size',
    aiConfirmSharedStatus: 'pending',
  });

  return { sourceId, targetId, sourceIdentifier, targetIdentifier };
}

test('G2/G6 — mergeComponentIdentities transfers links from source to target', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const { sourceId, targetId, targetIdentifier } = seedTwoIdentitiesWithCollision(specDb);

    specDb.mergeComponentIdentities({ sourceId, targetId });

    const targetLinks = getLinks(specDb, 'sensor', 'IMX989', 'Sony');
    assert.equal(targetLinks.length, 2, 'target should have both product links');
    const productIds = targetLinks.map((l) => l.product_id).sort();
    assert.deepEqual(productIds, ['product-A', 'product-B']);

    const sourceLinks = getLinks(specDb, 'sensor', 'IMX989', '');
    assert.equal(sourceLinks.length, 0, 'source should have no remaining links');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G2/G6 — mergeComponentIdentities merges values (target takes precedence)', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const { sourceId, targetId } = seedTwoIdentitiesWithCollision(specDb);

    specDb.mergeComponentIdentities({ sourceId, targetId });

    const targetValues = getComponentValues(specDb, 'sensor', 'IMX989', 'Sony');
    const valueMap = Object.fromEntries(targetValues.map((v) => [v.property_key, v.value]));

    assert.equal(valueMap.megapixels, '200', 'target value takes precedence for megapixels');
    assert.equal(valueMap.sensor_size, '1 inch', 'target exclusive value preserved');
    assert.equal(valueMap.pixel_size, '0.6μm', 'source exclusive value transferred');

    const sourceValues = getComponentValues(specDb, 'sensor', 'IMX989', '');
    assert.equal(sourceValues.length, 0, 'source should have no remaining values');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G2/G6 — mergeComponentIdentities transfers aliases and removes source identity', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const { sourceId, targetId } = seedTwoIdentitiesWithCollision(specDb);

    specDb.mergeComponentIdentities({ sourceId, targetId });

    const aliases = getAliases(specDb, targetId);
    const aliasValues = aliases.map((a) => a.alias).sort();
    assert.ok(aliasValues.includes('imx989'), 'target alias preserved');
    assert.ok(aliasValues.includes('imx 989'), 'source alias transferred');

    const identities = getAllIdentities(specDb, 'sensor', 'IMX989');
    assert.equal(identities.length, 1, 'only one identity should remain');
    assert.equal(identities[0].maker, 'Sony', 'surviving identity is the target');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G2/G6 — mergeComponentIdentities updates key_review_state to target identifier', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const { sourceId, targetId, sourceIdentifier, targetIdentifier } = seedTwoIdentitiesWithCollision(specDb);

    specDb.mergeComponentIdentities({ sourceId, targetId });

    const sourceStates = getKeyReviewStates(specDb, sourceIdentifier);
    assert.equal(sourceStates.length, 0, 'no key_review_state rows should reference source identifier');

    const targetStates = getKeyReviewStates(specDb, targetIdentifier);
    assert.ok(targetStates.length >= 2, 'target should have merged key_review_state rows');

    const nameState = targetStates.find((s) => s.property_key === '__name');
    assert.ok(nameState, 'target should have __name key_review_state');
    assert.equal(nameState.ai_confirm_shared_status, 'confirmed',
      'more-progressed state (confirmed) should be kept when both exist');

    const pixelState = targetStates.find((s) => s.property_key === 'pixel_size');
    assert.ok(pixelState, 'source-only key_review_state should be transferred');
    assert.equal(pixelState.component_identity_id, targetId, 'transferred state should reference target identity');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('G2/G6 — non-colliding maker update still works (regression)', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const sourceId = specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'IMX989',
      maker: '',
      source: 'pipeline',
    })?.id;
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'IMX989',
      componentMaker: '',
      propertyKey: 'megapixels',
      value: '200',
      confidence: 0.9,
      source: 'pipeline',
    });
    specDb.upsertItemComponentLink({
      productId: 'product-A',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'IMX989',
      componentMaker: '',
      matchType: 'exact',
      matchScore: 1.0,
    });

    const existingTarget = specDb.db.prepare(
      'SELECT id FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ? AND id != ?'
    ).get(CATEGORY, 'sensor', 'IMX989', 'Sony', sourceId);
    assert.equal(existingTarget, undefined, 'no collision should exist');

    const identity = getIdentityRow(specDb, 'sensor', 'IMX989', '');
    assert.ok(identity, 'source identity should exist before update');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});
