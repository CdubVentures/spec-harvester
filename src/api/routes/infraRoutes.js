export function registerInfraRoutes(ctx) {
  const {
    jsonRes,
    readJsonBody,
    listDirs,
    canonicalSlugify,
    HELPER_ROOT,
    DIST_ROOT,
    fs,
    path,
    getSearxngStatus,
    startSearxngStack,
    startProcess,
    stopProcess,
    processStatus,
    isProcessRunning,
    waitForProcessExit,
  } = ctx;

  return async function handleInfraRoutes(parts, params, method, req, res) {
    // Health
    if (parts[0] === 'health' || (parts.length === 0 && method === 'GET')) {
      return jsonRes(res, 200, {
        ok: true,
        service: 'gui-server',
        dist_root: DIST_ROOT,
        cwd: process.cwd(),
        isPkg: typeof process.pkg !== 'undefined',
      });
    }

    // Categories
    if (parts[0] === 'categories' && method === 'GET') {
      const includeTest = params.get('includeTest') === 'true';
      const cats = (await listDirs(HELPER_ROOT)).filter(c => {
        if (c === '_global') return false;          // shared config, never a category
        if (c.startsWith('_test_')) return includeTest;
        return !c.startsWith('_');
      });
      return jsonRes(res, 200, cats.length > 0 ? cats : ['mouse']);
    }

    // POST /api/v1/categories  { name }
    if (parts[0] === 'categories' && method === 'POST') {
      const body = await readJsonBody(req);
      const slug = canonicalSlugify(body?.name);
      if (!slug) return jsonRes(res, 400, { ok: false, error: 'category_name_required' });
      const catDir = path.join(HELPER_ROOT, slug);
      try { await fs.access(catDir); return jsonRes(res, 409, { ok: false, error: 'category_already_exists', slug }); } catch {}
      await fs.mkdir(catDir, { recursive: true });
      // Create stub subdirs so the category is functional
      await fs.mkdir(path.join(catDir, '_control_plane'), { recursive: true });
      await fs.mkdir(path.join(catDir, '_generated'), { recursive: true });
      const cats = (await listDirs(HELPER_ROOT)).filter(c => c !== '_global' && !c.startsWith('_'));
      return jsonRes(res, 201, { ok: true, slug, categories: cats });
    }

    // SearXNG runtime controls
    if (parts[0] === 'searxng' && parts[1] === 'status' && method === 'GET') {
      try {
        const status = await getSearxngStatus();
        return jsonRes(res, 200, status);
      } catch (err) {
        return jsonRes(res, 500, {
          error: 'searxng_status_failed',
          message: err?.message || 'searxng_status_failed'
        });
      }
    }

    if (parts[0] === 'searxng' && parts[1] === 'start' && method === 'POST') {
      try {
        const startResult = await startSearxngStack();
        if (!startResult.ok) {
          return jsonRes(res, 500, {
            error: startResult.error || 'searxng_start_failed',
            status: startResult.status || null
          });
        }
        return jsonRes(res, 200, startResult);
      } catch (err) {
        return jsonRes(res, 500, {
          error: 'searxng_start_failed',
          message: err?.message || 'searxng_start_failed'
        });
      }
    }

    // Process control - IndexLab mode only
    if (parts[0] === 'process' && parts[1] === 'start' && method === 'POST') {
      const body = await readJsonBody(req);
      const {
        category,
        productId,
        mode = 'indexlab',
        extractionMode,
        profile,
        dryRun,
        fetchConcurrency,
        perHostMinDelayMs,
        dynamicCrawleeEnabled,
        crawleeHeadless,
        crawleeRequestHandlerTimeoutSecs,
        dynamicFetchRetryBudget,
        dynamicFetchRetryBackoffMs,
        dynamicFetchPolicyMapJson,
        scannedPdfOcrEnabled,
        scannedPdfOcrPromoteCandidates,
        scannedPdfOcrBackend,
        scannedPdfOcrMaxPages,
        scannedPdfOcrMaxPairs,
        scannedPdfOcrMinCharsPerPage,
        scannedPdfOcrMinLinesPerPage,
        scannedPdfOcrMinConfidence,
        resumeMode,
        resumeWindowHours,
        reextractAfterHours,
        reextractIndexed,
        discoveryEnabled,
        searchProvider,
        phase2LlmEnabled,
        phase2LlmModel,
        phase3LlmTriageEnabled,
        phase3LlmModel,
        llmModelPlan,
        llmModelFast,
        llmModelTriage,
        llmModelReasoning,
        llmModelExtract,
        llmModelValidate,
        llmModelWrite,
        llmTokensPlan,
        llmTokensFast,
        llmTokensTriage,
        llmTokensReasoning,
        llmTokensExtract,
        llmTokensValidate,
        llmTokensWrite,
        llmFallbackEnabled,
        llmPlanFallbackModel,
        llmExtractFallbackModel,
        llmValidateFallbackModel,
        llmWriteFallbackModel,
        llmTokensPlanFallback,
        llmTokensExtractFallback,
        llmTokensValidateFallback,
        llmTokensWriteFallback,
        seed,
        fields,
        providers,
        indexlabOut,
        replaceRunning = true
      } = body;
      const cat = category || 'mouse';

      if (String(mode || 'indexlab').trim() !== 'indexlab') {
        return jsonRes(res, 400, {
          error: 'unsupported_process_mode',
          message: 'Only indexlab mode is supported in GUI process/start.'
        });
      }

      const cliArgs = ['indexlab', '--local'];

      cliArgs.push('--category', cat);

      if (productId) {
        cliArgs.push('--product-id', String(productId).trim());
      } else if (seed) {
        cliArgs.push('--seed', String(seed).trim());
      }
      const normalizedFields = Array.isArray(fields)
        ? fields.map((value) => String(value || '').trim()).filter(Boolean).join(',')
        : String(fields || '').trim();
      if (normalizedFields) {
        cliArgs.push('--fields', normalizedFields);
      }
      const normalizedProviders = Array.isArray(providers)
        ? providers.map((value) => String(value || '').trim()).filter(Boolean).join(',')
        : String(providers || '').trim();
      if (normalizedProviders) {
        cliArgs.push('--providers', normalizedProviders);
      }
      const hasDiscoveryOverride = typeof discoveryEnabled === 'boolean';
      if (hasDiscoveryOverride) {
        cliArgs.push('--discovery-enabled', discoveryEnabled ? 'true' : 'false');
      }
      const normalizedSearchProvider = String(searchProvider || '').trim().toLowerCase();
      if (normalizedSearchProvider) {
        const allowedSearchProviders = new Set(['none', 'google', 'bing', 'searxng', 'duckduckgo', 'dual']);
        if (!allowedSearchProviders.has(normalizedSearchProvider)) {
          return jsonRes(res, 400, {
            error: 'invalid_search_provider',
            message: `Unsupported searchProvider '${normalizedSearchProvider}'.`
          });
        }
        cliArgs.push('--search-provider', normalizedSearchProvider);
      }
      if (hasDiscoveryOverride && discoveryEnabled && (!normalizedSearchProvider || normalizedSearchProvider === 'none')) {
        return jsonRes(res, 400, {
          error: 'discovery_provider_required',
          message: 'discoveryEnabled=true requires searchProvider (google|bing|searxng|duckduckgo|dual).'
        });
      }
      if (indexlabOut) {
        cliArgs.push('--out', String(indexlabOut).trim());
      }

      // Extraction mode (--mode flag)
      if (extractionMode && ['balanced', 'aggressive', 'uber_aggressive'].includes(extractionMode)) {
        cliArgs.push('--mode', extractionMode);
      }

      // Run profile (fast / standard / thorough)
      if (profile && ['fast', 'standard', 'thorough'].includes(profile)) {
        cliArgs.push('--profile', profile);
      }

      // Dry run
      if (dryRun) {
        cliArgs.push('--dry-run');
      }

      const envOverrides = {};
      if (['auto', 'force_resume', 'start_over'].includes(String(resumeMode || '').trim())) {
        envOverrides.INDEXING_RESUME_MODE = String(resumeMode).trim();
      }
      const parsedResumeWindowHours = Number.parseInt(String(resumeWindowHours ?? ''), 10);
      if (Number.isFinite(parsedResumeWindowHours) && parsedResumeWindowHours >= 0) {
        envOverrides.INDEXING_RESUME_MAX_AGE_HOURS = String(parsedResumeWindowHours);
      }
      const parsedReextractAfterHours = Number.parseInt(String(reextractAfterHours ?? ''), 10);
      if (Number.isFinite(parsedReextractAfterHours) && parsedReextractAfterHours >= 0) {
        envOverrides.INDEXING_REEXTRACT_AFTER_HOURS = String(parsedReextractAfterHours);
      }
      if (typeof reextractIndexed === 'boolean') {
        envOverrides.INDEXING_REEXTRACT_ENABLED = reextractIndexed ? 'true' : 'false';
      }
      const parsedFetchConcurrency = Number.parseInt(String(fetchConcurrency ?? ''), 10);
      if (Number.isFinite(parsedFetchConcurrency) && parsedFetchConcurrency > 0) {
        envOverrides.CONCURRENCY = String(Math.max(1, Math.min(64, parsedFetchConcurrency)));
      }
      const parsedPerHostDelay = Number.parseInt(String(perHostMinDelayMs ?? ''), 10);
      if (Number.isFinite(parsedPerHostDelay) && parsedPerHostDelay >= 0) {
        envOverrides.PER_HOST_MIN_DELAY_MS = String(Math.max(0, Math.min(120_000, parsedPerHostDelay)));
      }
      if (typeof dynamicCrawleeEnabled === 'boolean') {
        envOverrides.DYNAMIC_CRAWLEE_ENABLED = dynamicCrawleeEnabled ? 'true' : 'false';
      }
      if (typeof crawleeHeadless === 'boolean') {
        envOverrides.CRAWLEE_HEADLESS = crawleeHeadless ? 'true' : 'false';
      }
      const parsedCrawleeTimeoutSecs = Number.parseInt(String(crawleeRequestHandlerTimeoutSecs ?? ''), 10);
      if (Number.isFinite(parsedCrawleeTimeoutSecs) && parsedCrawleeTimeoutSecs >= 0) {
        envOverrides.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS = String(Math.max(0, Math.min(300, parsedCrawleeTimeoutSecs)));
      }
      const parsedDynamicRetryBudget = Number.parseInt(String(dynamicFetchRetryBudget ?? ''), 10);
      if (Number.isFinite(parsedDynamicRetryBudget) && parsedDynamicRetryBudget >= 0) {
        envOverrides.DYNAMIC_FETCH_RETRY_BUDGET = String(Math.max(0, Math.min(5, parsedDynamicRetryBudget)));
      }
      const parsedDynamicRetryBackoffMs = Number.parseInt(String(dynamicFetchRetryBackoffMs ?? ''), 10);
      if (Number.isFinite(parsedDynamicRetryBackoffMs) && parsedDynamicRetryBackoffMs >= 0) {
        envOverrides.DYNAMIC_FETCH_RETRY_BACKOFF_MS = String(Math.max(0, Math.min(30_000, parsedDynamicRetryBackoffMs)));
      }
      const normalizedDynamicFetchPolicyMap = String(dynamicFetchPolicyMapJson || '').trim();
      if (normalizedDynamicFetchPolicyMap) {
        try {
          const parsedDynamicFetchPolicyMap = JSON.parse(normalizedDynamicFetchPolicyMap);
          if (!parsedDynamicFetchPolicyMap || Array.isArray(parsedDynamicFetchPolicyMap) || typeof parsedDynamicFetchPolicyMap !== 'object') {
            return jsonRes(res, 400, {
              error: 'invalid_dynamic_fetch_policy_json',
              message: 'dynamicFetchPolicyMapJson must be a JSON object.'
            });
          }
          envOverrides.DYNAMIC_FETCH_POLICY_MAP_JSON = JSON.stringify(parsedDynamicFetchPolicyMap);
        } catch {
          return jsonRes(res, 400, {
            error: 'invalid_dynamic_fetch_policy_json',
            message: 'dynamicFetchPolicyMapJson must be valid JSON.'
          });
        }
      }
      if (typeof scannedPdfOcrEnabled === 'boolean') {
        envOverrides.SCANNED_PDF_OCR_ENABLED = scannedPdfOcrEnabled ? 'true' : 'false';
      }
      if (typeof scannedPdfOcrPromoteCandidates === 'boolean') {
        envOverrides.SCANNED_PDF_OCR_PROMOTE_CANDIDATES = scannedPdfOcrPromoteCandidates ? 'true' : 'false';
      }
      const normalizedScannedOcrBackend = String(scannedPdfOcrBackend || '').trim().toLowerCase();
      if (normalizedScannedOcrBackend) {
        const allowedScannedOcrBackends = new Set(['auto', 'tesseract', 'none']);
        if (!allowedScannedOcrBackends.has(normalizedScannedOcrBackend)) {
          return jsonRes(res, 400, {
            error: 'invalid_scanned_pdf_ocr_backend',
            message: `Unsupported scannedPdfOcrBackend '${normalizedScannedOcrBackend}'.`
          });
        }
        envOverrides.SCANNED_PDF_OCR_BACKEND = normalizedScannedOcrBackend;
      }
      const parsedScannedOcrMaxPages = Number.parseInt(String(scannedPdfOcrMaxPages ?? ''), 10);
      if (Number.isFinite(parsedScannedOcrMaxPages) && parsedScannedOcrMaxPages >= 1) {
        envOverrides.SCANNED_PDF_OCR_MAX_PAGES = String(Math.max(1, Math.min(100, parsedScannedOcrMaxPages)));
      }
      const parsedScannedOcrMaxPairs = Number.parseInt(String(scannedPdfOcrMaxPairs ?? ''), 10);
      if (Number.isFinite(parsedScannedOcrMaxPairs) && parsedScannedOcrMaxPairs >= 50) {
        envOverrides.SCANNED_PDF_OCR_MAX_PAIRS = String(Math.max(50, Math.min(20_000, parsedScannedOcrMaxPairs)));
      }
      const parsedScannedOcrMinChars = Number.parseInt(String(scannedPdfOcrMinCharsPerPage ?? ''), 10);
      if (Number.isFinite(parsedScannedOcrMinChars) && parsedScannedOcrMinChars >= 1) {
        envOverrides.SCANNED_PDF_OCR_MIN_CHARS_PER_PAGE = String(Math.max(1, Math.min(500, parsedScannedOcrMinChars)));
      }
      const parsedScannedOcrMinLines = Number.parseInt(String(scannedPdfOcrMinLinesPerPage ?? ''), 10);
      if (Number.isFinite(parsedScannedOcrMinLines) && parsedScannedOcrMinLines >= 1) {
        envOverrides.SCANNED_PDF_OCR_MIN_LINES_PER_PAGE = String(Math.max(1, Math.min(100, parsedScannedOcrMinLines)));
      }
      const parsedScannedOcrMinConfidence = Number.parseFloat(String(scannedPdfOcrMinConfidence ?? ''));
      if (Number.isFinite(parsedScannedOcrMinConfidence) && parsedScannedOcrMinConfidence >= 0) {
        const clampedConfidence = Math.max(0, Math.min(1, parsedScannedOcrMinConfidence));
        envOverrides.SCANNED_PDF_OCR_MIN_CONFIDENCE = String(clampedConfidence);
      }
      const hasPhase2LlmOverride = typeof phase2LlmEnabled === 'boolean';
      if (hasPhase2LlmOverride) {
        envOverrides.LLM_PLAN_DISCOVERY_QUERIES = phase2LlmEnabled ? 'true' : 'false';
      }
      const normalizedPhase2LlmModel = String(phase2LlmModel || '').trim();
      if (normalizedPhase2LlmModel) {
        envOverrides.LLM_MODEL_PLAN = normalizedPhase2LlmModel;
      }
      const hasPhase3LlmOverride = typeof phase3LlmTriageEnabled === 'boolean';
      if (hasPhase3LlmOverride) {
        envOverrides.LLM_SERP_RERANK_ENABLED = phase3LlmTriageEnabled ? 'true' : 'false';
      }
      const normalizedPhase3LlmModel = String(phase3LlmModel || '').trim();
      if (normalizedPhase3LlmModel) {
        envOverrides.LLM_MODEL_TRIAGE = normalizedPhase3LlmModel;
        envOverrides.CORTEX_MODEL_RERANK_FAST = normalizedPhase3LlmModel;
      }

      const applyModelOverride = (envKey, value, { allowEmpty = false } = {}) => {
        if (value === undefined || value === null) return false;
        const token = String(value || '').trim();
        if (!token && !allowEmpty) return false;
        envOverrides[envKey] = token;
        return Boolean(token);
      };
      const applyTokenOverride = (envKey, value) => {
        if (value === undefined || value === null || value === '') return false;
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return false;
        envOverrides[envKey] = String(parsed);
        return true;
      };

      const hasRoleModelOverride = [
        applyModelOverride('LLM_MODEL_PLAN', llmModelPlan),
        applyModelOverride('LLM_MODEL_FAST', llmModelFast),
        applyModelOverride('LLM_MODEL_TRIAGE', llmModelTriage),
        applyModelOverride('LLM_MODEL_REASONING', llmModelReasoning),
        applyModelOverride('LLM_MODEL_EXTRACT', llmModelExtract),
        applyModelOverride('LLM_MODEL_VALIDATE', llmModelValidate),
        applyModelOverride('LLM_MODEL_WRITE', llmModelWrite)
      ].some(Boolean);

      const normalizedTriageForCortex = String(llmModelTriage || '').trim();
      if (normalizedTriageForCortex) {
        envOverrides.CORTEX_MODEL_RERANK_FAST = normalizedTriageForCortex;
        envOverrides.CORTEX_MODEL_SEARCH_FAST = normalizedTriageForCortex;
      }

      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_PLAN', llmTokensPlan);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_FAST', llmTokensFast);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_TRIAGE', llmTokensTriage);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_REASONING', llmTokensReasoning);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_EXTRACT', llmTokensExtract);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_VALIDATE', llmTokensValidate);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_WRITE', llmTokensWrite);

      const hasFallbackToggle = typeof llmFallbackEnabled === 'boolean';
      if (hasFallbackToggle && !llmFallbackEnabled) {
        envOverrides.LLM_PLAN_FALLBACK_MODEL = '';
        envOverrides.LLM_EXTRACT_FALLBACK_MODEL = '';
        envOverrides.LLM_VALIDATE_FALLBACK_MODEL = '';
        envOverrides.LLM_WRITE_FALLBACK_MODEL = '';
        envOverrides.LLM_MAX_OUTPUT_TOKENS_PLAN_FALLBACK = '';
        envOverrides.LLM_MAX_OUTPUT_TOKENS_EXTRACT_FALLBACK = '';
        envOverrides.LLM_MAX_OUTPUT_TOKENS_VALIDATE_FALLBACK = '';
        envOverrides.LLM_MAX_OUTPUT_TOKENS_WRITE_FALLBACK = '';
      } else {
        applyModelOverride('LLM_PLAN_FALLBACK_MODEL', llmPlanFallbackModel, { allowEmpty: true });
        applyModelOverride('LLM_EXTRACT_FALLBACK_MODEL', llmExtractFallbackModel, { allowEmpty: true });
        applyModelOverride('LLM_VALIDATE_FALLBACK_MODEL', llmValidateFallbackModel, { allowEmpty: true });
        applyModelOverride('LLM_WRITE_FALLBACK_MODEL', llmWriteFallbackModel, { allowEmpty: true });
        applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_PLAN_FALLBACK', llmTokensPlanFallback);
        applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_EXTRACT_FALLBACK', llmTokensExtractFallback);
        applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_VALIDATE_FALLBACK', llmTokensValidateFallback);
        applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_WRITE_FALLBACK', llmTokensWriteFallback);
      }

      if (
        (hasPhase2LlmOverride && phase2LlmEnabled)
        || (hasPhase3LlmOverride && phase3LlmTriageEnabled)
        || hasRoleModelOverride
      ) {
        envOverrides.LLM_ENABLED = 'true';
      }

      try {
        if (replaceRunning && isProcessRunning()) {
          await stopProcess(9000);
          const exited = await waitForProcessExit(8000);
          if (!exited && isProcessRunning()) {
            return jsonRes(res, 409, { error: 'process_replace_timeout', message: 'Existing process did not stop in time' });
          }
        }
        const status = startProcess('src/cli/spec.js', cliArgs, envOverrides);
        return jsonRes(res, 200, status);
      } catch (err) {
        return jsonRes(res, 409, { error: err.message });
      }
    }

    if (parts[0] === 'process' && parts[1] === 'stop' && method === 'POST') {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        body = {};
      }
      const force = Boolean(body?.force);
      const status = await stopProcess(9000, { force });
      return jsonRes(res, 200, status);
    }

    if (parts[0] === 'process' && parts[1] === 'status' && method === 'GET') {
      return jsonRes(res, 200, processStatus());
    }

    // GraphQL proxy
    if (parts[0] === 'graphql' && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const proxyRes = await fetch(`http://localhost:8787/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const proxyData = await proxyRes.json();
        return jsonRes(res, proxyRes.status, proxyData);
      } catch {
        return jsonRes(res, 502, { error: 'graphql_proxy_failed' });
      }
    }

    return false;
  };
}
