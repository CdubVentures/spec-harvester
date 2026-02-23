export function registerConfigRoutes(ctx) {
  const {
    jsonRes,
    readJsonBody,
    config,
    toInt,
    collectLlmModels,
    llmProviderFromModel,
    resolvePricingForModel,
    resolveTokenProfileForModel,
    resolveLlmRoleDefaults,
    resolveLlmKnobDefaults,
    llmRoutingSnapshot,
    buildLlmMetrics,
    buildIndexingDomainChecklist,
    buildReviewMetrics,
    getSpecDb,
    storage,
    OUTPUT_ROOT,
    broadcastWs,
  } = ctx;

  return async function handleConfigRoutes(parts, params, method, req, res) {
    if (parts[0] === 'indexing' && parts[1] === 'llm-config' && method === 'GET') {
      const models = collectLlmModels(config);
      const modelPricing = models.map((modelName) => ({
        model: modelName,
        provider: llmProviderFromModel(modelName),
        ...resolvePricingForModel(config, modelName)
      }));
      const modelTokenProfiles = models.map((modelName) => ({
        model: modelName,
        ...resolveTokenProfileForModel(config, modelName)
      }));
      const roleDefaults = resolveLlmRoleDefaults(config);
      const knobDefaults = resolveLlmKnobDefaults(config);
      const roleTokenDefaults = {
        plan: toInt(knobDefaults.phase_02_planner?.token_cap, 1200),
        fast: toInt(knobDefaults.fast_pass?.token_cap, 1200),
        triage: toInt(knobDefaults.phase_03_triage?.token_cap, 1200),
        reasoning: toInt(knobDefaults.reasoning_pass?.token_cap, 4096),
        extract: toInt(knobDefaults.extract_role?.token_cap, 1200),
        validate: toInt(knobDefaults.validate_role?.token_cap, 1200),
        write: toInt(knobDefaults.write_role?.token_cap, 1200)
      };
      const fallbackDefaults = {
        enabled: Boolean(
          String(config.llmPlanFallbackModel || '').trim()
          || String(config.llmExtractFallbackModel || '').trim()
          || String(config.llmValidateFallbackModel || '').trim()
          || String(config.llmWriteFallbackModel || '').trim()
        ),
        plan: String(config.llmPlanFallbackModel || '').trim(),
        extract: String(config.llmExtractFallbackModel || '').trim(),
        validate: String(config.llmValidateFallbackModel || '').trim(),
        write: String(config.llmWriteFallbackModel || '').trim(),
        plan_tokens: toInt(config.llmMaxOutputTokensPlanFallback, roleTokenDefaults.plan),
        extract_tokens: toInt(config.llmMaxOutputTokensExtractFallback, roleTokenDefaults.extract),
        validate_tokens: toInt(config.llmMaxOutputTokensValidateFallback, roleTokenDefaults.validate),
        write_tokens: toInt(config.llmMaxOutputTokensWriteFallback, roleTokenDefaults.write)
      };
      return jsonRes(res, 200, {
        generated_at: new Date().toISOString(),
        phase2: {
          enabled_default: Boolean(config.llmEnabled && config.llmPlanDiscoveryQueries),
          model_default: roleDefaults.plan
        },
        phase3: {
          enabled_default: Boolean(config.llmEnabled && config.llmSerpRerankEnabled),
          model_default: roleDefaults.triage
        },
        model_defaults: roleDefaults,
        token_defaults: roleTokenDefaults,
        fallback_defaults: fallbackDefaults,
        routing_snapshot: llmRoutingSnapshot(config),
        model_options: models,
        token_presets: Array.isArray(config.llmOutputTokenPresets)
          ? config.llmOutputTokenPresets.map((value) => toInt(value, 0)).filter((value) => value > 0)
          : [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 8192],
        pricing_defaults: resolvePricingForModel(config, ''),
        model_pricing: modelPricing,
        model_token_profiles: modelTokenProfiles,
        knob_defaults: knobDefaults,
        pricing_meta: {
          as_of: String(config.llmPricingAsOf || '').trim() || null,
          sources: config.llmPricingSources && typeof config.llmPricingSources === 'object'
            ? config.llmPricingSources
            : {}
        }
      });
    }

    // Indexing metrics: LLM usage rollup
    if (parts[0] === 'indexing' && parts[1] === 'llm-metrics' && method === 'GET') {
      try {
        const period = String(params.get('period') || 'week').trim() || 'week';
        const model = String(params.get('model') || '').trim();
        const category = String(params.get('category') || '').trim();
        const runLimit = Math.max(10, toInt(params.get('runLimit'), 120));
        const result = await buildLlmMetrics({
          storage,
          config,
          period,
          model,
          category,
          runLimit
        });
        return jsonRes(res, 200, {
          command: 'llm-metrics',
          ...result
        });
      } catch (err) {
        return jsonRes(res, 500, { error: err?.message || 'llm_metrics_failed' });
      }
    }

    // Indexing metrics: domain checklist + manufacturer milestones + yield
    if (parts[0] === 'indexing' && parts[1] === 'domain-checklist' && parts[2] && method === 'GET') {
      try {
        const category = String(parts[2] || '').trim();
        if (!category) return jsonRes(res, 400, { error: 'category_required' });
        const productId = String(params.get('productId') || '').trim();
        const runId = String(params.get('runId') || '').trim();
        const windowMinutes = Math.max(5, toInt(params.get('windowMinutes'), 120));
        const includeUrls = String(params.get('includeUrls') || '').trim().toLowerCase() === 'true';
        const result = await buildIndexingDomainChecklist({
          storage,
          config,
          outputRoot: OUTPUT_ROOT,
          category,
          productId,
          runId,
          windowMinutes,
          includeUrls
        });
        return jsonRes(res, 200, {
          command: 'indexing',
          action: 'domain-checklist',
          ...result
        });
      } catch (err) {
        return jsonRes(res, 500, { error: err?.message || 'indexing_domain_checklist_failed' });
      }
    }

    // Indexing metrics: human review velocity/throughput
    if (parts[0] === 'indexing' && parts[1] === 'review-metrics' && parts[2] && method === 'GET') {
      try {
        const category = String(parts[2] || '').trim();
        const windowHours = Math.max(1, toInt(params.get('windowHours'), 24));
        if (!category) return jsonRes(res, 400, { error: 'category_required' });
        const result = await buildReviewMetrics({
          config,
          category,
          windowHours
        });
        return jsonRes(res, 200, {
          command: 'review',
          action: 'metrics',
          ...result
        });
      } catch (err) {
        return jsonRes(res, 500, { error: err?.message || 'review_metrics_failed' });
      }
    }

    // LLM settings routes (SQLite-backed matrix by category)
    if (parts[0] === 'llm-settings' && parts[1] && parts[2] === 'routes' && method === 'GET') {
      const category = parts[1];
      const scope = (params.get('scope') || '').trim().toLowerCase();
      const specDb = getSpecDb(category);
      if (!specDb) return jsonRes(res, 500, { error: 'specdb_unavailable' });
      const rows = specDb.getLlmRouteMatrix(scope || undefined);
      return jsonRes(res, 200, { category, scope: scope || null, rows });
    }

    if (parts[0] === 'llm-settings' && parts[1] && parts[2] === 'routes' && method === 'PUT') {
      const category = parts[1];
      const body = await readJsonBody(req);
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      const specDb = getSpecDb(category);
      if (!specDb) return jsonRes(res, 500, { error: 'specdb_unavailable' });
      const saved = specDb.saveLlmRouteMatrix(rows);
      broadcastWs('data-change', { type: 'llm-settings-updated', category });
      return jsonRes(res, 200, { ok: true, category, rows: saved });
    }

    if (parts[0] === 'llm-settings' && parts[1] && parts[2] === 'routes' && parts[3] === 'reset' && method === 'POST') {
      const category = parts[1];
      const specDb = getSpecDb(category);
      if (!specDb) return jsonRes(res, 500, { error: 'specdb_unavailable' });
      const rows = specDb.resetLlmRouteMatrixToDefaults();
      broadcastWs('data-change', { type: 'llm-settings-reset', category });
      return jsonRes(res, 200, { ok: true, category, rows });
    }

    // GET /api/v1/convergence-settings
    if (parts[0] === 'convergence-settings' && method === 'GET') {
      const CONVERGENCE_KEYS = [
        'convergenceMaxRounds', 'convergenceNoProgressLimit', 'convergenceMaxLowQualityRounds',
        'convergenceLowQualityConfidence', 'convergenceMaxDispatchQueries', 'convergenceMaxTargetFields',
        'needsetEvidenceDecayDays', 'needsetEvidenceDecayFloor',
        'needsetCapIdentityLocked', 'needsetCapIdentityProvisional', 'needsetCapIdentityConflict',
        'needsetCapIdentityUnlocked',
        'consensusLlmWeightTier1', 'consensusLlmWeightTier2', 'consensusLlmWeightTier3', 'consensusLlmWeightTier4',
        'consensusTier1Weight', 'consensusTier2Weight', 'consensusTier3Weight', 'consensusTier4Weight',
        'serpTriageMinScore', 'serpTriageMaxUrls', 'serpTriageEnabled',
        'retrievalMaxHitsPerField', 'retrievalMaxPrimeSources', 'retrievalIdentityFilterEnabled',
        'laneConcurrencySearch', 'laneConcurrencyFetch', 'laneConcurrencyParse', 'laneConcurrencyLlm'
      ];
      const settings = {};
      for (const key of CONVERGENCE_KEYS) {
        settings[key] = config[key];
      }
      return jsonRes(res, 200, settings);
    }

    // PUT /api/v1/convergence-settings
    if (parts[0] === 'convergence-settings' && method === 'PUT') {
      const body = await readJsonBody(req).catch(() => ({}));
      const INT_KEYS = new Set([
        'convergenceMaxRounds', 'convergenceNoProgressLimit', 'convergenceMaxLowQualityRounds',
        'convergenceMaxDispatchQueries', 'convergenceMaxTargetFields',
        'needsetEvidenceDecayDays',
        'serpTriageMinScore', 'serpTriageMaxUrls',
        'retrievalMaxHitsPerField', 'retrievalMaxPrimeSources',
        'laneConcurrencySearch', 'laneConcurrencyFetch', 'laneConcurrencyParse', 'laneConcurrencyLlm'
      ]);
      const FLOAT_KEYS = new Set([
        'convergenceLowQualityConfidence', 'needsetEvidenceDecayFloor',
        'needsetCapIdentityLocked', 'needsetCapIdentityProvisional', 'needsetCapIdentityConflict',
        'needsetCapIdentityUnlocked',
        'consensusLlmWeightTier1', 'consensusLlmWeightTier2', 'consensusLlmWeightTier3', 'consensusLlmWeightTier4',
        'consensusTier1Weight', 'consensusTier2Weight', 'consensusTier3Weight', 'consensusTier4Weight'
      ]);
      const BOOL_KEYS = new Set([
        'serpTriageEnabled', 'retrievalIdentityFilterEnabled'
      ]);
      const ALL_KEYS = new Set([...INT_KEYS, ...FLOAT_KEYS, ...BOOL_KEYS]);
      const applied = {};
      const rejected = {};
      for (const [key, value] of Object.entries(body || {})) {
        if (!ALL_KEYS.has(key)) continue;
        if (INT_KEYS.has(key)) {
          const n = Number.parseInt(String(value ?? ''), 10);
          if (!Number.isFinite(n)) { rejected[key] = 'invalid_integer'; continue; }
          const clamped = Math.max(0, n);
          config[key] = clamped;
          applied[key] = clamped;
        } else if (FLOAT_KEYS.has(key)) {
          const n = Number.parseFloat(String(value ?? ''));
          if (!Number.isFinite(n)) { rejected[key] = 'invalid_float'; continue; }
          const clamped = Math.max(0, Math.min(1, n));
          config[key] = clamped;
          applied[key] = clamped;
        } else if (BOOL_KEYS.has(key)) {
          const b = value === true || value === 'true' || value === 1;
          config[key] = b;
          applied[key] = b;
        }
      }
      broadcastWs('data-change', { type: 'convergence-settings-updated', applied });
      return jsonRes(res, 200, { ok: true, applied, ...(Object.keys(rejected).length > 0 ? { rejected } : {}) });
    }

    return false;
  };
}
