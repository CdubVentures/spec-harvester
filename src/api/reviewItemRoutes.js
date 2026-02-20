import {
  firstFiniteNumber,
  jsonResIfError,
  resolveSpecDbOrError,
  routeMatches,
  runHandledRouteChain,
  sendDataChangeResponse,
} from './reviewRouteSharedHelpers.js';

function resolveGridLaneStateForMutation({
  specDb,
  category,
  body,
  resolveKeyReviewForLaneMutation,
}) {
  const stateCtx = resolveKeyReviewForLaneMutation(specDb, category, body);
  if (stateCtx?.error) {
    return {
      stateCtx: null,
      stateRow: null,
      error: {
        status: 400,
        payload: { error: stateCtx.error, message: stateCtx.errorMessage },
      },
    };
  }
  const stateRow = stateCtx?.stateRow;
  if (!stateRow) {
    return {
      stateCtx,
      stateRow: null,
      error: {
        status: 404,
        payload: {
          error: 'key_review_state_not_found',
          message: 'Provide id or itemFieldStateId.',
        },
      },
    };
  }
  if (String(stateRow.target_kind || '') !== 'grid_key') {
    return {
      stateCtx,
      stateRow,
      error: {
        status: 400,
        payload: {
          error: 'lane_context_mismatch',
          message: 'Review lane endpoint only supports grid_key context. Use component/enum lane endpoints for shared review.',
        },
      },
    };
  }
  return { stateCtx, stateRow, error: null };
}

function resolveGridLaneCandidate({
  specDb,
  candidateId,
  stateRow,
}) {
  const candidateRow = specDb.getCandidateById(candidateId);
  if (!candidateRow) {
    return {
      candidateRow: null,
      persistedCandidateId: null,
      error: {
        status: 404,
        payload: {
          error: 'candidate_not_found',
          message: `candidate_id '${candidateId}' was not found.`,
        },
      },
    };
  }
  if (
    String(candidateRow.product_id || '') !== String(stateRow.item_identifier || '')
    || String(candidateRow.field_key || '') !== String(stateRow.field_key || '')
  ) {
    return {
      candidateRow: null,
      persistedCandidateId: null,
      error: {
        status: 400,
        payload: {
          error: 'candidate_context_mismatch',
          message: `candidate_id '${candidateId}' does not belong to ${stateRow.item_identifier}/${stateRow.field_key}`,
        },
      },
    };
  }
  return {
    candidateRow,
    persistedCandidateId: String(candidateRow.candidate_id || candidateId).trim(),
    error: null,
  };
}

function resolvePrimaryConfirmItemFieldStateId({
  stateRow,
  stateCtx,
  body,
}) {
  return Number.parseInt(String(
    stateRow.item_field_state_id
    ?? stateCtx?.fieldStateRow?.id
    ?? body?.itemFieldStateId
    ?? body?.item_field_state_id
    ?? '',
  ), 10);
}

