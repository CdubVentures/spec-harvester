export function applySharedLaneState({
  specDb,
  category,
  targetKind,
  itemIdentifier = null,
  fieldKey = '',
  enumValueNorm = null,
  componentIdentifier = null,
  propertyKey = null,
  itemFieldStateId = null,
  componentValueId = null,
  componentIdentityId = null,
  listValueId = null,
  enumListId = null,
  selectedCandidateId = null,
  selectedValue = null,
  confidenceScore = 0,
  laneAction = 'confirm',
  nowIso = null,
  updateSelection = null,
  confirmStatusOverride = null,
}) {
  if (!specDb || !targetKind) return null;
  const normalizeComparable = (value) => String(value ?? '').trim().toLowerCase();
  const shouldUpdateSelection = typeof updateSelection === 'boolean'
    ? updateSelection
    : laneAction === 'accept';

  let state = specDb.getKeyReviewState({
    category,
    targetKind,
    itemIdentifier,
    fieldKey,
    enumValueNorm,
    componentIdentifier,
    propertyKey,
    itemFieldStateId,
    componentValueId,
    componentIdentityId,
    listValueId,
  });

  if (!state) {
    const id = specDb.upsertKeyReviewState({
      category,
      targetKind,
      itemIdentifier,
      fieldKey,
      enumValueNorm,
      componentIdentifier,
      propertyKey,
      itemFieldStateId,
      componentValueId,
      componentIdentityId,
      listValueId,
      enumListId,
      selectedValue,
      selectedCandidateId,
      confidenceScore,
      aiConfirmSharedStatus: 'pending',
    });
    state = specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(id) || null;
  }
  if (!state) return null;

  const previousCandidateId = String(state.selected_candidate_id || '').trim() || null;
  const previousValue = state.selected_value ?? null;
  const previousAiStatus = String(state.ai_confirm_shared_status || '').trim().toLowerCase();

  if (shouldUpdateSelection) {
    specDb.db.prepare(`
      UPDATE key_review_state
      SET selected_candidate_id = ?,
          selected_value = ?,
          confidence_score = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(selectedCandidateId, selectedValue, confidenceScore, state.id);
  }

  const nextCandidateId = shouldUpdateSelection
    ? (String(selectedCandidateId || '').trim() || null)
    : previousCandidateId;
  const nextValue = shouldUpdateSelection
    ? (selectedValue ?? null)
    : previousValue;
  const candidateChanged = normalizeComparable(nextCandidateId) !== normalizeComparable(previousCandidateId);
  const valueChanged = normalizeComparable(nextValue) !== normalizeComparable(previousValue);
  const selectionChanged = candidateChanged || valueChanged;

  const at = nowIso || new Date().toISOString();
  if (laneAction === 'accept') {
    // Accept selects a value/candidate but should not regress a confirmed lane unless selection changed.
    const nextAiStatus = (!selectionChanged && previousAiStatus === 'confirmed') ? 'confirmed' : 'pending';
    const nextAiConfidence = nextAiStatus === 'confirmed' ? 1.0 : null;
    specDb.updateKeyReviewAiConfirm({ id: state.id, lane: 'shared', status: nextAiStatus, confidence: nextAiConfidence, at });
    specDb.updateKeyReviewUserAccept({ id: state.id, lane: 'shared', status: 'accepted', at });
  } else {
    const overrideToken = String(confirmStatusOverride || '').trim().toLowerCase();
    const nextStatus = overrideToken === 'pending' ? 'pending' : 'confirmed';
    const nextConfidence = nextStatus === 'confirmed' ? 1.0 : null;
    specDb.updateKeyReviewAiConfirm({ id: state.id, lane: 'shared', status: nextStatus, confidence: nextConfidence, at });
  }

  return specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(state.id) || state;
}
