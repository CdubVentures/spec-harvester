import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStorage } from '../src/s3/storage.js';
import { SpecDb } from '../src/db/specDb.js';
import { loadQueueState, saveQueueState } from '../src/queue/queueState.js';
import {
  cascadeComponentChange,
  cascadeEnumChange,
  findProductsReferencingComponent,
} from '../src/review/componentImpact.js';

async function createHarness() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-component-impact-'));
  const outputRoot = path.join(tempRoot, 'out');
  const storage = createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: outputRoot,
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
  });

  const dbPath = path.join(tempRoot, 'spec.sqlite');
  const category = 'mouse';
  const specDb = new SpecDb({ dbPath, category });

  return { tempRoot, outputRoot, storage, specDb, category };
}

async function cleanupHarness(harness) {
  try {
    harness?.specDb?.close();
  } finally {
    await fs.rm(harness.tempRoot, { recursive: true, force: true });
  }
}

function upsertQueueRow(specDb, productId, status = 'complete') {
  specDb.upsertQueueProduct({
    product_id: productId,
    status,
    priority: 3,
    attempts_total: 0,
    retry_count: 0,
    max_attempts: 3,
  });
}

test('findProductsReferencingComponent includes linked and unlinked field-state matches', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-linked',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });

    h.specDb.upsertItemFieldState({
      productId: 'mouse-unlinked',
      fieldKey: 'sensor',
      value: 'PAW3950',
      confidence: 0.7,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    const affected = await findProductsReferencingComponent({
      outputRoot: h.outputRoot,
      category: h.category,
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      specDb: h.specDb,
    });

    const productIds = new Set(affected.map((row) => row.productId));
    assert.equal(productIds.has('mouse-linked'), true);
    assert.equal(productIds.has('mouse-unlinked'), true);
  } finally {
    await cleanupHarness(h);
  }
});

test('cascadeComponentChange authoritative updates all linked items and marks queue stale via SpecDb', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-a',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-b',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });

    upsertQueueRow(h.specDb, 'mouse-a', 'complete');
    upsertQueueRow(h.specDb, 'mouse-b', 'pending');
    h.specDb.upsertItemFieldState({
      productId: 'mouse-a',
      fieldKey: 'max_dpi',
      value: '26000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: 'mouse-a::max_dpi::legacy-candidate',
      overridden: false,
      needsAiReview: true,
      aiReviewComplete: false,
    });
    h.specDb.upsertItemFieldState({
      productId: 'mouse-b',
      fieldKey: 'max_dpi',
      value: '25000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: 'mouse-b::max_dpi::legacy-candidate',
      overridden: false,
      needsAiReview: true,
      aiReviewComplete: false,
    });

    const result = await cascadeComponentChange({
      storage: h.storage,
      outputRoot: h.outputRoot,
      category: h.category,
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      changedProperty: 'max_dpi',
      newValue: '35000',
      variancePolicy: 'authoritative',
      constraints: [],
      loadQueueState,
      saveQueueState,
      specDb: h.specDb,
    });

    assert.equal(result.propagation?.action, 'value_pushed');

    const stateA = h.specDb.getItemFieldState('mouse-a').find((row) => row.field_key === 'max_dpi');
    const stateB = h.specDb.getItemFieldState('mouse-b').find((row) => row.field_key === 'max_dpi');
    assert.equal(stateA?.value, '35000');
    assert.equal(stateB?.value, '35000');
    assert.equal(stateA?.accepted_candidate_id, null);
    assert.equal(stateB?.accepted_candidate_id, null);

    const queueA = h.specDb.getQueueProduct('mouse-a');
    const queueB = h.specDb.getQueueProduct('mouse-b');
    assert.equal(queueA?.status, 'stale');
    assert.equal(queueB?.status, 'stale');
    assert.equal(Array.isArray(queueA?.dirty_flags), true);
    assert.equal(queueA?.dirty_flags?.some((flag) => flag.reason === 'component_change'), true);
  } finally {
    await cleanupHarness(h);
  }
});

