import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpecDb } from '../src/db/specDb.js';
import { buildComponentIdentifier } from '../src/utils/componentIdentifier.js';
import { buildComponentReviewLayout, buildComponentReviewPayloads, buildEnumReviewPayloads, resolvePropertyFieldMeta } from '../src/review/componentReviewData.js';
import { applySharedLaneState } from '../src/review/keyReviewState.js';

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

test('component layout item_count matches visible payload rows', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const helperRoot = path.join(tempRoot, 'helper_files');
    const config = { helperFilesRoot: helperRoot };
    const componentType = 'sensor';

    // Visible row: linked product exists.
    specDb.upsertComponentIdentity({
      componentType,
      canonicalName: 'PAW3950',
      maker: 'PixArt',
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType,
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
      productId: 'mouse-layout-visible',
      fieldKey: 'sensor',
      componentType,
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });

    // Hidden row: discovered pipeline row with no linked products/candidates.
    specDb.upsertComponentIdentity({
      componentType,
      canonicalName: 'PAW3950 Hidden',
      maker: 'PixArt',
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType,
      componentName: 'PAW3950 Hidden',
      componentMaker: 'PixArt',
      propertyKey: 'dpi_max',
      value: null,
      confidence: 0,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });

    const payload = await buildComponentReviewPayloads({
      config,
      category: CATEGORY,
      componentType,
      specDb,
    });
    const layout = await buildComponentReviewLayout({
      config,
      category: CATEGORY,
      specDb,
    });
    const typeRow = (layout.types || []).find((row) => row.type === componentType);

    assert.ok(typeRow, 'expected sensor type in layout');
    assert.equal(Number(typeRow.item_count || 0), (payload.items || []).length);
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

test('component payload keeps a single row per exact component name+maker identity', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const componentType = 'switch';
    const componentName = 'Omron D2FC-F-7N';
    const componentMaker = 'Omron';
    const propertyKey = 'actuation_force';

    specDb.upsertComponentIdentity({
      componentType,
      canonicalName: componentName,
      maker: componentMaker,
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentIdentity({
      componentType,
      canonicalName: componentName,
      maker: componentMaker,
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType,
      componentName,
      componentMaker,
      propertyKey,
      value: '55',
      confidence: 1,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-dup-row-a',
      fieldKey: 'switch',
      componentType,
      componentName,
      componentMaker,
      matchType: 'shared_accept',
      matchScore: 1,
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-dup-row-b',
      fieldKey: 'switch',
      componentType,
      componentName,
      componentMaker,
      matchType: 'shared_accept',
      matchScore: 1,
    });

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType,
      specDb,
    });
    const rows = (payload.items || []).filter(
      (item) => item.name === componentName && item.maker === componentMaker,
    );
    assert.equal(rows.length, 1);
    assert.equal((rows[0]?.linked_products || []).length, 2);
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

test('component payload aggregates candidates from ALL linked products for EVERY slot type', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const componentType = 'sensor';
    const componentName = 'PAW3950';
    const componentMaker = 'PixArt';
    const propertyKeys = ['dpi_max', 'ips', 'acceleration'];
    const productIds = ['mouse-agg-p1', 'mouse-agg-p2', 'mouse-agg-p3'];

    specDb.upsertComponentIdentity({
      componentType,
      canonicalName: componentName,
      maker: componentMaker,
      links: [],
      source: 'pipeline',
    });

    for (const propKey of propertyKeys) {
      specDb.upsertComponentValue({
        componentType,
        componentName,
        componentMaker,
        propertyKey: propKey,
        value: '1000',
        confidence: 1,
        variancePolicy: null,
        source: 'pipeline',
        acceptedCandidateId: null,
        needsReview: true,
        overridden: false,
        constraints: [],
      });
    }

    for (const productId of productIds) {
      specDb.upsertItemComponentLink({
        productId,
        fieldKey: 'sensor',
        componentType,
        componentName,
        componentMaker,
        matchType: 'exact',
        matchScore: 1,
      });

      specDb.insertCandidate({
        candidate_id: `${productId}::sensor::name_a`,
        category: CATEGORY,
        product_id: productId,
        field_key: 'sensor',
        value: componentName,
        normalized_value: componentName.toLowerCase(),
        score: 0.95,
        rank: 1,
        source_host: 'contract.test',
        source_method: 'pipeline_extract',
        source_tier: 1,
      });
      specDb.insertCandidate({
        candidate_id: `${productId}::sensor::name_b`,
        category: CATEGORY,
        product_id: productId,
        field_key: 'sensor',
        value: componentName,
        normalized_value: componentName.toLowerCase(),
        score: 0.85,
        rank: 2,
        source_host: 'review.test',
        source_method: 'llm_extract',
        source_tier: 2,
      });

      specDb.insertCandidate({
        candidate_id: `${productId}::sensor_brand::maker_a`,
        category: CATEGORY,
        product_id: productId,
        field_key: 'sensor_brand',
        value: componentMaker,
        normalized_value: componentMaker.toLowerCase(),
        score: 0.9,
        rank: 1,
        source_host: 'contract.test',
        source_method: 'pipeline_extract',
        source_tier: 1,
      });
      specDb.insertCandidate({
        candidate_id: `${productId}::sensor_brand::maker_b`,
        category: CATEGORY,
        product_id: productId,
        field_key: 'sensor_brand',
        value: componentMaker,
        normalized_value: componentMaker.toLowerCase(),
        score: 0.8,
        rank: 2,
        source_host: 'review.test',
        source_method: 'llm_extract',
        source_tier: 2,
      });

      for (const propKey of propertyKeys) {
        specDb.insertCandidate({
          candidate_id: `${productId}::${propKey}::prop_a`,
          category: CATEGORY,
          product_id: productId,
          field_key: propKey,
          value: '1000',
          normalized_value: '1000',
          score: 0.88,
          rank: 1,
          source_host: 'contract.test',
          source_method: 'pipeline_extract',
          source_tier: 1,
          is_component_field: true,
          component_type: componentType,
        });
        specDb.insertCandidate({
          candidate_id: `${productId}::${propKey}::prop_b`,
          category: CATEGORY,
          product_id: productId,
          field_key: propKey,
          value: '1000',
          normalized_value: '1000',
          score: 0.75,
          rank: 2,
          source_host: 'review.test',
          source_method: 'llm_extract',
          source_tier: 2,
          is_component_field: true,
          component_type: componentType,
        });
      }
    }

    const helperRoot = path.join(tempRoot, 'helper_files');
    const reviewPath = path.join(helperRoot, CATEGORY, '_suggestions', 'component_review.json');
    await fs.mkdir(path.dirname(reviewPath), { recursive: true });
    await fs.writeFile(reviewPath, JSON.stringify({ version: 1, category: CATEGORY, items: [] }, null, 2), 'utf8');

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: helperRoot },
      category: CATEGORY,
      componentType,
      specDb,
    });

    const row = payload.items.find((item) => item.name === componentName && item.maker === componentMaker);
    assert.ok(row, 'expected component row');
    assert.equal((row.linked_products || []).length, 3, 'expected 3 linked products');

    assert.equal(row.name_tracked.candidates.length, 6, 'name slot should have 6 candidates (2 per product x 3 products)');
    assert.equal(row.name_tracked.candidate_count, row.name_tracked.candidates.length, 'name candidate_count must match candidates.length');

    assert.equal(row.maker_tracked.candidates.length, 6, 'maker slot should have 6 candidates (2 per product x 3 products)');
    assert.equal(row.maker_tracked.candidate_count, row.maker_tracked.candidates.length, 'maker candidate_count must match candidates.length');

    for (const propKey of propertyKeys) {
      const prop = row.properties?.[propKey];
      assert.ok(prop, `property ${propKey} should exist`);
      assert.equal(prop.candidates.length, 6, `${propKey} should have 6 candidates (2 per product x 3 products)`);
      assert.equal(prop.candidate_count, prop.candidates.length, `${propKey} candidate_count must match candidates.length`);
    }
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('candidate_count equals candidates.length for every slot in component payload', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const componentType = 'switch';
    const componentName = 'TTC Gold';
    const componentMaker = 'TTC';
    const propertyKey = 'actuation_force';

    specDb.upsertComponentIdentity({
      componentType,
      canonicalName: componentName,
      maker: componentMaker,
      links: [],
      source: 'pipeline',
    });
    specDb.upsertComponentValue({
      componentType,
      componentName,
      componentMaker,
      propertyKey,
      value: '50',
      confidence: 1,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: true,
      overridden: false,
      constraints: [],
    });

    specDb.upsertItemComponentLink({
      productId: 'mouse-ttc-1',
      fieldKey: 'switch',
      componentType,
      componentName,
      componentMaker,
      matchType: 'exact',
      matchScore: 1,
    });
    specDb.insertCandidate({
      candidate_id: 'mouse-ttc-1::switch::name',
      category: CATEGORY,
      product_id: 'mouse-ttc-1',
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
      candidate_id: 'mouse-ttc-1::switch_brand::maker',
      category: CATEGORY,
      product_id: 'mouse-ttc-1',
      field_key: 'switch_brand',
      value: componentMaker,
      normalized_value: componentMaker.toLowerCase(),
      score: 0.9,
      rank: 1,
      source_host: 'contract.test',
      source_method: 'pipeline_extract',
      source_tier: 1,
    });
    specDb.insertCandidate({
      candidate_id: 'mouse-ttc-1::actuation_force::value',
      category: CATEGORY,
      product_id: 'mouse-ttc-1',
      field_key: propertyKey,
      value: '50',
      normalized_value: '50',
      score: 0.88,
      rank: 1,
      source_host: 'contract.test',
      source_method: 'pipeline_extract',
      source_tier: 1,
      is_component_field: true,
      component_type: componentType,
    });

    const helperRoot = path.join(tempRoot, 'helper_files');
    const reviewPath = path.join(helperRoot, CATEGORY, '_suggestions', 'component_review.json');
    await fs.mkdir(path.dirname(reviewPath), { recursive: true });
    await fs.writeFile(reviewPath, JSON.stringify({ version: 1, category: CATEGORY, items: [] }, null, 2), 'utf8');

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: helperRoot },
      category: CATEGORY,
      componentType,
      specDb,
    });

    for (const row of payload.items) {
      assert.equal(row.name_tracked.candidate_count, row.name_tracked.candidates.length,
        `${row.name}/${row.maker}: name candidate_count (${row.name_tracked.candidate_count}) must match candidates.length (${row.name_tracked.candidates.length})`);
      assert.equal(row.maker_tracked.candidate_count, row.maker_tracked.candidates.length,
        `${row.name}/${row.maker}: maker candidate_count (${row.maker_tracked.candidate_count}) must match candidates.length (${row.maker_tracked.candidates.length})`);
      for (const [key, prop] of Object.entries(row.properties || {})) {
        assert.equal(prop.candidate_count, prop.candidates.length,
          `${row.name}/${row.maker}/${key}: candidate_count (${prop.candidate_count}) must match candidates.length (${prop.candidates.length})`);
      }
    }
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

