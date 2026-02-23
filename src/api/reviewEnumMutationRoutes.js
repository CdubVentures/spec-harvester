import {
  createRouteResponder,
  firstFiniteNumber,
  prepareMutationContextRequest,
  respondIfError,
  resolveCandidateConfidence,
  routeMatches,
  runHandledRouteChain,
  sendDataChangeResponse,
} from './reviewRouteSharedHelpers.js';

function validateEnumCandidate({
  candidateRow,
  candidateId,
  field,
  resolvedValue,
  isMeaningfulValue,
  normalizeLower,
  valueMismatchMessage,
  allowValueMismatch = false,
}) {
  if (String(candidateRow?.field_key || '').trim() !== String(field || '').trim()) {
    return {
      error: 'candidate_context_mismatch',
      message: `candidate_id '${candidateId}' does not belong to enum field '${field}'.`,
    };
  }
  const candidateValueToken = String(candidateRow?.value ?? '').trim();
  if (
    !allowValueMismatch
    && (
    isMeaningfulValue(candidateValueToken)
    && normalizeLower(candidateValueToken) !== normalizeLower(String(resolvedValue ?? '').trim())
    )
  ) {
    return {
      error: 'candidate_value_mismatch',
      message: valueMismatchMessage,
    };
  }
  return null;
}

function applyEnumSharedLaneState({
  runtimeSpecDb,
  applySharedLaneState,
  category,
  field,
  normalizedValue,
  listValueRow,
  selectedCandidateId,
  selectedValue,
  confidenceScore,
  laneAction,
  nowIso,
  confirmStatusOverride,
}) {
  return applySharedLaneState({
    specDb: runtimeSpecDb,
    category,
    targetKind: 'enum_key',
    fieldKey: field,
    enumValueNorm: normalizedValue,
    listValueId: listValueRow?.id ?? null,
    enumListId: listValueRow?.list_id ?? null,
    selectedCandidateId: selectedCandidateId || null,
    selectedValue,
    confidenceScore,
    laneAction,
    nowIso,
    confirmStatusOverride,
  });
}

function applyEnumSharedLaneWithResolvedConfidence({
  runtimeSpecDb,
  applySharedLaneState,
  category,
  field,
  normalizedValue,
  listValueRow,
  selectedCandidateId,
  selectedValue,
  laneAction,
  nowIso,
  confirmStatusOverride = undefined,
  fallbackConfidence = 1.0,
}) {
  const { confidence: sharedConfidence } = resolveCandidateConfidence({
    specDb: runtimeSpecDb,
    candidateId: selectedCandidateId,
    fallbackConfidence,
  });
  return applyEnumSharedLaneState({
    runtimeSpecDb,
    applySharedLaneState,
    category,
    field,
    normalizedValue,
    listValueRow,
    selectedCandidateId,
    selectedValue,
    confidenceScore: sharedConfidence,
    laneAction,
    nowIso,
    confirmStatusOverride,
  });
}

function upsertEnumListValueAndFetch({
  runtimeSpecDb,
  field,
  value,
  normalizedValue,
  upsertValues,
}) {
  runtimeSpecDb.upsertListValue({
    fieldKey: field,
    value,
    normalizedValue,
    ...(upsertValues || {}),
  });
  return runtimeSpecDb.getListValueByFieldAndValue(field, value);
}

function resolveEnumPreAffectedProductIds(runtimeSpecDb, listValueId) {
  try {
    const preRows = runtimeSpecDb.getProductsByListValueId(listValueId) || [];
    return [...new Set(preRows.map((row) => row?.product_id).filter(Boolean))];
  } catch {
    return [];
  }
}

function sanitizeExistingAcceptedCandidateId(runtimeSpecDb, existingLv) {
  const persistedAcceptedCandidateId = String(existingLv?.accepted_candidate_id || '').trim();
  if (!persistedAcceptedCandidateId) return null;
  return runtimeSpecDb.getCandidateById(persistedAcceptedCandidateId)
    ? persistedAcceptedCandidateId
    : null;
}

