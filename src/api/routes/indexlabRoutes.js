export function registerIndexlabRoutes(ctx) {
  const {
    jsonRes,
    toInt,
    toFloat,
    safeJoin,
    safeReadJson,
    path,
    INDEXLAB_ROOT,
    readIndexLabRunEvents,
    readIndexLabRunNeedSet,
    readIndexLabRunSearchProfile,
    readIndexLabRunPhase07Retrieval,
    readIndexLabRunPhase08Extraction,
    readIndexLabRunDynamicFetchDashboard,
    readIndexLabRunSourceIndexingPackets,
    readIndexLabRunItemIndexingPacket,
    readIndexLabRunRunMetaPacket,
    readIndexLabRunSerpExplorer,
    readIndexLabRunLlmTraces,
    readIndexLabRunAutomationQueue,
    readIndexLabRunEvidenceIndex,
    listIndexLabRuns,
    buildRoundSummaryFromEvents,
    buildSearchHints,
    buildAnchorsSuggestions,
    buildKnownValuesSuggestions,
  } = ctx;

  return async function handleIndexlabRoutes(parts, params, method, req, res) {
    // IndexLab runs + event replay
    if (parts[0] === 'indexlab' && parts[1] === 'runs' && method === 'GET') {
      const limit = Math.max(1, toInt(params.get('limit'), 50));
      const rows = await listIndexLabRuns({ limit });
      return jsonRes(res, 200, {
        root: INDEXLAB_ROOT,
        runs: rows
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && !parts[3] && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const runDir = safeJoin(INDEXLAB_ROOT, runId);
      if (!runDir) return jsonRes(res, 400, { error: 'invalid_run_id' });
      const runMetaPath = path.join(runDir, 'run.json');
      const meta = await safeReadJson(runMetaPath);
      if (!meta) return jsonRes(res, 404, { error: 'run_not_found', run_id: runId });
      return jsonRes(res, 200, meta);
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'events' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const limit = Math.max(1, toInt(params.get('limit'), 2000));
      const rows = await readIndexLabRunEvents(runId, limit);
      return jsonRes(res, 200, {
        run_id: runId,
        count: rows.length,
        events: rows
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'needset' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const needset = await readIndexLabRunNeedSet(runId);
      if (!needset) {
        return jsonRes(res, 404, { error: 'needset_not_found', run_id: runId });
      }
      return jsonRes(res, 200, {
        run_id: runId,
        ...needset
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'search-profile' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const searchProfile = await readIndexLabRunSearchProfile(runId);
      if (!searchProfile) {
        return jsonRes(res, 404, { error: 'search_profile_not_found', run_id: runId });
      }
      return jsonRes(res, 200, {
        run_id: runId,
        ...searchProfile
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'phase07-retrieval' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const payload = await readIndexLabRunPhase07Retrieval(runId);
      if (!payload) {
        return jsonRes(res, 404, { error: 'phase07_retrieval_not_found', run_id: runId });
      }
      return jsonRes(res, 200, {
        run_id: runId,
        ...payload
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'phase08-extraction' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const payload = await readIndexLabRunPhase08Extraction(runId);
      if (!payload) {
        return jsonRes(res, 404, { error: 'phase08_extraction_not_found', run_id: runId });
      }
      return jsonRes(res, 200, {
        run_id: runId,
        ...payload
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'dynamic-fetch-dashboard' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const payload = await readIndexLabRunDynamicFetchDashboard(runId);
      if (!payload) {
        return jsonRes(res, 404, { error: 'dynamic_fetch_dashboard_not_found', run_id: runId });
      }
      return jsonRes(res, 200, {
        run_id: runId,
        ...payload
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'source-indexing-packets' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const payload = await readIndexLabRunSourceIndexingPackets(runId);
      if (!payload) {
        return jsonRes(res, 404, { error: 'source_indexing_packets_not_found', run_id: runId });
      }
      return jsonRes(res, 200, payload);
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'item-indexing-packet' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const payload = await readIndexLabRunItemIndexingPacket(runId);
      if (!payload) {
        return jsonRes(res, 404, { error: 'item_indexing_packet_not_found', run_id: runId });
      }
      return jsonRes(res, 200, payload);
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'run-meta-packet' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const payload = await readIndexLabRunRunMetaPacket(runId);
      if (!payload) {
        return jsonRes(res, 404, { error: 'run_meta_packet_not_found', run_id: runId });
      }
      return jsonRes(res, 200, payload);
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'serp' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const serp = await readIndexLabRunSerpExplorer(runId);
      if (!serp) {
        return jsonRes(res, 404, { error: 'serp_not_found', run_id: runId });
      }
      return jsonRes(res, 200, {
        run_id: runId,
        ...serp
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'llm-traces' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const limit = Math.max(1, toInt(params.get('limit'), 80));
      const traces = await readIndexLabRunLlmTraces(runId, limit);
      if (!traces) {
        return jsonRes(res, 404, { error: 'llm_traces_not_found', run_id: runId });
      }
      return jsonRes(res, 200, traces);
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'automation-queue' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const queue = await readIndexLabRunAutomationQueue(runId);
      if (!queue) {
        return jsonRes(res, 404, { error: 'automation_queue_not_found', run_id: runId });
      }
      return jsonRes(res, 200, queue);
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'evidence-index' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const query = String(params.get('q') || params.get('query') || '').trim();
      const limit = Math.max(1, toInt(params.get('limit'), 40));
      const payload = await readIndexLabRunEvidenceIndex(runId, { query, limit });
      if (!payload) {
        return jsonRes(res, 404, { error: 'evidence_index_not_found', run_id: runId });
      }
      return jsonRes(res, 200, payload);
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'rounds' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const events = await readIndexLabRunEvents(runId, 8000);
      const summary = buildRoundSummaryFromEvents(events);
      return jsonRes(res, 200, {
        run_id: runId,
        ...summary
      });
    }

    if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'learning' && method === 'GET') {
      const runId = String(parts[2] || '').trim();
      const events = await readIndexLabRunEvents(runId, 8000);
      const learningEvents = events.filter((e) =>
        e.event === 'learning_update' || e.event === 'learning_gate_result'
        || (e.stage === 'learning')
      );
      const updates = learningEvents.map((e) => ({
        field: String(e.payload?.field || ''),
        value: String(e.payload?.value || ''),
        confidence: toFloat(e.payload?.confidence, 0),
        refs_found: toInt(e.payload?.refs_found, 0),
        tier_history: Array.isArray(e.payload?.tier_history) ? e.payload.tier_history : [],
        accepted: Boolean(e.payload?.accepted),
        reason: e.payload?.reason || null,
        source_run_id: String(e.payload?.source_run_id || runId)
      }));
      const accepted = updates.filter((u) => u.accepted).length;
      const rejected = updates.filter((u) => !u.accepted).length;
      const rejectionReasons = {};
      for (const u of updates) {
        if (!u.accepted && u.reason) {
          rejectionReasons[u.reason] = (rejectionReasons[u.reason] || 0) + 1;
        }
      }
      const acceptedUpdates = updates.filter((u) => u.accepted).map((u) => ({
        field: u.field,
        value: u.value,
        evidenceRefs: u.tier_history.map((tier, i) => ({ url: '', tier })),
        acceptanceStats: { confirmations: u.refs_found, approved: u.refs_found },
        sourceRunId: u.source_run_id
      }));
      return jsonRes(res, 200, {
        run_id: runId,
        updates,
        suggestions: {
          search_hints: buildSearchHints(acceptedUpdates),
          anchors: buildAnchorsSuggestions(acceptedUpdates),
          known_values: buildKnownValuesSuggestions(acceptedUpdates)
        },
        gate_summary: { total: updates.length, accepted, rejected, rejection_reasons: rejectionReasons }
      });
    }

    return false;
  };
}