function updateKeyReviewSelectedCandidate({
  specDb,
  stateId,
  candidateId,
  selectedValue,
  selectedScore,
}) {
  specDb.db.prepare(`
    UPDATE key_review_state
    SET selected_candidate_id = ?,
        selected_value = ?,
        confidence_score = COALESCE(?, confidence_score),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    candidateId,
    selectedValue,
    selectedScore,
    stateId
  );
}

async function resolveItemLaneCandidateMutationRequest({
  req,
  category,
  readJsonBody,
  getSpecDb,
  resolveKeyReviewForLaneMutation,
  candidateRequiredMessage,
}) {
  const body = await readJsonBody(req);
  const lane = String(body?.lane || '').trim().toLowerCase();
  const candidateId = String(body?.candidateId || body?.candidate_id || '').trim();
  if (!['primary', 'shared'].includes(lane)) {
    return {
      error: { status: 400, payload: { error: 'lane (primary|shared) required' } },
    };
  }
  const specDbResolution = resolveSpecDbOrError({ getSpecDb, category });
  if (specDbResolution.error) {
    return { error: specDbResolution.error };
  }
  const specDb = specDbResolution.specDb;

  const stateResolution = resolveGridLaneStateForMutation({
    specDb,
    category,
    body,
    resolveKeyReviewForLaneMutation,
  });
  if (stateResolution.error) {
    return { error: stateResolution.error };
  }
  const { stateCtx, stateRow } = stateResolution;

  if (!candidateId) {
    return {
      error: {
        status: 400,
        payload: {
          error: 'candidate_id_required',
          message: candidateRequiredMessage,
        },
      },
    };
  }
  const candidateResolution = resolveGridLaneCandidate({
    specDb,
    candidateId,
    stateRow,
  });
  if (candidateResolution.error) {
    return { error: candidateResolution.error };
  }

  return {
    error: null,
    body,
    lane,
    candidateId,
    specDb,
    stateCtx,
    stateRow,
    candidateRow: candidateResolution.candidateRow,
    persistedCandidateId: candidateResolution.persistedCandidateId,
  };
}

function setItemFieldNeedsAiReview(specDb, category, itemFieldStateId) {
  try {
    specDb.db.prepare(`
      UPDATE item_field_state
      SET needs_ai_review = 1,
          ai_review_complete = 0,
          updated_at = datetime('now')
      WHERE category = ? AND id = ?
    `).run(category, itemFieldStateId);
  } catch { /* best-effort */ }
}

function applyPrimaryItemConfirmLane({
  specDb,
  category,
  stateRow,
  stateProductId,
  stateFieldKey,
  stateItemFieldStateId,
  persistedCandidateId,
  candidateScore,
  candidateConfidence,
  getPendingItemPrimaryCandidateIds,
  markPrimaryLaneReviewedInItemState,
}) {
  const now = new Date().toISOString();
  specDb.upsertReview({
    candidateId: persistedCandidateId,
    contextType: 'item',
    contextId: String(stateItemFieldStateId),
    humanAccepted: false,
    humanAcceptedAt: null,
    aiReviewStatus: 'accepted',
    aiConfidence: firstFiniteNumber([
      candidateConfidence,
      candidateScore,
    ], 1.0),
    aiReason: 'primary_confirm',
    aiReviewedAt: now,
    aiReviewModel: null,
    humanOverrideAi: false,
    humanOverrideAiAt: null,
  });
  const pendingCandidateIds = getPendingItemPrimaryCandidateIds(specDb, {
    productId: stateProductId,
    fieldKey: stateFieldKey,
    itemFieldStateId: stateItemFieldStateId,
  });
  const nextPrimaryStatus = pendingCandidateIds.length > 0 ? 'pending' : 'confirmed';
  specDb.updateKeyReviewAiConfirm({
    id: stateRow.id,
    lane: 'primary',
    status: nextPrimaryStatus,
    confidence: nextPrimaryStatus === 'confirmed' ? 1.0 : null,
    at: now,
  });
  if (nextPrimaryStatus === 'confirmed') {
    const refreshedState = specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(stateRow.id) || stateRow;
    markPrimaryLaneReviewedInItemState(specDb, category, refreshedState);
  } else {
    setItemFieldNeedsAiReview(specDb, category, stateItemFieldStateId);
  }
  const updated = specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(stateRow.id);
  return {
    now,
    pendingCandidateIds,
    nextPrimaryStatus,
    updated,
  };
}

function applyLaneCandidateSelection({
  specDb,
  stateRow,
  candidateId,
  candidateRow,
  isMeaningfulValue,
  unknownValueMessage,
}) {
  const selectedValue = candidateRow.value ?? null;
  const selectedScore = firstFiniteNumber([candidateRow?.score], null);
  updateKeyReviewSelectedCandidate({
    specDb,
    stateId: stateRow.id,
    candidateId,
    selectedValue,
    selectedScore,
  });
  if (!isMeaningfulValue(selectedValue)) {
    return {
      error: {
        status: 400,
        payload: {
          error: 'unknown_value_not_actionable',
          message: unknownValueMessage,
        },
      },
    };
  }
  return {
    error: null,
    selectedValue,
    selectedScore,
  };
}

function applyLaneDecisionStatusAndAudit({
  specDb,
  stateRow,
  lane,
  decision,
  candidateId = null,
}) {
  const now = new Date().toISOString();
  if (decision === 'confirm') {
    specDb.updateKeyReviewAiConfirm({ id: stateRow.id, lane, status: 'confirmed', confidence: 1.0, at: now });
    specDb.insertKeyReviewAudit({
      keyReviewStateId: stateRow.id,
      eventType: 'ai_confirm',
      actorType: 'user',
      actorId: null,
      oldValue: lane === 'shared'
        ? (stateRow.ai_confirm_shared_status || 'pending')
        : (stateRow.ai_confirm_primary_status || 'pending'),
      newValue: 'confirmed',
      reason: `User confirmed ${lane} lane via GUI`,
    });
  } else {
    specDb.updateKeyReviewUserAccept({ id: stateRow.id, lane, status: 'accepted', at: now });
    specDb.insertKeyReviewAudit({
      keyReviewStateId: stateRow.id,
      eventType: 'user_accept',
      actorType: 'user',
      actorId: null,
      oldValue: null,
      newValue: 'accepted',
      reason: `User accepted ${lane} lane via GUI${candidateId ? ` for candidate ${candidateId}` : ''}`,
    });
  }
  const updated = specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(stateRow.id);
  return {
    now,
    updated,
  };
}

function resolveItemFieldMutationRequest({
  getSpecDb,
  resolveGridFieldStateForMutation,
  category,
  body,
  missingSlotMessage,
}) {
  const specDb = getSpecDb(category);
  const fieldStateCtx = resolveGridFieldStateForMutation(specDb, category, body);
  if (fieldStateCtx?.error) {
    return {
      error: {
        status: 400,
        payload: { error: fieldStateCtx.error, message: fieldStateCtx.errorMessage },
      },
    };
  }
  const fieldStateRow = fieldStateCtx?.row;
  const productId = String(fieldStateRow?.product_id || '').trim();
  const field = String(fieldStateRow?.field_key || '').trim();
  if (!productId || !field) {
    return {
      error: {
        status: 400,
        payload: {
          error: 'item_field_state_id_required',
          message: missingSlotMessage,
        },
      },
    };
  }
  return {
    error: null,
    specDb,
    productId,
    field,
  };
}

async function applyItemManualOverrideAndSync({
  storage,
  config,
  setManualOverride,
  syncPrimaryLaneAcceptFromItemSelection,
  specDb,
  category,
  productId,
  field,
  value,
  reviewer,
  reason,
  evidence,
  syncReason,
}) {
  const result = await setManualOverride({
    storage,
    config,
    category,
    productId,
    field,
    value: String(value),
    reviewer,
    reason,
    evidence,
    specDb,
  });
  if (specDb) {
    syncPrimaryLaneAcceptFromItemSelection({
      specDb,
      category,
      productId,
      fieldKey: field,
      selectedCandidateId: null,
      selectedValue: result?.value ?? value ?? null,
      confidenceScore: 1.0,
      reason: syncReason,
    });
  }
  return result;
}

function resolveItemOverrideMode(parts, method) {
  if (routeMatches({ parts, method, scope: 'review', action: 'override' })) {
    return 'override';
  }
  if (routeMatches({ parts, method, scope: 'review', action: 'manual-override' })) {
    return 'manual-override';
  }
  return null;
}

async function handleReviewItemOverrideMutationEndpoint({
  parts,
  method,
  req,
  res,
  context,
}) {
  const {
    storage,
    config,
    readJsonBody,
    jsonRes,
    getSpecDb,
    resolveGridFieldStateForMutation,
    setOverrideFromCandidate,
    setManualOverride,
    syncPrimaryLaneAcceptFromItemSelection,
    broadcastWs,
  } = context || {};
  const category = parts[1];
  const mode = resolveItemOverrideMode(parts, method);
  if (!mode) return false;

  const body = await readJsonBody(req);
  const { candidateId, value, reason, reviewer } = body;
  if (mode === 'manual-override' && (value === undefined || String(value).trim() === '')) {
    jsonRes(res, 400, { error: 'value_required', message: 'manual-override requires value' });
    return true;
  }
  const fieldRequest = resolveItemFieldMutationRequest({
    getSpecDb,
    resolveGridFieldStateForMutation,
    category,
    body,
    missingSlotMessage: mode === 'manual-override'
      ? 'Valid itemFieldStateId is required for manual override.'
      : 'Valid itemFieldStateId is required for review override.',
  });
  if (jsonResIfError({ jsonRes, res, error: fieldRequest.error })) return true;
  const { specDb, productId, field } = fieldRequest;

  try {
    const normalizedCandidateId = String(candidateId || '').trim();
    if (mode === 'override' && normalizedCandidateId) {
      const result = await setOverrideFromCandidate({
        storage,
        config,
        category,
        productId,
        field,
        candidateId: normalizedCandidateId,
        candidateValue: value ?? body?.candidateValue ?? body?.candidate_value ?? null,
        candidateScore: body?.candidateConfidence ?? body?.candidate_confidence ?? null,
        candidateSource: body?.candidateSource ?? body?.candidate_source ?? '',
        candidateMethod: body?.candidateMethod ?? body?.candidate_method ?? '',
        candidateTier: body?.candidateTier ?? body?.candidate_tier ?? null,
        candidateEvidence: body?.candidateEvidence ?? body?.candidate_evidence ?? null,
        reviewer,
        reason,
        specDb,
      });
      if (specDb) {
        syncPrimaryLaneAcceptFromItemSelection({
          specDb,
          category,
          productId,
          fieldKey: field,
          selectedCandidateId: result?.candidate_id || normalizedCandidateId,
          selectedValue: result?.value ?? body?.candidateValue ?? body?.candidate_value ?? value ?? null,
          confidenceScore: body?.candidateConfidence ?? body?.candidate_confidence ?? null,
          reason: `User accepted primary lane via item override${normalizedCandidateId ? ` (${normalizedCandidateId})` : ''}`,
        });
      }
      return sendDataChangeResponse({
        jsonRes,
        res,
        broadcastWs,
        eventType: 'review-override',
        category,
        broadcastExtra: { productId, field },
        payload: { result },
      });
    }
    if (value === undefined || String(value).trim() === '') {
      jsonRes(res, 400, { error: 'invalid_override_request', message: 'Provide candidateId or value.' });
      return true;
    }

    const manualEvidence = mode === 'manual-override'
      ? {
        url: String(body?.evidenceUrl || 'gui://manual-entry'),
        quote: String(body?.evidenceQuote || `Manually set to "${String(value)}" via GUI`),
        source_id: null,
        retrieved_at: new Date().toISOString(),
      }
      : {
        url: 'gui://manual-entry',
        quote: `Manually set to "${String(value)}" via GUI`,
      };
    const result = await applyItemManualOverrideAndSync({
      storage,
      config,
      setManualOverride,
      syncPrimaryLaneAcceptFromItemSelection,
      specDb,
      category,
      productId,
      field,
      value,
      reviewer,
      reason,
      evidence: manualEvidence,
      syncReason: mode === 'manual-override'
        ? 'User manually set item value via manual-override endpoint'
        : 'User manually set item value via review override',
    });
    return sendDataChangeResponse({
      jsonRes,
      res,
      broadcastWs,
      eventType: 'review-manual-override',
      category,
      broadcastExtra: { productId, field },
      payload: { result },
    });
  } catch (err) {
    jsonRes(res, 500, {
      error: mode === 'manual-override' ? 'manual_override_failed' : 'override_failed',
      message: err.message,
    });
    return true;
  }
}

async function handleItemKeyReviewDecisionEndpoint({
  parts,
  method,
  req,
  res,
  context,
  action,
  decision,
  candidateRequiredMessage,
  unknownValueMessage,
  failureErrorCode,
}) {
  const {
    readJsonBody,
    jsonRes,
    getSpecDb,
    resolveKeyReviewForLaneMutation,
    getPendingItemPrimaryCandidateIds,
    markPrimaryLaneReviewedInItemState,
    syncItemFieldStateFromPrimaryLaneAccept,
    isMeaningfulValue,
    propagateSharedLaneDecision,
    broadcastWs,
  } = context || {};
  const category = parts[1];

  if (!routeMatches({ parts, method, scope: 'review', action })) {
    return false;
  }

  try {
    const laneRequest = await resolveItemLaneCandidateMutationRequest({
      req,
      category,
      readJsonBody,
      getSpecDb,
      resolveKeyReviewForLaneMutation,
      candidateRequiredMessage,
    });
    if (jsonResIfError({ jsonRes, res, error: laneRequest.error })) return true;
    const {
      body,
      lane,
      candidateId,
      specDb,
      stateCtx,
      stateRow,
      candidateRow,
      persistedCandidateId,
    } = laneRequest;

    if (decision === 'confirm' && lane === 'primary') {
      const stateProductId = String(stateRow.item_identifier || '').trim();
      const stateFieldKey = String(stateRow.field_key || '').trim();
      const stateItemFieldStateId = resolvePrimaryConfirmItemFieldStateId({
        stateRow,
        stateCtx,
        body,
      });
      if (!Number.isFinite(stateItemFieldStateId) || stateItemFieldStateId <= 0) {
        jsonRes(res, 400, {
          error: 'item_field_state_id_required',
          message: 'Valid itemFieldStateId is required for candidate-scoped item confirm.',
        });
        return true;
      }
      const { pendingCandidateIds, updated } = applyPrimaryItemConfirmLane({
        specDb,
        category,
        stateRow,
        stateProductId,
        stateFieldKey,
        stateItemFieldStateId,
        persistedCandidateId,
        candidateScore: candidateRow?.score,
        candidateConfidence: body?.candidateConfidence,
        getPendingItemPrimaryCandidateIds,
        markPrimaryLaneReviewedInItemState,
      });
      return sendDataChangeResponse({
        jsonRes,
        res,
        broadcastWs,
        eventType: action,
        category,
        broadcastExtra: { id: stateRow.id, lane },
        payload: {
          keyReviewState: updated,
          pendingPrimaryCandidateIds: pendingCandidateIds,
          confirmedCandidateId: persistedCandidateId,
        },
      });
    }

    const selection = applyLaneCandidateSelection({
      specDb,
      stateRow,
      candidateId,
      candidateRow,
      isMeaningfulValue,
      unknownValueMessage,
    });
    if (jsonResIfError({ jsonRes, res, error: selection.error })) return true;
    const { updated } = applyLaneDecisionStatusAndAudit({
      specDb,
      stateRow,
      lane,
      decision,
      candidateId: decision === 'accept' ? candidateId : null,
    });
    if (decision === 'accept') {
      if (lane === 'primary') {
        syncItemFieldStateFromPrimaryLaneAccept(specDb, category, updated);
      }
      if (lane === 'shared') {
        await propagateSharedLaneDecision({
          category,
          specDb,
          keyReviewState: updated,
          laneAction: 'accept',
          candidateValue: selection.selectedValue,
        });
      }
    }
    return sendDataChangeResponse({
      jsonRes,
      res,
      broadcastWs,
      eventType: action,
      category,
      broadcastExtra: { id: stateRow.id, lane },
      payload: { keyReviewState: updated },
    });
  } catch (err) {
    jsonRes(res, 500, { error: failureErrorCode, message: err.message });
    return true;
  }
}

async function handleReviewItemKeyReviewConfirmEndpoint(args) {
  return handleItemKeyReviewDecisionEndpoint({
    ...args,
    action: 'key-review-confirm',
    decision: 'confirm',
    candidateRequiredMessage: 'candidateId is required for candidate-scoped AI confirm.',
    unknownValueMessage: 'Cannot confirm AI review for unknown/empty selected values.',
    failureErrorCode: 'confirm_failed',
  });
}

async function handleReviewItemKeyReviewAcceptEndpoint(args) {
  return handleItemKeyReviewDecisionEndpoint({
    ...args,
    action: 'key-review-accept',
    decision: 'accept',
    candidateRequiredMessage: 'candidateId is required for candidate-scoped accept.',
    unknownValueMessage: 'Cannot accept unknown/empty selected values.',
    failureErrorCode: 'accept_failed',
  });
}

export async function handleReviewItemMutationRoute({
  parts,
  method,
  req,
  res,
  context,
}) {
  if (!Array.isArray(parts) || parts[0] !== 'review' || !parts[1]) {
    return false;
  }
  return runHandledRouteChain({
    handlers: [
      handleReviewItemOverrideMutationEndpoint,
      handleReviewItemKeyReviewConfirmEndpoint,
      handleReviewItemKeyReviewAcceptEndpoint,
    ],
    args: { parts, method, req, res, context },
  });
}