function resolveEnumRequiredCandidate({
  action,
  requestedCandidateId,
  requestedCandidateRow,
}) {
  const needsCandidateAction = action === 'accept' || action === 'confirm';
  if (!needsCandidateAction) return null;
  if (!requestedCandidateId) {
    return {
      status: 400,
      payload: {
        error: 'candidate_id_required',
        message: `candidateId is required for enum ${action}.`,
      },
    };
  }
  if (!requestedCandidateRow) {
    return {
      status: 404,
      payload: {
        error: 'candidate_not_found',
        message: `candidate_id '${requestedCandidateId}' was not found.`,
      },
    };
  }
  return null;
}

async function applyEnumSuggestionStatusByAction({
  action,
  markEnumSuggestionStatus,
  category,
  field,
  value,
  priorValue,
}) {
  if (action === 'accept' || action === 'add') {
    try { await markEnumSuggestionStatus(category, field, value, 'accepted'); } catch { /* best-effort */ }
    if (priorValue) {
      try { await markEnumSuggestionStatus(category, field, priorValue, 'accepted'); } catch { /* best-effort */ }
    }
    return;
  }
  if (action === 'remove') {
    try { await markEnumSuggestionStatus(category, field, value, 'dismissed'); } catch { /* best-effort */ }
  }
}