// ══════════════════════════════════════════════════════════════════════
// EDGE CASE: :: delimiter in component names
// ══════════════════════════════════════════════════════════════════════

test('edge case — :: delimiter in component name produces ambiguous identifier', () => {
  const identifier = buildComponentIdentifier('sensor', 'Type::A::Model', 'Maker::X');
  assert.strictEqual(identifier, 'sensor::Type::A::Model::Maker::X');

  const parts = identifier.split('::');
  assert.ok(parts.length > 3,
    `identifier with :: in name/maker splits into ${parts.length} parts, making naive split('::') ambiguous`);
});

test('edge case — safe identifiers have exactly 3 :: delimited parts', () => {
  const safeId = buildComponentIdentifier('sensor', 'PAW3950', 'PixArt');
  const safeParts = safeId.split('::');
  assert.strictEqual(safeParts.length, 3,
    'safe identifier should have exactly 3 parts when split on ::');

  const ambiguousId = buildComponentIdentifier('sensor', 'PAW::3950', 'PixArt');
  const ambiguousParts = ambiguousId.split('::');
  assert.ok(ambiguousParts.length > 3,
    'identifier with :: in name produces >3 parts, signaling ambiguity');
});

// ══════════════════════════════════════════════════════════════════════
// EDGE CASE: Confidence boundary values
// ══════════════════════════════════════════════════════════════════════

