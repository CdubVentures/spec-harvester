import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpecDb } from '../src/db/specDb.js';
import { buildComponentIdentifier } from '../src/utils/componentIdentifier.js';
import { buildComponentReviewPayloads, buildEnumReviewPayloads } from '../src/review/componentReviewData.js';

const CATEGORY = 'mouse';

async function createTempSpecDb() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'component-review-lane-state-'));
  const dbPath = path.join(tempRoot, 'spec.sqlite');
  const specDb = new SpecDb({ dbPath, category: CATEGORY });
  return { tempRoot, specDb };
}

async function cleanupTempSpecDb(tempRoot, specDb) {
  try {
    specDb?.close?.();
  } catch {
    // best-effort
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}

test('component payload hydrates __name/__maker accepted_candidate_id from key_review_state', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'PAW3950',
      maker: 'PixArt',
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      propertyKey: 'dpi_max',
      value: '35000',
      confidence: 1,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-test-paw3950',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'shared_accept',
      matchScore: 1,
    });

    const componentIdentifier = buildComponentIdentifier('sensor', 'PAW3950', 'PixArt');
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: '__name',
      componentIdentifier,
      propertyKey: '__name',
      selectedValue: 'PAW3950',
      selectedCandidateId: 'cand_name',
      confidenceScore: 1,
      aiConfirmSharedStatus: 'confirmed',
      userAcceptSharedStatus: 'accepted',
    });
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: '__maker',
      componentIdentifier,
      propertyKey: '__maker',
      selectedValue: 'PixArt',
      selectedCandidateId: 'cand_maker',
      confidenceScore: 1,
      aiConfirmSharedStatus: 'confirmed',
      userAcceptSharedStatus: 'accepted',
    });

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
    });
    const row = payload.items.find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
    assert.ok(row, 'expected PAW3950/PixArt row');
    assert.equal(row.name_tracked.accepted_candidate_id, 'cand_name');
    assert.equal(row.maker_tracked.accepted_candidate_id, 'cand_maker');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('component payload splits comma-delimited pipeline property values into distinct candidates', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'PAW3950',
      maker: 'PixArt',
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      propertyKey: 'dpi_max',
      value: '35000',
      confidence: 1,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-test-paw3950',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'shared_accept',
      matchScore: 1,
    });

    const helperRoot = path.join(tempRoot, 'helper_files');
    const reviewPath = path.join(helperRoot, CATEGORY, '_suggestions', 'component_review.json');
    await fs.mkdir(path.dirname(reviewPath), { recursive: true });
    await fs.writeFile(
      reviewPath,
      `${JSON.stringify({
        version: 1,
        category: CATEGORY,
        items: [
          {
            review_id: 'rv_1',
            category: CATEGORY,
            component_type: 'sensor',
            field_key: 'sensor',
            raw_query: 'PAW3950',
            matched_component: 'PAW3950',
            match_type: 'fuzzy_flagged',
            status: 'pending_ai',
            product_id: 'mouse-test-paw3950',
            created_at: '2026-02-18T00:00:00.000Z',
            product_attributes: {
              dpi_max: '26000, 30000',
            },
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: helperRoot },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
    });
    const row = payload.items.find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
    assert.ok(row, 'expected PAW3950/PixArt row');
    const values = (row?.properties?.dpi_max?.candidates || []).map((candidate) => String(candidate.value));
    assert.equal(values.includes('26000'), true);
    assert.equal(values.includes('30000'), true);
    assert.equal(values.includes('26000, 30000'), false);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('component payload clears shared pending when user accepted shared lane', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'PAW3950',
      maker: 'PixArt',
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      propertyKey: 'dpi_max',
      value: '35000',
      confidence: 0.6,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: 'cand_dpi',
      needsReview: true,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-test-paw3950',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'shared_accept',
      matchScore: 1,
    });

    const componentIdentifier = buildComponentIdentifier('sensor', 'PAW3950', 'PixArt');
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      selectedValue: '35000',
      selectedCandidateId: 'cand_dpi',
      confidenceScore: 0.6,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: 'accepted',
    });

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
    });
    const row = payload.items.find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
    assert.ok(row, 'expected PAW3950/PixArt row');
    assert.equal(Boolean(row?.properties?.dpi_max?.needs_review), false);
    assert.equal((row?.properties?.dpi_max?.reason_codes || []).includes('pending_ai'), false);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('enum payload clears pending when shared user accept exists', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertListValue({
      fieldKey: 'connection',
      value: 'Bluetooth',
      normalizedValue: 'bluetooth',
      source: 'pipeline',
      enumPolicy: 'closed',
      acceptedCandidateId: 'cand_bt',
      needsReview: true,
      overridden: false,
      sourceTimestamp: '2026-02-18T00:00:00.000Z',
    });
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'bluetooth',
      selectedValue: 'Bluetooth',
      selectedCandidateId: 'cand_bt',
      confidenceScore: 0.6,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: 'accepted',
    });

    const payload = await buildEnumReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      specDb,
    });
    const field = payload.fields.find((entry) => entry.field === 'connection');
    const value = field?.values.find((entry) => entry.value === 'Bluetooth');
    assert.ok(value, 'expected connection=Bluetooth entry');
    assert.equal(Boolean(value?.needs_review), false);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});