test('cascadeComponentChange authoritative updates linked items only (not unlinked value matches)', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-linked-only',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });

    h.specDb.upsertItemFieldState({
      productId: 'mouse-linked-only',
      fieldKey: 'max_dpi',
      value: '26000',
      confidence: 0.9,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    // Unlinked item that happens to have the same component field value.
    h.specDb.upsertItemFieldState({
      productId: 'mouse-unlinked-only',
      fieldKey: 'sensor',
      value: 'PAW3950',
      confidence: 0.7,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });
    h.specDb.upsertItemFieldState({
      productId: 'mouse-unlinked-only',
      fieldKey: 'max_dpi',
      value: '27000',
      confidence: 0.7,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    upsertQueueRow(h.specDb, 'mouse-linked-only', 'complete');
    upsertQueueRow(h.specDb, 'mouse-unlinked-only', 'complete');

    await cascadeComponentChange({
      storage: h.storage,
      outputRoot: h.outputRoot,
      category: h.category,
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      changedProperty: 'max_dpi',
      newValue: '35000',
      variancePolicy: 'authoritative',
      constraints: [],
      loadQueueState,
      saveQueueState,
      specDb: h.specDb,
    });

    const linked = h.specDb.getItemFieldState('mouse-linked-only').find((row) => row.field_key === 'max_dpi');
    const unlinked = h.specDb.getItemFieldState('mouse-unlinked-only').find((row) => row.field_key === 'max_dpi');
    assert.equal(linked?.value, '35000');
    assert.equal(unlinked?.value, '27000');

    const linkedQueue = h.specDb.getQueueProduct('mouse-linked-only');
    const unlinkedQueue = h.specDb.getQueueProduct('mouse-unlinked-only');
    assert.equal(linkedQueue?.status, 'stale');
    assert.equal(unlinkedQueue?.status, 'complete');
  } finally {
    await cleanupHarness(h);
  }
});

test('evaluateConstraintsForLinkedProducts uses maker-specific component values for violations', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-c',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'focus-pro',
      componentMaker: 'MakerA',
      matchType: 'exact',
      matchScore: 1,
    });

    h.specDb.upsertItemFieldState({
      productId: 'mouse-c',
      fieldKey: 'dpi',
      value: '1500',
      confidence: 0.9,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    h.specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'focus-pro',
      componentMaker: 'MakerA',
      propertyKey: 'max_dpi',
      value: '1000',
      confidence: 1,
      variancePolicy: null,
      source: 'component_db',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });

    // Same component name under a different maker with a looser limit.
    h.specDb.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'focus-pro',
      componentMaker: 'MakerB',
      propertyKey: 'max_dpi',
      value: '3000',
      confidence: 1,
      variancePolicy: null,
      source: 'component_db',
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      constraints: [],
    });

    const result = h.specDb.evaluateConstraintsForLinkedProducts(
      'sensor',
      'focus-pro',
      'MakerA',
      'dpi',
      ['dpi <= max_dpi']
    );

    assert.equal(result.violations.includes('mouse-c'), true);

    const dpiState = h.specDb.getItemFieldState('mouse-c').find((row) => row.field_key === 'dpi');
    assert.equal(dpiState?.needs_ai_review, 1);
  } finally {
    await cleanupHarness(h);
  }
});

