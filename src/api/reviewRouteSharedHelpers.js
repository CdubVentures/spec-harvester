export function firstFiniteNumber(values, fallback = null) {
  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function resolveCandidateConfidence({
  specDb,
  candidateId = null,
  candidateRow = null,
  fallbackConfidence = 1.0,
} = {}) {
  const normalizedCandidateId = String(candidateId || '').trim() || null;
  const resolvedCandidateRow = candidateRow
    || ((normalizedCandidateId && specDb) ? specDb.getCandidateById(normalizedCandidateId) : null);
  const confidence = firstFiniteNumber([
    resolvedCandidateRow?.score,
    fallbackConfidence,
  ], 1.0);
  return {
    candidateId: normalizedCandidateId,
    candidateRow: resolvedCandidateRow,
    confidence,
  };
}

export function createRouteResponder(jsonRes, res) {
  return (status, payload) => {
    jsonRes(res, status, payload);
    return true;
  };
}

export async function ensureSeededSpecDb({
  getSpecDbReady,
  category,
}) {
  const runtimeSpecDb = await getSpecDbReady(category);
  if (!runtimeSpecDb || !runtimeSpecDb.isSeeded()) {
    return {
      runtimeSpecDb: null,
      error: {
        status: 503,
        payload: { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` },
      },
    };
  }
  return { runtimeSpecDb, error: null };
}

export function sendDataChangeResponse({
  jsonRes,
  res,
  broadcastWs,
  eventType,
  category,
  payload,
  broadcastExtra = {},
}) {
  broadcastWs('data-change', { type: eventType, category, ...broadcastExtra });
  jsonRes(res, 200, { ok: true, ...payload });
  return true;
}

export function routeMatches({
  parts,
  method,
  scope,
  action,
  httpMethod = 'POST',
}) {
  return (
    Array.isArray(parts)
    && parts[0] === scope
    && Boolean(parts[1])
    && parts[2] === action
    && method === httpMethod
  );
}

export function respondIfError(respond, error) {
  if (!error) return false;
  return respond(error.status, error.payload);
}

export function jsonResIfError({
  jsonRes,
  res,
  error,
}) {
  if (!error) return false;
  jsonRes(res, error.status, error.payload);
  return true;
}

export function resolveContextOrError({
  resolveContext,
  args = [],
  status = 400,
}) {
  const context = resolveContext(...args);
  if (context?.error) {
    return {
      context: null,
      error: {
        status,
        payload: { error: context.error, message: context.errorMessage },
      },
    };
  }
  return {
    context,
    error: null,
  };
}

export async function prepareSeededMutationRequest({
  parts,
  req,
  readJsonBody,
  getSpecDbReady,
  body: presetBody = undefined,
  preSync = null,
}) {
  const category = parts[1];
  const body = presetBody === undefined
    ? await readJsonBody(req)
    : presetBody;
  const readySpecDb = await ensureSeededSpecDb({ category, getSpecDbReady });
  if (readySpecDb.error) {
    return {
      category,
      body,
      runtimeSpecDb: null,
      error: readySpecDb.error,
    };
  }
  const runtimeSpecDb = readySpecDb.runtimeSpecDb;
  if (typeof preSync === 'function') {
    try {
      await preSync({ category, body, specDb: runtimeSpecDb });
    } catch {
      // best-effort sync hook
    }
  }
  return {
    category,
    body,
    runtimeSpecDb,
    error: null,
  };
}

export async function prepareMutationContextRequest({
  parts,
  req,
  body = undefined,
  readJsonBody,
  getSpecDbReady,
  preSync = null,
  resolveContext = null,
  resolveContextArgs = null,
  contextErrorStatus = 400,
}) {
  const preparedRequest = await prepareSeededMutationRequest({
    parts,
    req,
    readJsonBody,
    getSpecDbReady,
    body,
    preSync,
  });
  if (preparedRequest.error) {
    return {
      category: preparedRequest.category,
      body: preparedRequest.body,
      runtimeSpecDb: preparedRequest.runtimeSpecDb,
      context: null,
      error: preparedRequest.error,
    };
  }
  if (typeof resolveContext !== 'function') {
    return {
      category: preparedRequest.category,
      body: preparedRequest.body,
      runtimeSpecDb: preparedRequest.runtimeSpecDb,
      context: null,
      error: null,
    };
  }
  const args = typeof resolveContextArgs === 'function'
    ? (resolveContextArgs({
      runtimeSpecDb: preparedRequest.runtimeSpecDb,
      category: preparedRequest.category,
      body: preparedRequest.body,
    }) || [])
    : [preparedRequest.runtimeSpecDb, preparedRequest.category, preparedRequest.body];
  const contextResolution = resolveContextOrError({
    resolveContext,
    args,
    status: contextErrorStatus,
  });
  if (contextResolution.error) {
    return {
      category: preparedRequest.category,
      body: preparedRequest.body,
      runtimeSpecDb: preparedRequest.runtimeSpecDb,
      context: null,
      error: contextResolution.error,
    };
  }
  return {
    category: preparedRequest.category,
    body: preparedRequest.body,
    runtimeSpecDb: preparedRequest.runtimeSpecDb,
    context: contextResolution.context,
    error: null,
  };
}

export function resolveSpecDbOrError({
  getSpecDb,
  category,
}) {
  const specDb = getSpecDb(category);
  if (!specDb) {
    return {
      specDb: null,
      error: { status: 404, payload: { error: 'no_spec_db', message: `No SpecDb for ${category}` } },
    };
  }
  return {
    specDb,
    error: null,
  };
}

export async function runHandledRouteChain({
  handlers,
  args,
}) {
  for (const handler of handlers) {
    const handled = await handler(args);
    if (handled !== false) {
      return true;
    }
  }
  return false;
}