test('edge case — confidence boundary values map to correct colors', async () => {
  const { confidenceColor } = await import('../src/review/confidenceColor.js');

  assert.strictEqual(confidenceColor(0.0, []), 'gray', 'confidence 0.0 should be gray');
  assert.strictEqual(confidenceColor(0.5, []), 'red', 'confidence 0.5 should be red');
  assert.strictEqual(confidenceColor(0.59, []), 'red', 'confidence 0.59 should be red');
  assert.strictEqual(confidenceColor(0.6, []), 'yellow', 'confidence 0.6 should be yellow');
  assert.strictEqual(confidenceColor(0.8, []), 'yellow', 'confidence 0.8 should be yellow');
  assert.strictEqual(confidenceColor(0.84, []), 'yellow', 'confidence 0.84 should be yellow');
  assert.strictEqual(confidenceColor(0.85, []), 'green', 'confidence 0.85 should be green');
  assert.strictEqual(confidenceColor(1.0, []), 'green', 'confidence 1.0 should be green');
});

test('edge case — confidence boundaries in component payload slots', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const componentType = 'sensor';
    const boundaries = [
      { name: 'ZeroConf', confidence: 0, expected: 'gray' },
      { name: 'LowConf', confidence: 0.5, expected: 'red' },
      { name: 'MidConf', confidence: 0.8, expected: 'yellow' },
      { name: 'HighConf', confidence: 1.0, expected: 'green' },
    ];

    for (const { name, confidence } of boundaries) {
      specDb.upsertComponentIdentity({
        componentType,
        canonicalName: name,
        maker: 'TestMaker',
        links: null,
        source: 'test',
      });
      specDb.upsertComponentValue({
        componentType,
        componentName: name,
        componentMaker: 'TestMaker',
        propertyKey: 'dpi_max',
        value: '16000',
        confidence,
        variancePolicy: null,
        source: 'pipeline',
        acceptedCandidateId: null,
        needsReview: confidence < 0.85,
        overridden: false,
        constraints: [],
      });
    }

    const helperRoot = path.join(tempRoot, 'helper_files');
    const reviewPath = path.join(helperRoot, CATEGORY, '_suggestions', 'component_review.json');
    await fs.mkdir(path.dirname(reviewPath), { recursive: true });
    await fs.writeFile(reviewPath, JSON.stringify({ version: 1, category: CATEGORY, items: [] }, null, 2), 'utf8');

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: helperRoot },
      category: CATEGORY,
      componentType,
      specDb,
    });

    for (const { name, expected } of boundaries) {
      const row = payload.items.find(r => r.name === name);
      assert.ok(row, `row for ${name} should exist`);
      const prop = row.properties?.dpi_max;
      if (prop?.selected?.color) {
        assert.strictEqual(prop.selected.color, expected,
          `${name} with boundary confidence should map to ${expected}, got ${prop.selected.color}`);
      }
    }
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