test('cascadeEnumChange honors preAffectedProductIds for rename cascades', async () => {
  const h = await createHarness();
  try {
    upsertQueueRow(h.specDb, 'mouse-e', 'complete');
    upsertQueueRow(h.specDb, 'mouse-f', 'complete');

    // Simulate a rename already applied in DB before cascade step.
    h.specDb.upsertItemFieldState({
      productId: 'mouse-e',
      fieldKey: 'connection',
      value: 'Wireless',
      confidence: 1,
      source: 'known_values',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });
    h.specDb.upsertItemFieldState({
      productId: 'mouse-f',
      fieldKey: 'connection',
      value: 'Wireless',
      confidence: 1,
      source: 'known_values',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    const result = await cascadeEnumChange({
      storage: h.storage,
      outputRoot: h.outputRoot,
      category: h.category,
      field: 'connection',
      action: 'rename',
      value: '2.4ghz',
      newValue: 'Wireless',
      preAffectedProductIds: ['mouse-e', 'mouse-f'],
      loadQueueState,
      saveQueueState,
      specDb: h.specDb,
    });

    assert.equal(result.cascaded, 2);

    const queueE = h.specDb.getQueueProduct('mouse-e');
    const queueF = h.specDb.getQueueProduct('mouse-f');
    assert.equal(queueE?.status, 'stale');
    assert.equal(queueF?.status, 'stale');
    assert.equal(queueE?.dirty_flags?.some((flag) => flag.reason === 'enum_renamed'), true);
    assert.equal(queueF?.dirty_flags?.some((flag) => flag.reason === 'enum_renamed'), true);
  } finally {
    await cleanupHarness(h);
  }
});

test('item enum field writes stay ID-linked via item_list_links and list deletes clear links', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertListValue({
      fieldKey: 'connection',
      value: '2.4GHz',
      normalizedValue: '2.4ghz',
      source: 'known_values',
      enumPolicy: null,
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      sourceTimestamp: new Date().toISOString(),
    });

    h.specDb.upsertItemFieldState({
      productId: 'mouse-link-test',
      fieldKey: 'connection',
      value: '2.4GHz',
      confidence: 1,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    const linkedRow = h.specDb.syncItemListLinkForFieldValue({
      productId: 'mouse-link-test',
      fieldKey: 'connection',
      value: '2.4GHz',
    });
    assert.equal(Boolean(linkedRow?.id), true);

    const linksBeforeDelete = h.specDb.getItemListLinks('mouse-link-test');
    assert.equal(linksBeforeDelete.length, 1);

    h.specDb.deleteListValue('connection', '2.4GHz');

    const linksAfterDelete = h.specDb.getItemListLinks('mouse-link-test');
    assert.equal(linksAfterDelete.length, 0);
  } finally {
    await cleanupHarness(h);
  }
});

test('cascadeComponentChange override_allowed does not push values and does not evaluate variance', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-override-a',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-override-b',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });

    upsertQueueRow(h.specDb, 'mouse-override-a', 'complete');
    upsertQueueRow(h.specDb, 'mouse-override-b', 'complete');

    h.specDb.upsertItemFieldState({
      productId: 'mouse-override-a',
      fieldKey: 'max_dpi',
      value: '26000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });
    h.specDb.upsertItemFieldState({
      productId: 'mouse-override-b',
      fieldKey: 'max_dpi',
      value: '30000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    const result = await cascadeComponentChange({
      storage: h.storage,
      outputRoot: h.outputRoot,
      category: h.category,
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      changedProperty: 'max_dpi',
      newValue: '35000',
      variancePolicy: 'override_allowed',
      constraints: [],
      loadQueueState,
      saveQueueState,
      specDb: h.specDb,
    });

    assert.equal(result.propagation?.action, 'stale_only',
      'override_allowed must NOT push values or evaluate variance — action stays stale_only');
    assert.deepEqual(result.propagation?.updated, [],
      'no values should be pushed');
    assert.deepEqual(result.propagation?.violations, [],
      'no violations should be flagged');

    const stateA = h.specDb.getItemFieldState('mouse-override-a').find((row) => row.field_key === 'max_dpi');
    const stateB = h.specDb.getItemFieldState('mouse-override-b').find((row) => row.field_key === 'max_dpi');
    assert.equal(stateA?.value, '26000',
      'product A value must NOT be overwritten by override_allowed cascade');
    assert.equal(stateB?.value, '30000',
      'product B value must NOT be overwritten by override_allowed cascade');

    const queueA = h.specDb.getQueueProduct('mouse-override-a');
    const queueB = h.specDb.getQueueProduct('mouse-override-b');
    assert.equal(queueA?.status, 'stale',
      'queue entry should still be marked stale');
    assert.equal(queueB?.status, 'stale',
      'queue entry should still be marked stale');
  } finally {
    await cleanupHarness(h);
  }
});

