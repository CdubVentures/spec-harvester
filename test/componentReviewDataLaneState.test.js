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

test('component payload keeps shared pending when AI lane is still pending even after user accept', async () => {
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
    assert.equal(Boolean(row?.properties?.dpi_max?.needs_review), true);
    assert.equal((row?.properties?.dpi_max?.reason_codes || []).includes('pending_ai'), true);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('enum payload keeps pending when AI shared lane is pending even if user accepted', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const productId = 'mouse-test-enum-pending';
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
    specDb.upsertItemFieldState({
      productId,
      fieldKey: 'connection',
      value: 'Bluetooth',
      confidence: 0.6,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: true,
      aiReviewComplete: false,
    });
    specDb.syncItemListLinkForFieldValue({
      productId,
      fieldKey: 'connection',
      value: 'Bluetooth',
    });

    const payload = await buildEnumReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      specDb,
    });
    const field = payload.fields.find((entry) => entry.field === 'connection');
    const value = field?.values.find((entry) => entry.value === 'Bluetooth');
    assert.ok(value, 'expected connection=Bluetooth entry');
    assert.equal(Boolean(value?.needs_review), true);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('component payload defaults non-user slot selection to highest-confidence candidate', async () => {
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
      value: '32000',
      confidence: 0.42,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: true,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-test-top-candidate',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'shared_accept',
      matchScore: 1,
    });
    specDb.insertCandidate({
      candidate_id: 'cand_low',
      category: CATEGORY,
      product_id: 'mouse-test-top-candidate',
      field_key: 'dpi_max',
      value: '32000',
      normalized_value: '32000',
      score: 0.42,
      source_host: 'low.example',
      source_tier: 2,
      source_method: 'pipeline_extract',
    });
    specDb.insertCandidate({
      candidate_id: 'cand_high',
      category: CATEGORY,
      product_id: 'mouse-test-top-candidate',
      field_key: 'dpi_max',
      value: '35000',
      normalized_value: '35000',
      score: 0.93,
      source_host: 'high.example',
      source_tier: 1,
      source_method: 'pipeline_extract',
    });

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
    });
    const row = payload.items.find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
    assert.ok(row, 'expected PAW3950/PixArt row');
    const prop = row?.properties?.dpi_max;
    assert.ok(prop, 'expected dpi_max property');
    assert.equal(prop.selected.value, '35000');
    assert.equal(String(prop.candidates?.[0]?.candidate_id || '').endsWith('cand_high'), true);
    assert.equal(prop.source, 'specdb');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('component payload keeps candidate evidence visible after shared lane confirm', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'PAW3970',
      maker: 'PixArt',
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3970',
      componentMaker: 'PixArt',
      propertyKey: 'dpi_max',
      value: '35000',
      confidence: 0.9,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });
    const componentIdentifier = buildComponentIdentifier('sensor', 'PAW3970', 'PixArt');
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      selectedValue: '35000',
      selectedCandidateId: null,
      confidenceScore: 0.9,
      aiConfirmSharedStatus: 'confirmed',
      userAcceptSharedStatus: 'accepted',
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
            review_id: 'rv_confirmed_component_candidate',
            category: CATEGORY,
            component_type: 'sensor',
            field_key: 'sensor',
            raw_query: 'PAW3970',
            matched_component: 'PAW3970',
            match_type: 'exact',
            status: 'confirmed_ai',
            product_id: 'mouse-test-confirmed-component-candidate',
            created_at: '2026-02-18T00:00:00.000Z',
            product_attributes: {
              dpi_max: '36000',
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
    const row = payload.items.find((item) => item.name === 'PAW3970' && item.maker === 'PixArt');
    assert.ok(row, 'expected PAW3970/PixArt row');
    const prop = row?.properties?.dpi_max;
    assert.ok(prop, 'expected dpi_max property');
    const values = (prop.candidates || []).map((candidate) => String(candidate.value));
    assert.equal(values.includes('36000'), true);
    assert.equal((prop.candidate_count || 0) >= 1, true);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('component payload synthesizes backing candidate for selected non-user value when candidate id is missing', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'PAW3395',
      maker: 'PixArt',
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3395',
      componentMaker: 'PixArt',
      propertyKey: 'dpi_max',
      value: '26000',
      confidence: 0.8,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: 'missing_component_candidate',
      needsReview: true,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-test-synthetic-candidate',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3395',
      componentMaker: 'PixArt',
      matchType: 'shared_accept',
      matchScore: 1,
    });

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
    });
    const row = payload.items.find((item) => item.name === 'PAW3395' && item.maker === 'PixArt');
    assert.ok(row, 'expected PAW3395/PixArt row');
    const prop = row?.properties?.dpi_max;
    assert.ok(prop, 'expected dpi_max property');
    assert.equal(prop.candidates.some((candidate) => candidate.candidate_id === 'missing_component_candidate'), true);
    assert.equal(prop.candidate_count >= 1, true);
    assert.equal(prop.selected.value, '26000');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('enum payload synthesizes backing candidate when selected non-manual value has no candidate row', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const productId = 'mouse-test-enum-synth';
    specDb.upsertListValue({
      fieldKey: 'connection',
      value: 'Bluetooth',
      normalizedValue: 'bluetooth',
      source: 'pipeline',
      enumPolicy: 'closed',
      acceptedCandidateId: 'enum_missing_candidate',
      needsReview: true,
      overridden: false,
      sourceTimestamp: '2026-02-18T00:00:00.000Z',
    });
    specDb.upsertItemFieldState({
      productId,
      fieldKey: 'connection',
      value: 'Bluetooth',
      confidence: 0.6,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: true,
      aiReviewComplete: false,
    });
    specDb.syncItemListLinkForFieldValue({
      productId,
      fieldKey: 'connection',
      value: 'Bluetooth',
    });

    const payload = await buildEnumReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      specDb,
    });
    const field = payload.fields.find((entry) => entry.field === 'connection');
    const value = field?.values.find((entry) => entry.value === 'Bluetooth');
    assert.ok(value, 'expected connection=Bluetooth entry');
    assert.equal(value.candidates.some((candidate) => String(candidate?.value || '').toLowerCase() === 'bluetooth'), true);
    assert.equal(value.candidates.length >= 1, true);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});