// ══════════════════════════════════════════════════════════════════════
// EDGE CASE: Enum values that normalize to the same token
// ══════════════════════════════════════════════════════════════════════

test('edge case — enum values with different casing are stored as distinct rows', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertListValue({
      fieldKey: 'connection',
      value: '2.4GHz',
      normalizedValue: '2.4ghz',
      source: 'known_values',
      needsReview: false,
      overridden: false,
    });

    specDb.upsertListValue({
      fieldKey: 'connection',
      value: '2.4ghz',
      normalizedValue: '2.4ghz',
      source: 'pipeline',
      needsReview: true,
      overridden: false,
    });

    const allValues = specDb.getListValues('connection');
    assert.strictEqual(allValues.length, 2,
      'both casing variants should be stored as separate list_values rows');

    const normalizedValues = allValues.map(v => v.normalized_value);
    assert.deepStrictEqual(normalizedValues, ['2.4ghz', '2.4ghz'],
      'both rows should share the same normalized_value');

    const distinctValues = new Set(allValues.map(v => v.value));
    assert.strictEqual(distinctValues.size, 2,
      'the display values should remain distinct');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

// ── resolvePropertyFieldMeta pure function tests ─────────────────────────────

test('resolvePropertyFieldMeta returns variance_policy and constraints from field definition', () => {
  const fieldRules = {
    rules: {
      fields: {
        dpi: {
          variance_policy: 'upper_bound',
          constraints: [],
        },
      },
    },
    knownValues: { enums: {} },
  };
  const result = resolvePropertyFieldMeta('dpi', fieldRules);
  assert.deepStrictEqual(result, {
    variance_policy: 'upper_bound',
    constraints: [],
    enum_values: null,
    enum_policy: null,
  });
});

test('resolvePropertyFieldMeta returns enum_values and enum_policy for enum fields', () => {
  const fieldRules = {
    rules: {
      fields: {
        encoder_type: {
          variance_policy: 'authoritative',
          constraints: [],
          enum: { policy: 'closed', source: 'data_lists.encoder_type' },
        },
      },
    },
    knownValues: {
      enums: {
        encoder_type: { policy: 'closed', values: ['optical', 'mechanical'] },
      },
    },
  };
  const result = resolvePropertyFieldMeta('encoder_type', fieldRules);
  assert.deepStrictEqual(result, {
    variance_policy: 'authoritative',
    constraints: [],
    enum_values: ['optical', 'mechanical'],
    enum_policy: 'closed',
  });
});

test('resolvePropertyFieldMeta returns null for unknown key', () => {
  const fieldRules = {
    rules: { fields: { dpi: { variance_policy: 'upper_bound', constraints: [] } } },
    knownValues: { enums: {} },
  };
  assert.strictEqual(resolvePropertyFieldMeta('nonexistent_key', fieldRules), null);
});

test('resolvePropertyFieldMeta returns null for identity key __name', () => {
  const fieldRules = {
    rules: { fields: { __name: { variance_policy: null, constraints: [] } } },
    knownValues: { enums: {} },
  };
  assert.strictEqual(resolvePropertyFieldMeta('__name', fieldRules), null);
});

test('component payload inherits constraints from field rules, not DB row', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'TestSensor',
      maker: 'TestMaker',
      links: [],
      source: 'component_db',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'TestSensor',
      componentMaker: 'TestMaker',
      propertyKey: 'sensor_date',
      value: '2024-01',
      confidence: 1,
      variancePolicy: 'authoritative',
      source: 'component_db',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: null,
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-test-constraints',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'TestSensor',
      componentMaker: 'TestMaker',
      matchType: 'exact',
      matchScore: 1,
    });

    const fieldRules = {
      rules: {
        fields: {
          sensor_date: {
            variance_policy: 'authoritative',
            constraints: ['sensor_date <= release_date'],
          },
        },
      },
      knownValues: { enums: {} },
    };

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
      fieldRules,
    });
    const row = payload.items.find(item => item.name === 'TestSensor' && item.maker === 'TestMaker');
    assert.ok(row, 'expected TestSensor/TestMaker row');
    assert.deepStrictEqual(row.properties.sensor_date.constraints, ['sensor_date <= release_date'],
      'constraints should come from field rules');
    assert.strictEqual(row.properties.sensor_date.variance_policy, 'authoritative',
      'variance_policy should come from DB row (component-level)');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('component payload includes enum_values and enum_policy from field rules', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'encoder',
      canonicalName: 'TestEncoder',
      maker: 'TestMaker',
      links: [],
      source: 'component_db',
    });
    specDb.upsertComponentValue({
      componentType: 'encoder',
      componentName: 'TestEncoder',
      componentMaker: 'TestMaker',
      propertyKey: 'encoder_steps',
      value: '20',
      confidence: 1,
      variancePolicy: 'authoritative',
      source: 'component_db',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-test-enum',
      fieldKey: 'encoder',
      componentType: 'encoder',
      componentName: 'TestEncoder',
      componentMaker: 'TestMaker',
      matchType: 'exact',
      matchScore: 1,
    });

    const fieldRules = {
      rules: {
        fields: {
          encoder_steps: {
            variance_policy: 'authoritative',
            constraints: [],
            enum: { policy: 'closed', source: 'data_lists.encoder_steps' },
          },
        },
      },
      knownValues: {
        enums: {
          encoder_steps: { policy: 'closed', values: ['5', '16', '18', '20', '24'] },
        },
      },
    };

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'encoder',
      specDb,
      fieldRules,
    });
    const row = payload.items.find(item => item.name === 'TestEncoder');
    assert.ok(row, 'expected TestEncoder row');
    assert.deepStrictEqual(row.properties.encoder_steps.enum_values, ['5', '16', '18', '20', '24'],
      'enum_values should come from field rules');
    assert.strictEqual(row.properties.encoder_steps.enum_policy, 'closed',
      'enum_policy should come from field rules');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('override_allowed property skips variance evaluation — no violation flags despite value mismatch', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'PAW3950',
      maker: 'PixArt',
      links: [],
      source: 'component_db',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      propertyKey: 'max_dpi',
      value: '35000',
      confidence: 1,
      variancePolicy: 'override_allowed',
      source: 'component_db',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-override-test',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });
    specDb.upsertItemFieldState({
      productId: 'mouse-override-test',
      fieldKey: 'max_dpi',
      value: '26000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    const fieldRules = {
      rules: {
        fields: {
          max_dpi: {
            variance_policy: 'override_allowed',
            constraints: [],
          },
        },
      },
      knownValues: { enums: {} },
    };

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
      fieldRules,
    });
    const row = payload.items.find(item => item.name === 'PAW3950');
    assert.ok(row, 'expected PAW3950 row');
    const prop = row.properties.max_dpi;
    assert.ok(prop, 'expected max_dpi property');
    assert.strictEqual(prop.variance_policy, 'override_allowed',
      'property should carry override_allowed policy');
    assert.strictEqual(prop.reason_codes.includes('variance_violation'), false,
      'override_allowed must NOT produce variance_violation reason code');
    assert.strictEqual(prop.variance_violations, undefined,
      'override_allowed must NOT populate variance_violations');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('authoritative property DOES flag variance violation for same mismatch scenario', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertComponentIdentity({
      componentType: 'sensor',
      canonicalName: 'PAW3950',
      maker: 'PixArt',
      links: [],
      source: 'component_db',
    });
    specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      propertyKey: 'max_dpi',
      value: '35000',
      confidence: 1,
      variancePolicy: 'authoritative',
      source: 'component_db',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });
    specDb.upsertItemComponentLink({
      productId: 'mouse-auth-test',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });
    specDb.upsertItemFieldState({
      productId: 'mouse-auth-test',
      fieldKey: 'max_dpi',
      value: '26000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    const fieldRules = {
      rules: {
        fields: {
          max_dpi: {
            variance_policy: 'authoritative',
            constraints: [],
          },
        },
      },
      knownValues: { enums: {} },
    };

    const payload = await buildComponentReviewPayloads({
      config: { helperFilesRoot: path.join(tempRoot, 'helper_files') },
      category: CATEGORY,
      componentType: 'sensor',
      specDb,
      fieldRules,
    });
    const row = payload.items.find(item => item.name === 'PAW3950');
    assert.ok(row, 'expected PAW3950 row');
    const prop = row.properties.max_dpi;
    assert.ok(prop, 'expected max_dpi property');
    assert.strictEqual(prop.variance_policy, 'authoritative',
      'property should carry authoritative policy');
    assert.strictEqual(prop.reason_codes.includes('variance_violation'), true,
      'authoritative mismatch MUST produce variance_violation');
    assert.ok(prop.variance_violations,
      'authoritative mismatch MUST populate variance_violations');
    assert.strictEqual(prop.variance_violations.count, 1,
      'one product has a mismatched value');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

// ══════════════════════════════════════════════════════════════════════
// G8: applySharedLaneState transaction atomicity
// ══════════════════════════════════════════════════════════════════════

test('G8 — applySharedLaneState returned row matches DB state (atomic write)', async () => {
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
      confidence: 0.9,
      variancePolicy: null,
      source: 'pipeline',
      acceptedCandidateId: null,
      needsReview: true,
      overridden: false,
      constraints: [],
    });
    const componentIdentifier = buildComponentIdentifier('sensor', 'PAW3950', 'PixArt');
    const componentValueId = getComponentValueId(specDb, 'sensor', 'PAW3950', 'PixArt', 'dpi_max');
    assert.ok(componentValueId, 'expected component value slot id');

    const resultA = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      componentValueId,
      selectedCandidateId: 'cand_a',
      selectedValue: '35000',
      confidenceScore: 0.9,
      laneAction: 'accept',
    });
    assert.ok(resultA, 'accept should return a state row');
    assert.equal(resultA.user_accept_shared_status, 'accepted');
    assert.equal(resultA.ai_confirm_shared_status, 'pending');
    assert.equal(resultA.selected_value, '35000');
    assert.equal(resultA.selected_candidate_id, 'cand_a');

    const dbRowAfterAccept = specDb.db.prepare(
      'SELECT * FROM key_review_state WHERE id = ?'
    ).get(resultA.id);
    assert.equal(dbRowAfterAccept.selected_value, resultA.selected_value,
      'returned row must match DB state — no partial writes');
    assert.equal(dbRowAfterAccept.user_accept_shared_status, resultA.user_accept_shared_status);
    assert.equal(dbRowAfterAccept.ai_confirm_shared_status, resultA.ai_confirm_shared_status);

    const resultB = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      componentValueId,
      selectedCandidateId: 'cand_b',
      selectedValue: '35000',
      confidenceScore: 0.95,
      laneAction: 'confirm',
    });
    assert.ok(resultB, 'confirm should return a state row');
    assert.equal(resultB.ai_confirm_shared_status, 'confirmed');

    const dbRowAfterConfirm = specDb.db.prepare(
      'SELECT * FROM key_review_state WHERE id = ?'
    ).get(resultB.id);
    assert.equal(dbRowAfterConfirm.ai_confirm_shared_status, resultB.ai_confirm_shared_status,
      'returned row must match DB state after confirm — no partial writes');
    assert.equal(dbRowAfterConfirm.ai_confirm_shared_confidence, 1.0);

    const resultC = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      componentValueId,
      selectedCandidateId: 'cand_c',
      selectedValue: '26000',
      confidenceScore: 0.92,
      laneAction: 'accept',
    });
    assert.ok(resultC, 'second accept with changed value should return a state row');
    assert.equal(resultC.selected_value, '26000');
    assert.equal(resultC.selected_candidate_id, 'cand_c');
    assert.equal(resultC.user_accept_shared_status, 'accepted');
    assert.equal(resultC.ai_confirm_shared_status, 'pending',
      'accept with changed selection should regress confirmed -> pending');

    const dbRowAfterSecondAccept = specDb.db.prepare(
      'SELECT * FROM key_review_state WHERE id = ?'
    ).get(resultC.id);
    assert.equal(dbRowAfterSecondAccept.selected_value, '26000');
    assert.equal(dbRowAfterSecondAccept.ai_confirm_shared_status, 'pending');
    assert.equal(dbRowAfterSecondAccept.user_accept_shared_status, 'accepted');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});
