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

function getComponentIdentityId(specDb, componentType, canonicalName, maker = '') {
  const row = specDb.db.prepare(
    `SELECT id
     FROM component_identity
     WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?
     LIMIT 1`
  ).get(CATEGORY, componentType, canonicalName, maker);
  return row?.id ?? null;
}

function getComponentValueId(specDb, componentType, componentName, componentMaker, propertyKey) {
  const row = specDb.db.prepare(
    `SELECT id
     FROM component_values
     WHERE category = ?
       AND component_type = ?
       AND component_name = ?
       AND component_maker = ?
       AND property_key = ?
     LIMIT 1`
  ).get(CATEGORY, componentType, componentName, componentMaker, propertyKey);
  return row?.id ?? null;
}

function getEnumSlot(specDb, fieldKey, value) {
  const row = specDb.db.prepare(
    `SELECT id, list_id
     FROM list_values
     WHERE category = ? AND field_key = ? AND value = ?
     LIMIT 1`
  ).get(CATEGORY, fieldKey, value);
  return {
    listValueId: row?.id ?? null,
    enumListId: row?.list_id ?? null,
  };
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
    const componentIdentityId = getComponentIdentityId(specDb, 'sensor', 'PAW3950', 'PixArt');
    assert.ok(componentIdentityId, 'expected component identity slot id');
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: '__name',
      componentIdentifier,
      propertyKey: '__name',
      componentIdentityId,
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
      componentIdentityId,
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

test('component payload does not hydrate queue-only property candidates when linked product candidates drive the slot', async () => {
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
    assert.equal(values.includes('26000'), false);
    assert.equal(values.includes('30000'), false);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('component payload isolates same-name lanes by maker for linked-product candidate attribution', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const componentType = 'switch';
    const componentName = 'Omron D2FC-F-7N';
    const makerA = 'Omron';
    const makerB = 'Huano';
    const propertyKey = 'actuation_force';
    const productsA = ['mouse-omron-a1', 'mouse-omron-a2'];
    const productsB = ['mouse-huano-b1', 'mouse-huano-b2'];

    const upsertLane = (maker, value) => {
      specDb.upsertComponentIdentity({
        componentType,
        canonicalName: componentName,
        maker,
        links: [],
        source: 'pipeline',
      });
      specDb.upsertComponentValue({
        componentType,
        componentName,
        componentMaker: maker,
        propertyKey,
        value: String(value),
        confidence: 1,
        variancePolicy: null,
        source: 'pipeline',
        acceptedCandidateId: null,
        needsReview: true,
        overridden: false,
        constraints: [],
      });
    };

    upsertLane(makerA, 55);
    upsertLane(makerB, 65);

    const linkAndSeedCandidates = (productId, maker, forceValue) => {
      specDb.upsertItemComponentLink({
        productId,
        fieldKey: 'switch',
        componentType,
        componentName,
        componentMaker: maker,
        matchType: 'shared_accept',
        matchScore: 1,
      });
      specDb.insertCandidate({
        candidate_id: `${productId}::switch::name`,
        category: CATEGORY,
        product_id: productId,
        field_key: 'switch',
        value: componentName,
        normalized_value: componentName.toLowerCase(),
        score: 0.95,
        rank: 1,
        source_host: 'contract.test',
        source_method: 'pipeline_extract',
        source_tier: 1,
      });
      specDb.insertCandidate({
        candidate_id: `${productId}::switch_brand::maker`,
        category: CATEGORY,
        product_id: productId,
        field_key: 'switch_brand',
        value: maker,
        normalized_value: maker.toLowerCase(),
        score: 0.9,
        rank: 1,
        source_host: 'contract.test',
        source_method: 'pipeline_extract',
        source_tier: 1,
      });
      specDb.insertCandidate({
        candidate_id: `${productId}::${propertyKey}::value`,
        category: CATEGORY,
        product_id: productId,
        field_key: propertyKey,
        value: String(forceValue),
        normalized_value: String(forceValue),
        score: 0.88,
        rank: 1,
        source_host: 'contract.test',
        source_method: 'pipeline_extract',
        source_tier: 1,
      });
    };

    for (const productId of productsA) {
      linkAndSeedCandidates(productId, makerA, 55);
    }
    for (const productId of productsB) {
      linkAndSeedCandidates(productId, makerB, 65);
    }

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
            review_id: 'rv_switch_omron',
            category: CATEGORY,
            component_type: componentType,
            field_key: 'switch',
            raw_query: componentName,
            matched_component: componentName,
            match_type: 'exact',
            status: 'pending_ai',
            product_id: productsA[0],
            created_at: '2026-02-20T00:00:00.000Z',
            product_attributes: {
              switch_brand: makerA,
              [propertyKey]: '55',
            },
          },
          {
            review_id: 'rv_switch_huano',
            category: CATEGORY,
            component_type: componentType,
            field_key: 'switch',
            raw_query: componentName,
            matched_component: componentName,
            match_type: 'exact',
            status: 'pending_ai',
            product_id: productsB[0],
            created_at: '2026-02-20T00:00:01.000Z',
            product_attributes: {
              switch_brand: makerB,
              [propertyKey]: '65',
            },
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: helperRoot },
      category: CATEGORY,
      componentType,
      specDb,
    });
    const rowA = payload.items.find((item) => item.name === componentName && item.maker === makerA);
    const rowB = payload.items.find((item) => item.name === componentName && item.maker === makerB);

    assert.ok(rowA, 'expected maker A row');
    assert.ok(rowB, 'expected maker B row');
    assert.equal((rowA.linked_products || []).length, 2);
    assert.equal((rowB.linked_products || []).length, 2);

    const makerValuesA = new Set((rowA.maker_tracked?.candidates || []).map((candidate) => String(candidate?.value || '').trim()));
    const makerValuesB = new Set((rowB.maker_tracked?.candidates || []).map((candidate) => String(candidate?.value || '').trim()));
    assert.equal(makerValuesA.has(makerA), true);
    assert.equal(makerValuesA.has(makerB), false);
    assert.equal(makerValuesB.has(makerB), true);
    assert.equal(makerValuesB.has(makerA), false);

    const propCandidatesA = rowA.properties?.[propertyKey]?.candidates || [];
    const propCandidatesB = rowB.properties?.[propertyKey]?.candidates || [];
    assert.equal(propCandidatesA.length, 2);
    assert.equal(propCandidatesB.length, 2);
    assert.equal(propCandidatesA.every((candidate) => String(candidate?.value || '') === '55'), true);
    assert.equal(propCandidatesB.every((candidate) => String(candidate?.value || '') === '65'), true);
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
    const componentValueId = getComponentValueId(specDb, 'sensor', 'PAW3950', 'PixArt', 'dpi_max');
    assert.ok(componentValueId, 'expected component value slot id');
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      componentValueId,
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
      ...getEnumSlot(specDb, 'connection', 'Bluetooth'),
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
    const componentValueId = getComponentValueId(specDb, 'sensor', 'PAW3970', 'PixArt', 'dpi_max');
    assert.ok(componentValueId, 'expected component value slot id');
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      componentValueId,
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

test('enum payload hides pending pipeline values without linked products', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const linkedProductId = 'mouse-test-enum-linked';
    specDb.upsertListValue({
      fieldKey: 'connection',
      value: 'Bluetooth',
      normalizedValue: 'bluetooth',
      source: 'pipeline',
      enumPolicy: 'closed',
      acceptedCandidateId: null,
      needsReview: true,
      overridden: false,
      sourceTimestamp: '2026-02-18T00:00:00.000Z',
    });
    specDb.upsertListValue({
      fieldKey: 'connection',
      value: 'Wireless',
      normalizedValue: 'wireless',
      source: 'pipeline',
      enumPolicy: 'closed',
      acceptedCandidateId: null,
      needsReview: true,
      overridden: false,
      sourceTimestamp: '2026-02-18T00:00:00.000Z',
    });
    specDb.upsertItemFieldState({
      productId: linkedProductId,
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
      productId: linkedProductId,
      fieldKey: 'connection',
      value: 'Bluetooth',
    });

    const payload = await buildEnumReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      specDb,
    });
    const field = payload.fields.find((entry) => entry.field === 'connection');
    const values = (field?.values || []).map((entry) => String(entry?.value || ''));
    assert.equal(values.includes('Bluetooth'), true);
    assert.equal(values.includes('Wireless'), false);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});