async function handleEnumOverrideEndpoint({
  parts,
  method,
  req,
  res,
  context,
}) {
  const {
    readJsonBody,
    jsonRes,
    getSpecDbReady,
    syncSyntheticCandidatesFromComponentReview,
    resolveEnumMutationContext,
    isMeaningfulValue,
    normalizeLower,
    candidateLooksReference,
    applySharedLaneState,
    getPendingEnumSharedCandidateIds,
    specDbCache,
    storage,
    outputRoot,
    cascadeEnumChange,
    loadQueueState,
    saveQueueState,
    markEnumSuggestionStatus,
    broadcastWs,
  } = context || {};
  const respond = createRouteResponder(jsonRes, res);

  // Enum value override (add/remove/accept/confirm) - SQL-first runtime path
  if (routeMatches({ parts, method, scope: 'review-components', action: 'enum-override' })) {
    const preparedMutation = await prepareMutationContextRequest({
      parts,
      req,
      readJsonBody,
      getSpecDbReady,
      resolveContext: resolveEnumMutationContext,
      resolveContextArgs: ({ runtimeSpecDb, category, body }) => {
        const action = String(body?.action || '').trim().toLowerCase() || 'add';
        return [runtimeSpecDb, category, body, {
          requireEnumListId: action === 'add',
          requireListValueId: action === 'remove' || action === 'accept' || action === 'confirm',
        }];
      },
      preSync: ({ category, specDb }) => syncSyntheticCandidatesFromComponentReview({ category, specDb }),
    });
    if (respondIfError(respond, preparedMutation.error)) {
      return true;
    }
    const {
      category,
      body,
      runtimeSpecDb,
      context: enumCtx,
    } = preparedMutation;
    const action = String(body?.action || '').trim().toLowerCase() || 'add'; // 'add' | 'remove' | 'accept' | 'confirm'
    const { candidateId, candidateSource } = body;
    const field = String(enumCtx?.field || '').trim();
    const value = String(enumCtx?.value || '').trim();
    const listValueId = enumCtx?.listValueId ?? null;
    if (!field) return respond(400, { error: 'field required' });
    if (!value) return respond(400, { error: 'value required' });

    // SQL-first runtime path (known_values writes removed from write path)
    try {
      const normalized = String(value).trim().toLowerCase();
      const nowIso = new Date().toISOString();
      const requestedCandidateId = String(candidateId || '').trim() || null;
      let requestedCandidateRow = requestedCandidateId
        ? runtimeSpecDb.getCandidateById(requestedCandidateId)
        : null;
      const candidateRequiredError = resolveEnumRequiredCandidate({
        action,
        requestedCandidateId,
        requestedCandidateRow,
      });
      if (candidateRequiredError) {
        return respond(candidateRequiredError.status, candidateRequiredError.payload);
      }
      let acceptedCandidateId = requestedCandidateRow ? requestedCandidateId : null;
      const sourceToken = String(candidateSource || '').trim().toLowerCase();
      const priorValue = String(enumCtx?.oldValue || '').trim();
      const normalizedPrior = priorValue.toLowerCase();
      let cascadeAction = null;
      let cascadeValue = value;
      let cascadeNewValue = null;
      let cascadePreAffectedProductIds = [];

      if (action === 'remove') {
        cascadePreAffectedProductIds = resolveEnumPreAffectedProductIds(runtimeSpecDb, listValueId);
        runtimeSpecDb.deleteListValueById(listValueId);
        cascadeAction = 'remove';
        cascadeValue = value;
      } else if (action === 'accept') {
        const resolvedValue = value;
        if (!isMeaningfulValue(resolvedValue)) {
          return respond(400, {
            error: 'unknown_value_not_actionable',
            message: 'Cannot accept unknown/empty enum values.',
          });
        }
        const normalizedResolved = resolvedValue.toLowerCase();
        const isRenameAccept = Boolean(priorValue) && normalizedPrior !== normalizedResolved;
        if (acceptedCandidateId && requestedCandidateRow) {
          const candidateValidationError = validateEnumCandidate({
            candidateRow: requestedCandidateRow,
            candidateId: acceptedCandidateId,
            field,
            resolvedValue,
            isMeaningfulValue,
          normalizeLower,
          valueMismatchMessage: `candidate_id '${acceptedCandidateId}' value does not match enum value '${resolvedValue}'.`,
          allowValueMismatch: isRenameAccept,
        });
          if (candidateValidationError) {
            return respond(400, candidateValidationError);
          }
        }
        const oldLv = isRenameAccept
          ? runtimeSpecDb.getListValueById(listValueId)
          : null;
        if (isRenameAccept && oldLv) {
          cascadePreAffectedProductIds = oldLv?.id
            ? (runtimeSpecDb.renameListValueById(oldLv.id, resolvedValue, nowIso) || [])
            : (runtimeSpecDb.renameListValue(field, priorValue, resolvedValue, nowIso) || []);
          cascadeAction = 'rename';
          cascadeValue = priorValue;
          cascadeNewValue = resolvedValue;
        }
        const existingLv = runtimeSpecDb.getListValueByFieldAndValue(field, resolvedValue);
        const existingState = runtimeSpecDb.getKeyReviewState({
          category,
          targetKind: 'enum_key',
          fieldKey: field,
          enumValueNorm: normalizedResolved,
          listValueId: existingLv?.id ?? null,
        });
        const priorState = isRenameAccept
          ? runtimeSpecDb.getKeyReviewState({
            category,
            targetKind: 'enum_key',
            fieldKey: field,
            enumValueNorm: normalizedPrior,
            listValueId: oldLv?.id ?? null,
          })
          : null;
        const existingStateStatus = String(existingState?.ai_confirm_shared_status || '').trim().toLowerCase();
        const priorStateStatus = String(priorState?.ai_confirm_shared_status || '').trim().toLowerCase();
        const keepNeedsReview = existingStateStatus === 'pending'
          || priorStateStatus === 'pending'
          || Boolean(existingLv?.needs_review)
          || Boolean(oldLv?.needs_review);
        const looksReference = candidateLooksReference(requestedCandidateId, sourceToken);
        const selectedSource = String(
          existingLv?.source
          || oldLv?.source
          || (looksReference ? 'known_values' : 'pipeline')
        );
        const resolvedCandidateId = acceptedCandidateId;
        const resolvedLv = upsertEnumListValueAndFetch({
          runtimeSpecDb,
          field,
          value: resolvedValue,
          normalizedValue: normalized,
          upsertValues: {
            source: selectedSource,
            overridden: false,
            needsReview: keepNeedsReview,
            sourceTimestamp: nowIso,
            acceptedCandidateId: resolvedCandidateId,
          },
        });
        applyEnumSharedLaneWithResolvedConfidence({
          runtimeSpecDb,
          applySharedLaneState,
          category,
          field,
          normalizedValue: normalized,
          listValueRow: resolvedLv,
          selectedCandidateId: resolvedCandidateId,
          selectedValue: resolvedValue,
          laneAction: 'accept',
          nowIso,
        });
      } else if (action === 'confirm') {
        const resolvedValue = value;
        if (!isMeaningfulValue(resolvedValue)) {
          return respond(400, {
            error: 'unknown_value_not_actionable',
            message: 'Cannot confirm unknown/empty enum values.',
          });
        }
        const candidateValidationError = validateEnumCandidate({
          candidateRow: requestedCandidateRow,
          candidateId: requestedCandidateId,
          field,
          resolvedValue,
          isMeaningfulValue,
          normalizeLower,
          valueMismatchMessage: `candidate_id '${requestedCandidateId}' value does not match enum value '${resolvedValue}'.`,
        });
        if (candidateValidationError) {
          return respond(400, candidateValidationError);
        }
        let existingLv = runtimeSpecDb.getListValueByFieldAndValue(field, resolvedValue);
        if (!existingLv) {
          existingLv = upsertEnumListValueAndFetch({
            runtimeSpecDb,
            field,
            value: resolvedValue,
            normalizedValue: normalized,
            upsertValues: {
              source: 'pipeline',
              enumPolicy: null,
              overridden: false,
              needsReview: false,
              sourceTimestamp: nowIso,
              acceptedCandidateId: null,
            },
          });
        } else {
          const sanitizedAcceptedCandidateId = sanitizeExistingAcceptedCandidateId(runtimeSpecDb, existingLv);
          existingLv = upsertEnumListValueAndFetch({
            runtimeSpecDb,
            field,
            value: resolvedValue,
            normalizedValue: normalized,
            upsertValues: {
              source: existingLv.source || 'pipeline',
              enumPolicy: existingLv.enum_policy ?? null,
              overridden: Boolean(existingLv.overridden),
              needsReview: false,
              sourceTimestamp: nowIso,
              acceptedCandidateId: sanitizedAcceptedCandidateId,
            },
          });
        }
        const resolvedCandidateId = requestedCandidateId;
        if (existingLv?.id) {
          runtimeSpecDb.upsertReview({
            candidateId: requestedCandidateId,
            contextType: 'list',
            contextId: String(existingLv.id),
            humanAccepted: false,
            humanAcceptedAt: null,
            aiReviewStatus: 'accepted',
            aiConfidence: firstFiniteNumber([body?.candidateConfidence], 1.0),
            aiReason: 'shared_confirm',
            aiReviewedAt: nowIso,
            aiReviewModel: null,
            humanOverrideAi: false,
            humanOverrideAiAt: null,
          });
        }
        const pendingCandidateIds = getPendingEnumSharedCandidateIds(runtimeSpecDb, {
          fieldKey: field,
          listValueId: existingLv?.id ?? null,
        });
        const confirmStatusOverride = pendingCandidateIds.length > 0 ? 'pending' : 'confirmed';
        existingLv = upsertEnumListValueAndFetch({
          runtimeSpecDb,
          field,
          value: resolvedValue,
          normalizedValue: normalized,
          upsertValues: {
            source: existingLv?.source || 'pipeline',
            enumPolicy: existingLv?.enum_policy ?? null,
            overridden: Boolean(existingLv?.overridden),
            needsReview: confirmStatusOverride === 'pending',
            sourceTimestamp: nowIso,
            acceptedCandidateId: resolvedCandidateId,
          },
        });
        applyEnumSharedLaneWithResolvedConfidence({
          runtimeSpecDb,
          applySharedLaneState,
          category,
          field,
          normalizedValue: normalized,
          listValueRow: existingLv,
          selectedCandidateId: resolvedCandidateId,
          selectedValue: resolvedValue,
          laneAction: 'confirm',
          nowIso,
          confirmStatusOverride,
        });
      } else {
        const resolvedValue = value;
        const manualLv = upsertEnumListValueAndFetch({
          runtimeSpecDb,
          field,
          value: resolvedValue,
          normalizedValue: normalized,
          upsertValues: {
            source: 'manual',
            overridden: true,
            needsReview: false,
            sourceTimestamp: nowIso,
            acceptedCandidateId: null,
          },
        });
        applyEnumSharedLaneWithResolvedConfidence({
          runtimeSpecDb,
          applySharedLaneState,
          category,
          field,
          normalizedValue: normalized,
          listValueRow: manualLv,
          selectedCandidateId: null,
          selectedValue: resolvedValue,
          laneAction: 'accept',
          nowIso,
          fallbackConfidence: 1.0,
        });
      }

      specDbCache.delete(category);

      if (cascadeAction) {
        await cascadeEnumChange({
          storage,
          outputRoot: outputRoot,
          category,
          field,
          action: cascadeAction,
          value: cascadeValue,
          newValue: cascadeNewValue,
          preAffectedProductIds: cascadePreAffectedProductIds,
          loadQueueState,
          saveQueueState,
          specDb: runtimeSpecDb,
        });
      }
      await applyEnumSuggestionStatusByAction({
        action,
        markEnumSuggestionStatus,
        category,
        field,
        value,
        priorValue,
      });

      return sendDataChangeResponse({
        jsonRes,
        res,
        broadcastWs,
        eventType: 'enum-override',
        category,
        payload: { field, action: action || 'add', persisted: 'specdb' },
        broadcastExtra: { field, action: action || 'add' },
      });
    } catch (sqlErr) {
      return respond(500, {
        error: 'enum_override_specdb_write_failed',
        message: sqlErr?.message || 'SpecDb write failed',
      });
    }

  }

  return false;
}

