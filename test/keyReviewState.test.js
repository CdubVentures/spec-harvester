import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpecDb } from '../src/db/specDb.js';
import { applySharedLaneState } from '../src/review/keyReviewState.js';

const CATEGORY = 'mouse';

async function createTempSpecDb() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'key-review-state-'));
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

test('applySharedLaneState(confirm) does not change selected candidate/value or clear shared accept', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const id = specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'wireless',
      selectedValue: 'Wireless',
      selectedCandidateId: 'cand_wireless',
      confidenceScore: 0.92,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: 'accepted',
    });

    const updated = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'wireless',
      selectedCandidateId: 'cand_bluetooth',
      selectedValue: 'Bluetooth',
      confidenceScore: 0.31,
      laneAction: 'confirm',
    });

    assert.equal(updated.id, id);
    assert.equal(updated.selected_candidate_id, 'cand_wireless');
    assert.equal(updated.selected_value, 'Wireless');
    assert.equal(updated.user_accept_shared_status, 'accepted');
    assert.equal(updated.ai_confirm_shared_status, 'confirmed');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('applySharedLaneState(accept) updates selected candidate/value and does not auto-confirm', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: '__maker',
      componentIdentifier: 'sensor::paw3950::pixart',
      propertyKey: '__maker',
      selectedValue: 'PixArt',
      selectedCandidateId: null,
      confidenceScore: 0.5,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });

    const updated = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: '__maker',
      componentIdentifier: 'sensor::paw3950::pixart',
      propertyKey: '__maker',
      selectedCandidateId: 'cand_pixart',
      selectedValue: 'PixArt',
      confidenceScore: 1,
      laneAction: 'accept',
    });

    assert.equal(updated.selected_candidate_id, 'cand_pixart');
    assert.equal(updated.selected_value, 'PixArt');
    assert.equal(updated.user_accept_shared_status, 'accepted');
    assert.equal(updated.ai_confirm_shared_status, 'pending');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('applySharedLaneState(accept) preserves confirmed shared status when selection is unchanged', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'wireless',
      selectedValue: 'Wireless',
      selectedCandidateId: 'cand_wireless',
      confidenceScore: 1,
      aiConfirmSharedStatus: 'confirmed',
      userAcceptSharedStatus: 'accepted',
    });

    const updated = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'wireless',
      selectedCandidateId: 'cand_wireless',
      selectedValue: 'Wireless',
      confidenceScore: 1,
      laneAction: 'accept',
    });

    assert.equal(updated.ai_confirm_shared_status, 'confirmed');
    assert.equal(updated.user_accept_shared_status, 'accepted');
    assert.equal(updated.selected_candidate_id, 'cand_wireless');
    assert.equal(updated.selected_value, 'Wireless');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('applySharedLaneState(accept) reopens shared pending when selection changes', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    specDb.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'wireless',
      selectedValue: 'Wireless',
      selectedCandidateId: 'cand_wireless',
      confidenceScore: 1,
      aiConfirmSharedStatus: 'confirmed',
      userAcceptSharedStatus: 'accepted',
    });

    const updated = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'wireless',
      selectedCandidateId: 'cand_bluetooth',
      selectedValue: 'Bluetooth',
      confidenceScore: 0.5,
      laneAction: 'accept',
    });

    assert.equal(updated.ai_confirm_shared_status, 'pending');
    assert.equal(updated.user_accept_shared_status, 'accepted');
    assert.equal(updated.selected_candidate_id, 'cand_bluetooth');
    assert.equal(updated.selected_value, 'Bluetooth');
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});

test('applySharedLaneState(confirm) on new row creates state without auto-accept', async () => {
  const { tempRoot, specDb } = await createTempSpecDb();
  try {
    const created = applySharedLaneState({
      specDb,
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'cable_type',
      enumValueNorm: 'usb-c',
      selectedCandidateId: null,
      selectedValue: 'USB-C',
      confidenceScore: 0.6,
      laneAction: 'confirm',
    });

    assert.ok(created?.id);
    assert.equal(created.selected_value, 'USB-C');
    assert.equal(created.selected_candidate_id, null);
    assert.equal(created.ai_confirm_shared_status, 'confirmed');
    assert.equal(created.user_accept_shared_status, null);
  } finally {
    await cleanupTempSpecDb(tempRoot, specDb);
  }
});