test('cascadeComponentChange override_allowed uses priority 3 (lowest)', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-pri',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });

    upsertQueueRow(h.specDb, 'mouse-pri', 'complete');

    h.specDb.upsertItemFieldState({
      productId: 'mouse-pri',
      fieldKey: 'max_dpi',
      value: '26000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    await cascadeComponentChange({
      storage: h.storage,
      outputRoot: h.outputRoot,
      category: h.category,
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      changedProperty: 'max_dpi',
      newValue: '35000',
      variancePolicy: 'override_allowed',
      constraints: [],
      loadQueueState,
      saveQueueState,
      specDb: h.specDb,
    });

    const queue = h.specDb.getQueueProduct('mouse-pri');
    assert.equal(queue?.priority, 3,
      'override_allowed cascade must use priority 3 (lowest)');
  } finally {
    await cleanupHarness(h);
  }
});

test('cascadeComponentChange override_allowed with constraints still evaluates constraints', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertItemComponentLink({
      productId: 'mouse-oc',
      fieldKey: 'sensor',
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      matchType: 'exact',
      matchScore: 1,
    });

    upsertQueueRow(h.specDb, 'mouse-oc', 'complete');

    h.specDb.upsertComponentValue({
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

    h.specDb.upsertItemFieldState({
      productId: 'mouse-oc',
      fieldKey: 'dpi',
      value: '40000',
      confidence: 0.8,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    const result = await cascadeComponentChange({
      storage: h.storage,
      outputRoot: h.outputRoot,
      category: h.category,
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      changedProperty: 'max_dpi',
      newValue: '35000',
      variancePolicy: 'override_allowed',
      constraints: ['dpi <= max_dpi'],
      loadQueueState,
      saveQueueState,
      specDb: h.specDb,
    });

    assert.equal(result.propagation?.action, 'stale_only',
      'override_allowed does not change action even with constraints');
    assert.equal(Array.isArray(result.propagation?.constraint_violations), true,
      'constraint_violations should be populated');
  } finally {
    await cleanupHarness(h);
  }
});

test('enum list value ID helpers rename and delete through slot identifiers', async () => {
  const h = await createHarness();
  try {
    h.specDb.upsertListValue({
      fieldKey: 'connection',
      value: '2.4GHz',
      normalizedValue: '2.4ghz',
      source: 'known_values',
      enumPolicy: null,
      acceptedCandidateId: null,
      needsReview: false,
      overridden: false,
      sourceTimestamp: new Date().toISOString(),
    });

    h.specDb.upsertItemFieldState({
      productId: 'mouse-link-id-test',
      fieldKey: 'connection',
      value: '2.4GHz',
      confidence: 1,
      source: 'pipeline',
      acceptedCandidateId: null,
      overridden: false,
      needsAiReview: false,
      aiReviewComplete: false,
    });

    h.specDb.syncItemListLinkForFieldValue({
      productId: 'mouse-link-id-test',
      fieldKey: 'connection',
      value: '2.4GHz',
    });

    const oldRow = h.specDb.getListValueByFieldAndValue('connection', '2.4GHz');
    assert.equal(Boolean(oldRow?.id), true);

    const affected = h.specDb.renameListValueById(oldRow.id, 'Wireless', new Date().toISOString());
    assert.equal(affected.includes('mouse-link-id-test'), true);

    const fieldState = h.specDb.getItemFieldState('mouse-link-id-test')
      .find((row) => row.field_key === 'connection');
    assert.equal(fieldState?.value, 'Wireless');

    const renamedRow = h.specDb.getListValueByFieldAndValue('connection', 'Wireless');
    assert.equal(Boolean(renamedRow?.id), true);

    const linksAfterRename = h.specDb.getItemListLinks('mouse-link-id-test');
    assert.equal(linksAfterRename.length, 1);
    assert.equal(linksAfterRename[0]?.list_value_id, renamedRow.id);

    h.specDb.deleteListValueById(renamedRow.id);
    const linksAfterDelete = h.specDb.getItemListLinks('mouse-link-id-test');
    assert.equal(linksAfterDelete.length, 0);
  } finally {
    await cleanupHarness(h);
  }
});