async function handleEnumRenameEndpoint({
  parts,
  method,
  req,
  res,
  context,
}) {
  const {
    readJsonBody,
    jsonRes,
    getSpecDbReady,
    resolveEnumMutationContext,
    specDbCache,
    storage,
    outputRoot,
    cascadeEnumChange,
    loadQueueState,
    saveQueueState,
    markEnumSuggestionStatus,
    broadcastWs,
  } = context || {};
  const respond = createRouteResponder(jsonRes, res);

  // Atomic enum rename (remove old + add new in one transaction)
  if (routeMatches({ parts, method, scope: 'review-components', action: 'enum-rename' })) {
    const category = parts[1];
    const body = await readJsonBody(req);
    const newValueRaw = body?.newValue ?? body?.new_value;
    if (!newValueRaw) return respond(400, { error: 'newValue required' });
    const trimmedNew = String(newValueRaw).trim();
    if (!trimmedNew) return respond(400, { error: 'newValue cannot be empty' });
    const preparedMutation = await prepareMutationContextRequest({
      parts,
      req,
      body,
      readJsonBody,
      getSpecDbReady,
      resolveContext: resolveEnumMutationContext,
      resolveContextArgs: ({ runtimeSpecDb, category: resolvedCategory, body: requestBody }) => ([
        runtimeSpecDb,
        resolvedCategory,
        requestBody,
        { requireListValueId: true },
      ]),
    });
    if (respondIfError(respond, preparedMutation.error)) {
      return true;
    }
    const {
      runtimeSpecDb,
      context: enumCtx,
    } = preparedMutation;
    const field = String(enumCtx?.field || '').trim();
    const oldValue = String(enumCtx?.oldValue || '').trim();
    const listValueId = enumCtx?.listValueId ?? null;
    if (!field || !oldValue) {
      return respond(400, { error: 'field and oldValue (or listValueId) required' });
    }
    if (oldValue.toLowerCase() === trimmedNew.toLowerCase()) {
      return respond(200, { ok: true, field, changed: false });
    }

    // SQL-first runtime path (known_values writes removed from write path)
    try {
      const affectedProductIds = runtimeSpecDb.renameListValueById(
        listValueId,
        trimmedNew,
        new Date().toISOString()
      ) || [];
      specDbCache.delete(category);

      await cascadeEnumChange({
        storage,
        outputRoot: outputRoot,
        category,
        field,
        action: 'rename',
        value: oldValue,
        newValue: trimmedNew,
        preAffectedProductIds: affectedProductIds,
        loadQueueState,
        saveQueueState,
        specDb: runtimeSpecDb,
      });
      try { await markEnumSuggestionStatus(category, field, oldValue, 'accepted'); } catch { /* best-effort */ }

      return sendDataChangeResponse({
        jsonRes,
        res,
        broadcastWs,
        eventType: 'enum-rename',
        category,
        payload: { field, oldValue, newValue: trimmedNew, changed: true, persisted: 'specdb' },
        broadcastExtra: { field },
      });
    } catch (sqlErr) {
      return respond(500, {
        error: 'enum_rename_specdb_write_failed',
        message: sqlErr?.message || 'SpecDb write failed',
      });
    }

  }



  return false;
}

export async function handleReviewEnumMutationRoute({
  parts,
  method,
  req,
  res,
  context,
}) {
  if (!Array.isArray(parts) || parts[0] !== 'review-components' || !parts[1]) {
    return false;
  }
  return runHandledRouteChain({
    handlers: [
      handleEnumOverrideEndpoint,
      handleEnumRenameEndpoint,
    ],
    args: { parts, method, req, res, context },
  });
}
