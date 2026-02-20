import fs from 'node:fs';
import path from 'node:path';

function parseIntEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : defaultValue;
}

function parseFloatEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

function parseBoolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const norm = String(raw).trim().toLowerCase();
  return norm === '1' || norm === 'true' || norm === 'yes' || norm === 'on';
}

function parseJsonEnv(name, defaultValue = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultValue;
  }
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : defaultValue;
  } catch {
    return defaultValue;
  }
}

function normalizeModelPricingMap(input = {}) {
  const output = {};
  if (!input || typeof input !== 'object') {
    return output;
  }
  for (const [rawModel, rawRates] of Object.entries(input)) {
    const model = String(rawModel || '').trim();
    if (!model || !rawRates || typeof rawRates !== 'object') continue;
    const inPer1M = Number.parseFloat(String(rawRates.inputPer1M ?? rawRates.input_per_1m ?? rawRates.input ?? ''));
    const outPer1M = Number.parseFloat(String(rawRates.outputPer1M ?? rawRates.output_per_1m ?? rawRates.output ?? ''));
    const cachedPer1M = Number.parseFloat(String(rawRates.cachedInputPer1M ?? rawRates.cached_input_per_1m ?? rawRates.cached_input ?? rawRates.cached ?? ''));
    output[model] = {
      inputPer1M: Number.isFinite(inPer1M) ? inPer1M : 0,
      outputPer1M: Number.isFinite(outPer1M) ? outPer1M : 0,
      cachedInputPer1M: Number.isFinite(cachedPer1M) ? cachedPer1M : 0
    };
  }
  return output;
}

function hasS3EnvCreds() {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

function normalizeOutputMode(value, fallback = 'dual') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'local' || token === 'dual' || token === 's3') {
    return token;
  }
  return fallback;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function defaultChatmockDir() {
  const profile = String(process.env.USERPROFILE || '').trim();
  if (!profile) {
    return '';
  }
  return path.join(profile, 'Desktop', 'ChatMock');
}

function inferLlmProvider(baseUrl, model, hasDeepSeekKey) {
  const baseToken = normalizeBaseUrl(baseUrl).toLowerCase();
  const modelToken = String(model || '').toLowerCase();
  if (baseToken.includes('deepseek.com') || modelToken.startsWith('deepseek') || hasDeepSeekKey) {
    return 'deepseek';
  }
  return 'openai';
}

export function normalizeRunProfile(value) {
  const token = String(value || '').trim().toLowerCase();
  if (['thorough', 'deep', 'full', 'max'].includes(token)) {
    return 'thorough';
  }
  if (['fast', 'quick', 'lean'].includes(token)) {
    return 'fast';
  }
  return 'standard';
}

function intMax(current, floor) {
  return Math.max(Number.parseInt(String(current || 0), 10) || 0, floor);
}

function intMin(current, ceiling) {
  const parsed = Number.parseInt(String(current || 0), 10) || 0;
  return Math.min(parsed, ceiling);
}

export function applyRunProfile(config, profile) {
  const normalizedProfile = normalizeRunProfile(profile || config.runProfile);
  const next = {
    ...config,
    runProfile: normalizedProfile
  };

  if (normalizedProfile === 'thorough') {
    next.maxRunSeconds = intMax(next.maxRunSeconds, 3600);
    next.maxUrlsPerProduct = intMax(next.maxUrlsPerProduct, 220);
    next.maxCandidateUrls = intMax(next.maxCandidateUrls, 280);
    next.maxPagesPerDomain = intMax(next.maxPagesPerDomain, 8);
    next.maxManufacturerUrlsPerProduct = intMax(next.maxManufacturerUrlsPerProduct, 140);
    next.maxManufacturerPagesPerDomain = intMax(next.maxManufacturerPagesPerDomain, 50);
    next.manufacturerReserveUrls = intMax(next.manufacturerReserveUrls, 100);
    next.maxJsonBytes = intMax(next.maxJsonBytes, 6_000_000);
    next.maxGraphqlReplays = intMax(next.maxGraphqlReplays, 20);
    next.maxHypothesisItems = intMax(next.maxHypothesisItems, 120);
    next.maxNetworkResponsesPerPage = intMax(next.maxNetworkResponsesPerPage, 2500);
    next.endpointNetworkScanLimit = intMax(next.endpointNetworkScanLimit, 1800);
    next.endpointSignalLimit = intMax(next.endpointSignalLimit, 120);
    next.endpointSuggestionLimit = intMax(next.endpointSuggestionLimit, 36);
    next.hypothesisAutoFollowupRounds = intMax(next.hypothesisAutoFollowupRounds, 2);
    next.hypothesisFollowupUrlsPerRound = intMax(next.hypothesisFollowupUrlsPerRound, 24);
    next.pageGotoTimeoutMs = intMax(next.pageGotoTimeoutMs, 45_000);
    next.pageNetworkIdleTimeoutMs = intMax(next.pageNetworkIdleTimeoutMs, 15_000);
    next.postLoadWaitMs = intMax(next.postLoadWaitMs, 10_000);
    next.autoScrollEnabled = true;
    next.autoScrollPasses = intMax(next.autoScrollPasses, 3);
    next.autoScrollDelayMs = intMax(next.autoScrollDelayMs, 1200);
    next.discoveryEnabled = true;
    next.fetchCandidateSources = true;
    next.discoveryMaxQueries = intMax(next.discoveryMaxQueries, 24);
    next.discoveryResultsPerQuery = intMax(next.discoveryResultsPerQuery, 20);
    next.discoveryMaxDiscovered = intMax(next.discoveryMaxDiscovered, 300);
    next.discoveryQueryConcurrency = intMax(next.discoveryQueryConcurrency, 8);
    next.llmPlanDiscoveryQueries = true;
    next.manufacturerBroadDiscovery = true;
    next.preferHttpFetcher = false;
  } else if (normalizedProfile === 'fast') {
    next.maxRunSeconds = intMin(next.maxRunSeconds, 180);
    next.maxUrlsPerProduct = intMin(next.maxUrlsPerProduct, 12);
    next.maxCandidateUrls = intMin(next.maxCandidateUrls, 20);
    next.maxPagesPerDomain = intMin(next.maxPagesPerDomain, 2);
    next.maxManufacturerUrlsPerProduct = intMin(next.maxManufacturerUrlsPerProduct, 10);
    next.maxManufacturerPagesPerDomain = intMin(next.maxManufacturerPagesPerDomain, 5);
    next.manufacturerReserveUrls = intMin(next.manufacturerReserveUrls, 4);
    next.discoveryMaxQueries = intMin(next.discoveryMaxQueries, 4);
    next.discoveryResultsPerQuery = intMin(next.discoveryResultsPerQuery, 6);
    next.discoveryMaxDiscovered = intMin(next.discoveryMaxDiscovered, 60);
    next.discoveryQueryConcurrency = intMax(next.discoveryQueryConcurrency, 4);
    next.perHostMinDelayMs = intMin(next.perHostMinDelayMs, 150);
    next.pageGotoTimeoutMs = intMin(next.pageGotoTimeoutMs, 12_000);
    next.pageNetworkIdleTimeoutMs = intMin(next.pageNetworkIdleTimeoutMs, 1_500);
    next.endpointSignalLimit = intMin(next.endpointSignalLimit, 24);
    next.endpointSuggestionLimit = intMin(next.endpointSuggestionLimit, 8);
    next.endpointNetworkScanLimit = intMin(next.endpointNetworkScanLimit, 400);
    next.hypothesisAutoFollowupRounds = intMin(next.hypothesisAutoFollowupRounds, 0);
    next.hypothesisFollowupUrlsPerRound = intMin(next.hypothesisFollowupUrlsPerRound, 8);
    next.postLoadWaitMs = intMin(next.postLoadWaitMs, 0);
    next.autoScrollEnabled = false;
    next.autoScrollPasses = 0;
    next.preferHttpFetcher = true;
  }

  next.manufacturerReserveUrls = Math.max(
    0,
    Math.min(next.maxUrlsPerProduct, next.manufacturerReserveUrls)
  );
  next.maxManufacturerUrlsPerProduct = Math.max(
    1,
    Math.min(next.maxUrlsPerProduct, next.maxManufacturerUrlsPerProduct)
  );

  return next;
}

function parseDotEnvValue(rawValue) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    return '';
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }

  const commentIndex = trimmed.indexOf(' #');
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

export function loadDotEnvFile(dotEnvPath = '.env') {
  const fullPath = path.resolve(dotEnvPath);
  let content = '';

  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const separatorIndex = withoutExport.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (process.env[key] !== undefined) {
      continue;
    }

    const rawValue = withoutExport.slice(separatorIndex + 1);
    process.env[key] = parseDotEnvValue(rawValue);
  }

  return true;
}

export function loadConfig(overrides = {}) {
  const maxCandidateUrlsFromEnv =
    process.env.MAX_CANDIDATE_URLS_PER_PRODUCT ||
    process.env.MAX_CANDIDATE_URLS;

  const parsedCandidateUrls = Number.parseInt(String(maxCandidateUrlsFromEnv || ''), 10);
  const hasDeepSeekKey = Boolean(process.env.DEEPSEEK_API_KEY);
  const resolvedApiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  const resolvedBaseUrl = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL ||
    (hasDeepSeekKey ? 'https://api.deepseek.com' : 'https://api.openai.com');
  const defaultModel = process.env.LLM_MODEL_EXTRACT || (hasDeepSeekKey ? 'deepseek-reasoner' : 'gpt-4.1-mini');
  const timeoutMs = parseIntEnv('LLM_TIMEOUT_MS', parseIntEnv('OPENAI_TIMEOUT_MS', 40_000));
  const envOutputMode = normalizeOutputMode(process.env.OUTPUT_MODE || 'dual', 'dual');
  const hasS3Creds = hasS3EnvCreds();
  const defaultMirrorToS3 = envOutputMode !== 'local' && hasS3Creds;

  const cfg = {
    awsRegion: process.env.AWS_REGION || 'us-east-2',
    s3Bucket: process.env.S3_BUCKET || 'my-spec-harvester-data',
    s3InputPrefix: (process.env.S3_INPUT_PREFIX || 'specs/inputs').replace(/\/+$/, ''),
    s3OutputPrefix: (process.env.S3_OUTPUT_PREFIX || 'specs/outputs').replace(/\/+$/, ''),
    maxUrlsPerProduct: parseIntEnv('MAX_URLS_PER_PRODUCT', 20),
    maxCandidateUrls: Number.isFinite(parsedCandidateUrls) ? parsedCandidateUrls : 50,
    maxPagesPerDomain: parseIntEnv('MAX_PAGES_PER_DOMAIN', 2),
    manufacturerDeepResearchEnabled: parseBoolEnv('MANUFACTURER_DEEP_RESEARCH_ENABLED', true),
    maxManufacturerUrlsPerProduct: parseIntEnv('MAX_MANUFACTURER_URLS_PER_PRODUCT', 20),
    maxManufacturerPagesPerDomain: parseIntEnv('MAX_MANUFACTURER_PAGES_PER_DOMAIN', 8),
    manufacturerReserveUrls: parseIntEnv('MANUFACTURER_RESERVE_URLS', 10),
    maxRunSeconds: parseIntEnv('MAX_RUN_SECONDS', 300),
    maxJsonBytes: parseIntEnv('MAX_JSON_BYTES', 2_000_000),
    maxPdfBytes: parseIntEnv('MAX_PDF_BYTES', 8_000_000),
    concurrency: parseIntEnv('CONCURRENCY', 2),
    perHostMinDelayMs: parseIntEnv('PER_HOST_MIN_DELAY_MS', 900),
    userAgent:
      process.env.USER_AGENT ||
      'Mozilla/5.0 (compatible; EGSpecHarvester/1.0; +https://eggear.com)',
    localMode: parseBoolEnv('LOCAL_MODE', false),
    dryRun: parseBoolEnv('DRY_RUN', false),
    outputMode: envOutputMode,
    mirrorToS3: parseBoolEnv('MIRROR_TO_S3', defaultMirrorToS3),
    mirrorToS3Input: parseBoolEnv('MIRROR_TO_S3_INPUT', false),
    localInputRoot: process.env.LOCAL_INPUT_ROOT || process.env.LOCAL_S3_ROOT || 'fixtures/s3',
    localOutputRoot: process.env.LOCAL_OUTPUT_ROOT || 'out',
    runtimeEventsKey: process.env.RUNTIME_EVENTS_KEY || '_runtime/events.jsonl',
    writeMarkdownSummary: parseBoolEnv('WRITE_MARKDOWN_SUMMARY', true),
    runProfile: normalizeRunProfile(process.env.RUN_PROFILE || 'standard'),
    discoveryEnabled: parseBoolEnv('DISCOVERY_ENABLED', false),
    fetchCandidateSources: parseBoolEnv('FETCH_CANDIDATE_SOURCES', true),
    discoveryMaxQueries: parseIntEnv('DISCOVERY_MAX_QUERIES', 8),
    discoveryResultsPerQuery: parseIntEnv('DISCOVERY_RESULTS_PER_QUERY', 10),
    discoveryMaxDiscovered: parseIntEnv('DISCOVERY_MAX_DISCOVERED', 120),
    discoveryQueryConcurrency: parseIntEnv('DISCOVERY_QUERY_CONCURRENCY', 4),
    searchProvider: process.env.SEARCH_PROVIDER || 'none',
    searxngBaseUrl: process.env.SEARXNG_BASE_URL || process.env.SEARXNG_URL || '',
    bingSearchKey: process.env.BING_SEARCH_KEY || '',
    bingSearchEndpoint: process.env.BING_SEARCH_ENDPOINT || '',
    googleCseKey: process.env.GOOGLE_CSE_KEY || '',
    googleCseCx: process.env.GOOGLE_CSE_CX || '',
    disableGoogleCse: parseBoolEnv('DISABLE_GOOGLE_CSE', false),
    cseRescueOnlyMode: parseBoolEnv('CSE_RESCUE_ONLY_MODE', true),
    cseRescueRequiredIteration: parseIntEnv('CSE_RESCUE_REQUIRED_ITERATION', 2),
    duckduckgoEnabled: parseBoolEnv('DUCKDUCKGO_ENABLED', true),
    duckduckgoBaseUrl: process.env.DUCKDUCKGO_BASE_URL || 'https://html.duckduckgo.com/html/',
    duckduckgoTimeoutMs: parseIntEnv('DUCKDUCKGO_TIMEOUT_MS', 8_000),
    eloSupabaseAnonKey: process.env.ELO_SUPABASE_ANON_KEY || '',
    eloSupabaseEndpoint: process.env.ELO_SUPABASE_ENDPOINT || '',
    llmEnabled: parseBoolEnv('LLM_ENABLED', false),
    llmWriteSummary: parseBoolEnv('LLM_WRITE_SUMMARY', false),
    llmPlanDiscoveryQueries: parseBoolEnv('LLM_PLAN_DISCOVERY_QUERIES', false),
    llmProvider: (process.env.LLM_PROVIDER || '').trim().toLowerCase(),
    llmApiKey: resolvedApiKey,
    llmBaseUrl: resolvedBaseUrl,
    llmModelExtract: process.env.LLM_MODEL_EXTRACT || defaultModel,
    llmModelPlan: process.env.LLM_MODEL_PLAN || process.env.LLM_MODEL_EXTRACT || defaultModel,
    llmModelFast:
      process.env.LLM_MODEL_FAST ||
      process.env.LLM_MODEL_EXTRACT ||
      defaultModel,
    llmModelTriage:
      process.env.LLM_MODEL_TRIAGE ||
      process.env.CORTEX_MODEL_RERANK_FAST ||
      process.env.CORTEX_MODEL_SEARCH_FAST ||
      process.env.LLM_MODEL_FAST ||
      process.env.LLM_MODEL_PLAN ||
      process.env.LLM_MODEL_EXTRACT ||
      defaultModel,
    llmModelReasoning:
      process.env.LLM_MODEL_REASONING ||
      process.env.LLM_MODEL_EXTRACT ||
      defaultModel,
    llmModelValidate:
      process.env.LLM_MODEL_VALIDATE ||
      process.env.LLM_MODEL_PLAN ||
      process.env.LLM_MODEL_EXTRACT ||
      defaultModel,
    llmModelWrite:
      process.env.LLM_MODEL_WRITE ||
      process.env.LLM_MODEL_VALIDATE ||
      process.env.LLM_MODEL_PLAN ||
      process.env.LLM_MODEL_EXTRACT ||
      defaultModel,
    llmPlanProvider: (process.env.LLM_PLAN_PROVIDER || '').trim().toLowerCase(),
    llmPlanBaseUrl: process.env.LLM_PLAN_BASE_URL || '',
    llmPlanApiKey: process.env.LLM_PLAN_API_KEY || '',
    llmPlanFallbackModel: process.env.LLM_PLAN_FALLBACK_MODEL || '',
    llmPlanFallbackProvider: (process.env.LLM_PLAN_FALLBACK_PROVIDER || '').trim().toLowerCase(),
    llmPlanFallbackBaseUrl: process.env.LLM_PLAN_FALLBACK_BASE_URL || '',
    llmPlanFallbackApiKey: process.env.LLM_PLAN_FALLBACK_API_KEY || '',
    llmExtractProvider: (process.env.LLM_EXTRACT_PROVIDER || '').trim().toLowerCase(),
    llmExtractBaseUrl: process.env.LLM_EXTRACT_BASE_URL || '',
    llmExtractApiKey: process.env.LLM_EXTRACT_API_KEY || '',
    llmExtractFallbackModel: process.env.LLM_EXTRACT_FALLBACK_MODEL || '',
    llmExtractFallbackProvider: (process.env.LLM_EXTRACT_FALLBACK_PROVIDER || '').trim().toLowerCase(),
    llmExtractFallbackBaseUrl: process.env.LLM_EXTRACT_FALLBACK_BASE_URL || '',
    llmExtractFallbackApiKey: process.env.LLM_EXTRACT_FALLBACK_API_KEY || '',
    llmValidateProvider: (process.env.LLM_VALIDATE_PROVIDER || '').trim().toLowerCase(),
    llmValidateBaseUrl: process.env.LLM_VALIDATE_BASE_URL || '',
    llmValidateApiKey: process.env.LLM_VALIDATE_API_KEY || '',
    llmValidateFallbackModel: process.env.LLM_VALIDATE_FALLBACK_MODEL || '',
    llmValidateFallbackProvider: (process.env.LLM_VALIDATE_FALLBACK_PROVIDER || '').trim().toLowerCase(),
    llmValidateFallbackBaseUrl: process.env.LLM_VALIDATE_FALLBACK_BASE_URL || '',
    llmValidateFallbackApiKey: process.env.LLM_VALIDATE_FALLBACK_API_KEY || '',
    llmWriteProvider: (process.env.LLM_WRITE_PROVIDER || '').trim().toLowerCase(),
    llmWriteBaseUrl: process.env.LLM_WRITE_BASE_URL || '',
    llmWriteApiKey: process.env.LLM_WRITE_API_KEY || '',
    llmWriteFallbackModel: process.env.LLM_WRITE_FALLBACK_MODEL || '',
    llmWriteFallbackProvider: (process.env.LLM_WRITE_FALLBACK_PROVIDER || '').trim().toLowerCase(),
    llmWriteFallbackBaseUrl: process.env.LLM_WRITE_FALLBACK_BASE_URL || '',
    llmWriteFallbackApiKey: process.env.LLM_WRITE_FALLBACK_API_KEY || '',
    llmSerpRerankEnabled: parseBoolEnv('LLM_SERP_RERANK_ENABLED', false),
    llmModelCatalog: process.env.LLM_MODEL_CATALOG || '',
    llmModelPricingMap: normalizeModelPricingMap(parseJsonEnv('LLM_MODEL_PRICING_JSON', {})),
    cortexEnabled: parseBoolEnv('CORTEX_ENABLED', false),
    chatmockDir: process.env.CHATMOCK_DIR || defaultChatmockDir(),
    chatmockComposeFile: process.env.CHATMOCK_COMPOSE_FILE
      || path.join(process.env.CHATMOCK_DIR || defaultChatmockDir(), 'docker-compose.yml'),
    cortexBaseUrl: process.env.CORTEX_BASE_URL || 'http://localhost:5001/v1',
    cortexApiKey: process.env.CORTEX_API_KEY || 'key',
    cortexAsyncBaseUrl: process.env.CORTEX_ASYNC_BASE_URL || 'http://localhost:4000/api',
    cortexAsyncSubmitPath: process.env.CORTEX_ASYNC_SUBMIT_PATH || '/jobs',
    cortexAsyncStatusPath: process.env.CORTEX_ASYNC_STATUS_PATH || '/jobs/{id}',
    cortexAsyncEnabled: parseBoolEnv('CORTEX_ASYNC_ENABLED', true),
    cortexModelFast: process.env.CORTEX_MODEL_FAST || 'gpt-5-low',
    cortexModelAudit: process.env.CORTEX_MODEL_AUDIT || process.env.CORTEX_MODEL_FAST || 'gpt-5-low',
    cortexModelDom: process.env.CORTEX_MODEL_DOM || process.env.CORTEX_MODEL_FAST || 'gpt-5-low',
    cortexModelReasoningDeep: process.env.CORTEX_MODEL_REASONING_DEEP || 'gpt-5-high',
    cortexModelVision: process.env.CORTEX_MODEL_VISION || process.env.CORTEX_MODEL_REASONING_DEEP || 'gpt-5-high',
    cortexModelSearchFast: process.env.CORTEX_MODEL_SEARCH_FAST || process.env.CORTEX_MODEL_FAST || 'gpt-5-low',
    cortexModelRerankFast: process.env.CORTEX_MODEL_RERANK_FAST || process.env.CORTEX_MODEL_SEARCH_FAST || process.env.CORTEX_MODEL_FAST || 'gpt-5-low',
    cortexModelSearchDeep: process.env.CORTEX_MODEL_SEARCH_DEEP || process.env.CORTEX_MODEL_REASONING_DEEP || 'gpt-5-high',
    cortexEscalateConfidenceLt: parseFloatEnv('CORTEX_ESCALATE_CONFIDENCE_LT', 0.85),
    cortexEscalateIfConflict: parseBoolEnv('CORTEX_ESCALATE_IF_CONFLICT', true),
    cortexEscalateCriticalOnly: parseBoolEnv('CORTEX_ESCALATE_CRITICAL_ONLY', true),
    cortexMaxDeepFieldsPerProduct: parseIntEnv('CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT', 12),
    aggressiveModeEnabled: parseBoolEnv('AGGRESSIVE_MODE_ENABLED', false),
    aggressiveConfidenceThreshold: parseFloatEnv('AGGRESSIVE_CONFIDENCE_THRESHOLD', 0.85),
    aggressiveMaxSearchQueries: parseIntEnv('AGGRESSIVE_MAX_SEARCH_QUERIES', 5),
    aggressiveEvidenceAuditEnabled: parseBoolEnv('AGGRESSIVE_EVIDENCE_AUDIT_ENABLED', true),
    aggressiveEvidenceAuditBatchSize: parseIntEnv('AGGRESSIVE_EVIDENCE_AUDIT_BATCH_SIZE', 60),
    aggressiveMaxTimePerProductMs: parseIntEnv('AGGRESSIVE_MAX_TIME_PER_PRODUCT_MS', 600_000),
    aggressiveThoroughFromRound: parseIntEnv('AGGRESSIVE_THOROUGH_FROM_ROUND', 2),
    aggressiveRound1MaxUrls: parseIntEnv('AGGRESSIVE_ROUND1_MAX_URLS', 90),
    aggressiveRound1MaxCandidateUrls: parseIntEnv('AGGRESSIVE_ROUND1_MAX_CANDIDATE_URLS', 120),
    aggressiveLlmMaxCallsPerRound: parseIntEnv('AGGRESSIVE_LLM_MAX_CALLS_PER_ROUND', 16),
    aggressiveLlmMaxCallsPerProductTotal: parseIntEnv('AGGRESSIVE_LLM_MAX_CALLS_PER_PRODUCT_TOTAL', 48),
    aggressiveLlmTargetMaxFields: parseIntEnv('AGGRESSIVE_LLM_TARGET_MAX_FIELDS', 75),
    aggressiveLlmDiscoveryPasses: parseIntEnv('AGGRESSIVE_LLM_DISCOVERY_PASSES', 3),
    aggressiveLlmDiscoveryQueryCap: parseIntEnv('AGGRESSIVE_LLM_DISCOVERY_QUERY_CAP', 24),
    uberAggressiveEnabled: parseBoolEnv('UBER_AGGRESSIVE_ENABLED', false),
    uberMaxUrlsPerProduct: parseIntEnv('UBER_MAX_URLS_PER_PRODUCT', 25),
    uberMaxUrlsPerDomain: parseIntEnv('UBER_MAX_URLS_PER_DOMAIN', 6),
    uberMaxRounds: parseIntEnv('UBER_MAX_ROUNDS', 6),
    specDbDir: process.env.SPEC_DB_DIR || '.specfactory_tmp',
    frontierDbPath: process.env.FRONTIER_DB_PATH || '_intel/frontier/frontier.json',
    frontierEnableSqlite: parseBoolEnv('FRONTIER_ENABLE_SQLITE', true),
    frontierStripTrackingParams: parseBoolEnv('FRONTIER_STRIP_TRACKING_PARAMS', true),
    frontierQueryCooldownSeconds: parseIntEnv('FRONTIER_QUERY_COOLDOWN_SECONDS', 6 * 60 * 60),
    frontierCooldown404Seconds: parseIntEnv('FRONTIER_COOLDOWN_404', 72 * 60 * 60),
    frontierCooldown404RepeatSeconds: parseIntEnv('FRONTIER_COOLDOWN_404_REPEAT', 14 * 24 * 60 * 60),
    frontierCooldown410Seconds: parseIntEnv('FRONTIER_COOLDOWN_410', 90 * 24 * 60 * 60),
    frontierCooldownTimeoutSeconds: parseIntEnv('FRONTIER_COOLDOWN_TIMEOUT', 6 * 60 * 60),
    frontierCooldown429BaseSeconds: parseIntEnv('FRONTIER_COOLDOWN_429_BASE', 15 * 60),
    runtimeTraceEnabled: parseBoolEnv('RUNTIME_TRACE_ENABLED', true),
    runtimeTraceFetchRing: parseIntEnv('RUNTIME_TRACE_FETCH_RING', 30),
    runtimeTraceLlmRing: parseIntEnv('RUNTIME_TRACE_LLM_RING', 50),
    indexingResumeMode: (process.env.INDEXING_RESUME_MODE || 'auto').trim().toLowerCase(),
    indexingResumeMaxAgeHours: parseIntEnv('INDEXING_RESUME_MAX_AGE_HOURS', 48),
    indexingResumeSeedLimit: parseIntEnv('INDEXING_RESUME_SEED_LIMIT', 24),
    indexingResumePersistLimit: parseIntEnv('INDEXING_RESUME_PERSIST_LIMIT', 160),
    indexingResumeRetryPersistLimit: parseIntEnv('INDEXING_RESUME_RETRY_PERSIST_LIMIT', 80),
    indexingResumeSuccessPersistLimit: parseIntEnv('INDEXING_RESUME_SUCCESS_PERSIST_LIMIT', 240),
    indexingReextractEnabled: parseBoolEnv('INDEXING_REEXTRACT_ENABLED', true),
    indexingReextractAfterHours: parseIntEnv('INDEXING_REEXTRACT_AFTER_HOURS', 24),
    indexingReextractSeedLimit: parseIntEnv('INDEXING_REEXTRACT_SEED_LIMIT', 8),
    indexingHelperFilesEnabled: parseBoolEnv('INDEXING_HELPER_FILES_ENABLED', false),
    runtimeControlFile: process.env.RUNTIME_CONTROL_FILE || '_runtime/control/runtime_overrides.json',
    runtimeCaptureScreenshots: parseBoolEnv('RUNTIME_CAPTURE_SCREENSHOTS', false),
    runtimeScreenshotMode: process.env.RUNTIME_SCREENSHOT_MODE || 'last_only',
    cortexSyncTimeoutMs: parseIntEnv('CORTEX_SYNC_TIMEOUT_MS', 60_000),
    cortexAsyncPollIntervalMs: parseIntEnv('CORTEX_ASYNC_POLL_INTERVAL_MS', 5_000),
    cortexAsyncMaxWaitMs: parseIntEnv('CORTEX_ASYNC_MAX_WAIT_MS', 900_000),
    cortexAutoStart: parseBoolEnv('CORTEX_AUTO_START', true),
    cortexAutoRestartOnAuth: parseBoolEnv('CORTEX_AUTO_RESTART_ON_AUTH', true),
    cortexEnsureReadyTimeoutMs: parseIntEnv('CORTEX_ENSURE_READY_TIMEOUT_MS', 15_000),
    cortexStartReadyTimeoutMs: parseIntEnv('CORTEX_START_READY_TIMEOUT_MS', 60_000),
    cortexFailureThreshold: parseIntEnv('CORTEX_FAILURE_THRESHOLD', 3),
    cortexCircuitOpenMs: parseIntEnv('CORTEX_CIRCUIT_OPEN_MS', 30_000),
    llmTimeoutMs: timeoutMs,
    openaiApiKey: resolvedApiKey,
    openaiBaseUrl: resolvedBaseUrl,
    openaiModelExtract: process.env.OPENAI_MODEL_EXTRACT || process.env.LLM_MODEL_EXTRACT || defaultModel,
    openaiModelPlan:
      process.env.OPENAI_MODEL_PLAN ||
      process.env.LLM_MODEL_PLAN ||
      process.env.OPENAI_MODEL_EXTRACT ||
      process.env.LLM_MODEL_EXTRACT ||
      defaultModel,
    openaiModelWrite:
      process.env.OPENAI_MODEL_WRITE ||
      process.env.LLM_MODEL_VALIDATE ||
      process.env.LLM_MODEL_PLAN ||
      process.env.LLM_MODEL_EXTRACT ||
      process.env.OPENAI_MODEL_EXTRACT ||
      defaultModel,
    openaiMaxInputChars: parseIntEnv(
      'OPENAI_MAX_INPUT_CHARS',
      parseIntEnv('LLM_MAX_EVIDENCE_CHARS', 50_000)
    ),
    openaiTimeoutMs: timeoutMs,
    llmReasoningMode: parseBoolEnv('LLM_REASONING_MODE', hasDeepSeekKey),
    llmReasoningBudget: parseIntEnv('LLM_REASONING_BUDGET', 32768),
    llmMaxTokens: parseIntEnv('LLM_MAX_TOKENS', 16384),
    llmExtractReasoningBudget: parseIntEnv('LLM_EXTRACT_REASONING_BUDGET', 4096),
    llmExtractMaxTokens: parseIntEnv('LLM_EXTRACT_MAX_TOKENS', 1200),
    llmExtractMaxSnippetsPerBatch: parseIntEnv('LLM_EXTRACT_MAX_SNIPPETS_PER_BATCH', 6),
    llmExtractMaxSnippetChars: parseIntEnv('LLM_EXTRACT_MAX_SNIPPET_CHARS', 900),
    llmExtractSkipLowSignal: parseBoolEnv('LLM_EXTRACT_SKIP_LOW_SIGNAL', true),
    llmVerifyMode: parseBoolEnv('LLM_VERIFY_MODE', false),
    llmVerifySampleRate: parseIntEnv('LLM_VERIFY_SAMPLE_RATE', 10),
    llmVerifyAggressiveAlways: parseBoolEnv('LLM_VERIFY_AGGRESSIVE_ALWAYS', false),
    llmVerifyAggressiveBatchCount: parseIntEnv('LLM_VERIFY_AGGRESSIVE_BATCH_COUNT', 3),
    llmMaxOutputTokens: parseIntEnv('LLM_MAX_OUTPUT_TOKENS', 1200),
    llmCostInputPer1M: parseFloatEnv('LLM_COST_INPUT_PER_1M', 0.28),
    llmCostOutputPer1M: parseFloatEnv('LLM_COST_OUTPUT_PER_1M', 0.42),
    llmCostCachedInputPer1M: parseFloatEnv('LLM_COST_CACHED_INPUT_PER_1M', 0),
    llmCostInputPer1MDeepseekChat: parseFloatEnv('LLM_COST_INPUT_PER_1M_DEEPSEEK_CHAT', -1),
    llmCostOutputPer1MDeepseekChat: parseFloatEnv('LLM_COST_OUTPUT_PER_1M_DEEPSEEK_CHAT', -1),
    llmCostCachedInputPer1MDeepseekChat: parseFloatEnv('LLM_COST_CACHED_INPUT_PER_1M_DEEPSEEK_CHAT', -1),
    llmCostInputPer1MDeepseekReasoner: parseFloatEnv('LLM_COST_INPUT_PER_1M_DEEPSEEK_REASONER', -1),
    llmCostOutputPer1MDeepseekReasoner: parseFloatEnv('LLM_COST_OUTPUT_PER_1M_DEEPSEEK_REASONER', -1),
    llmCostCachedInputPer1MDeepseekReasoner: parseFloatEnv('LLM_COST_CACHED_INPUT_PER_1M_DEEPSEEK_REASONER', -1),
    llmMonthlyBudgetUsd: parseFloatEnv('LLM_MONTHLY_BUDGET_USD', 200),
    llmPerProductBudgetUsd: parseFloatEnv('LLM_PER_PRODUCT_BUDGET_USD', 0.1),
    llmDisableBudgetGuards: parseBoolEnv('LLM_DISABLE_BUDGET_GUARDS', false),
    llmMaxBatchesPerProduct: parseIntEnv('LLM_MAX_BATCHES_PER_PRODUCT', 7),
    llmExtractionCacheEnabled: parseBoolEnv('LLM_EXTRACTION_CACHE_ENABLED', true),
    llmExtractionCacheDir: process.env.LLM_EXTRACTION_CACHE_DIR || '.specfactory_tmp/llm_cache',
    llmExtractionCacheTtlMs: parseIntEnv('LLM_EXTRACTION_CACHE_TTL_MS', 7 * 24 * 60 * 60 * 1000),
    llmMaxCallsPerProductTotal: parseIntEnv('LLM_MAX_CALLS_PER_PRODUCT_TOTAL', 10),
    llmMaxCallsPerProductFast: parseIntEnv('LLM_MAX_CALLS_PER_PRODUCT_FAST', 2),
    llmMaxCallsPerRound: parseIntEnv('LLM_MAX_CALLS_PER_ROUND', 4),
    llmMaxEvidenceChars: parseIntEnv('LLM_MAX_EVIDENCE_CHARS', 60_000),
    deepseekModelVersion: process.env.DEEPSEEK_MODEL_VERSION || '',
    deepseekContextLength: process.env.DEEPSEEK_CONTEXT_LENGTH || '',
    deepseekChatMaxOutputDefault: process.env.DEEPSEEK_CHAT_MAX_OUTPUT_DEFAULT || '',
    deepseekChatMaxOutputMaximum: process.env.DEEPSEEK_CHAT_MAX_OUTPUT_MAXIMUM || '',
    deepseekReasonerMaxOutputDefault: process.env.DEEPSEEK_REASONER_MAX_OUTPUT_DEFAULT || '',
    deepseekReasonerMaxOutputMaximum: process.env.DEEPSEEK_REASONER_MAX_OUTPUT_MAXIMUM || '',
    deepseekFeatures: process.env.DEEPSEEK_FEATURES || '',
    accuracyMode: (process.env.ACCURACY_MODE || 'balanced').trim().toLowerCase(),
    importsRoot: process.env.IMPORTS_ROOT || 'imports',
    importsPollSeconds: parseIntEnv('IMPORTS_POLL_SECONDS', 10),
    daemonConcurrency: parseIntEnv('DAEMON_CONCURRENCY', 3),
    reCrawlStaleAfterDays: parseIntEnv('RECRAWL_STALE_AFTER_DAYS', 30),
    daemonGracefulShutdownTimeoutMs: parseIntEnv('DAEMON_GRACEFUL_SHUTDOWN_TIMEOUT_MS', 60_000),
    driftDetectionEnabled: parseBoolEnv('DRIFT_DETECTION_ENABLED', true),
    driftPollSeconds: parseIntEnv('DRIFT_POLL_SECONDS', 24 * 60 * 60),
    driftScanMaxProducts: parseIntEnv('DRIFT_SCAN_MAX_PRODUCTS', 250),
    driftAutoRepublish: parseBoolEnv('DRIFT_AUTO_REPUBLISH', true),
    helperFilesEnabled: parseBoolEnv('HELPER_FILES_ENABLED', true),
    helperFilesRoot: process.env.HELPER_FILES_ROOT || 'helper_files',
    helperSupportiveEnabled: parseBoolEnv('HELPER_SUPPORTIVE_ENABLED', true),
    helperSupportiveFillMissing: parseBoolEnv('HELPER_SUPPORTIVE_FILL_MISSING', true),
    helperSupportiveMaxSources: parseIntEnv('HELPER_SUPPORTIVE_MAX_SOURCES', 6),
    helperAutoSeedTargets: parseBoolEnv('HELPER_AUTO_SEED_TARGETS', true),
    helperActiveSyncLimit: parseIntEnv('HELPER_ACTIVE_SYNC_LIMIT', 0),
    graphqlReplayEnabled: parseBoolEnv('GRAPHQL_REPLAY_ENABLED', true),
    maxGraphqlReplays: parseIntEnv('MAX_GRAPHQL_REPLAYS', 5),
    maxNetworkResponsesPerPage: parseIntEnv('MAX_NETWORK_RESPONSES_PER_PAGE', 1200),
    pageGotoTimeoutMs: parseIntEnv('PAGE_GOTO_TIMEOUT_MS', 30_000),
    pageNetworkIdleTimeoutMs: parseIntEnv('PAGE_NETWORK_IDLE_TIMEOUT_MS', 6_000),
    postLoadWaitMs: parseIntEnv('POST_LOAD_WAIT_MS', 0),
    preferHttpFetcher: parseBoolEnv('PREFER_HTTP_FETCHER', false),
    autoScrollEnabled: parseBoolEnv('AUTO_SCROLL_ENABLED', false),
    autoScrollPasses: parseIntEnv('AUTO_SCROLL_PASSES', 0),
    autoScrollDelayMs: parseIntEnv('AUTO_SCROLL_DELAY_MS', 900),
    robotsTxtCompliant: parseBoolEnv('ROBOTS_TXT_COMPLIANT', true),
    robotsTxtTimeoutMs: parseIntEnv('ROBOTS_TXT_TIMEOUT_MS', 6000),
    endpointSignalLimit: parseIntEnv('ENDPOINT_SIGNAL_LIMIT', 30),
    endpointSuggestionLimit: parseIntEnv('ENDPOINT_SUGGESTION_LIMIT', 12),
    endpointNetworkScanLimit: parseIntEnv('ENDPOINT_NETWORK_SCAN_LIMIT', 600),
    manufacturerBroadDiscovery: parseBoolEnv('MANUFACTURER_BROAD_DISCOVERY', false),
    manufacturerSeedSearchUrls: parseBoolEnv('MANUFACTURER_SEED_SEARCH_URLS', false),
    allowBelowPassTargetFill: parseBoolEnv('ALLOW_BELOW_PASS_TARGET_FILL', false),
    selfImproveEnabled: parseBoolEnv('SELF_IMPROVE_ENABLED', true),
    maxHypothesisItems: parseIntEnv('MAX_HYPOTHESIS_ITEMS', 50),
    hypothesisAutoFollowupRounds: parseIntEnv('HYPOTHESIS_AUTO_FOLLOWUP_ROUNDS', 0),
    hypothesisFollowupUrlsPerRound: parseIntEnv('HYPOTHESIS_FOLLOWUP_URLS_PER_ROUND', 12),
    fieldRewardHalfLifeDays: parseIntEnv('FIELD_REWARD_HALF_LIFE_DAYS', 45),
    batchStrategy: (process.env.BATCH_STRATEGY || 'bandit').toLowerCase(),
    fieldRulesEngineEnforceEvidence: parseBoolEnv(
      'FIELD_RULES_ENGINE_ENFORCE_EVIDENCE',
      parseBoolEnv('AGGRESSIVE_MODE_ENABLED', false) || parseBoolEnv('UBER_AGGRESSIVE_ENABLED', false)
    ),

    // SQLite migration feature flags (dual-write controls)
    queueJsonWrite: parseBoolEnv('QUEUE_JSON_WRITE', false),
    billingJsonWrite: parseBoolEnv('BILLING_JSON_WRITE', false),
    brainJsonWrite: parseBoolEnv('BRAIN_JSON_WRITE', false),
    intelJsonWrite: parseBoolEnv('INTEL_JSON_WRITE', false),
    corpusJsonWrite: parseBoolEnv('CORPUS_JSON_WRITE', false),
    learningJsonWrite: parseBoolEnv('LEARNING_JSON_WRITE', false),
    cacheJsonWrite: parseBoolEnv('CACHE_JSON_WRITE', false),
    eventsJsonWrite: parseBoolEnv('EVENTS_JSON_WRITE', true)
  };

  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  );

  const merged = {
    ...cfg,
    ...filtered
  };
  if (merged.localMode === true && !filtered.outputMode) {
    merged.outputMode = 'local';
  }
  merged.outputMode = normalizeOutputMode(merged.outputMode, merged.localMode ? 'local' : 'dual');
  if (merged.outputMode === 'local') {
    merged.mirrorToS3 = false;
  }
  if (!merged.s3Bucket) {
    merged.mirrorToS3 = false;
  }

  merged.llmProvider = merged.llmProvider || inferLlmProvider(
    merged.llmBaseUrl || merged.openaiBaseUrl,
    merged.llmModelExtract || merged.openaiModelExtract,
    Boolean(process.env.DEEPSEEK_API_KEY)
  );
  merged.llmApiKey = merged.llmApiKey || merged.openaiApiKey;
  merged.llmBaseUrl = merged.llmBaseUrl || merged.openaiBaseUrl;
  merged.llmModelExtract = merged.llmModelExtract || merged.openaiModelExtract;
  merged.llmModelPlan = merged.llmModelPlan || merged.openaiModelPlan;
  merged.llmModelFast = merged.llmModelFast || merged.llmModelExtract || merged.llmModelPlan;
  merged.llmModelTriage = merged.llmModelTriage || merged.cortexModelRerankFast || merged.cortexModelSearchFast || merged.llmModelFast;
  merged.llmModelReasoning = merged.llmModelReasoning || merged.llmModelExtract;
  merged.llmModelValidate = merged.llmModelValidate || merged.openaiModelWrite;
  merged.llmModelWrite = merged.llmModelWrite || merged.llmModelValidate;
  merged.llmPlanProvider = merged.llmPlanProvider || merged.llmProvider;
  merged.llmPlanBaseUrl = merged.llmPlanBaseUrl || merged.llmBaseUrl;
  merged.llmPlanApiKey = merged.llmPlanApiKey || merged.llmApiKey;
  merged.llmExtractProvider = merged.llmExtractProvider || merged.llmProvider;
  merged.llmExtractBaseUrl = merged.llmExtractBaseUrl || merged.llmBaseUrl;
  merged.llmExtractApiKey = merged.llmExtractApiKey || merged.llmApiKey;
  merged.llmValidateProvider = merged.llmValidateProvider || merged.llmProvider;
  merged.llmValidateBaseUrl = merged.llmValidateBaseUrl || merged.llmBaseUrl;
  merged.llmValidateApiKey = merged.llmValidateApiKey || merged.llmApiKey;
  merged.llmWriteProvider = merged.llmWriteProvider || merged.llmProvider;
  merged.llmWriteBaseUrl = merged.llmWriteBaseUrl || merged.llmBaseUrl;
  merged.llmWriteApiKey = merged.llmWriteApiKey || merged.llmApiKey;
  merged.cortexModelRerankFast = merged.cortexModelRerankFast || merged.cortexModelSearchFast || merged.llmModelTriage || merged.llmModelFast;
  merged.llmModelPricingMap = normalizeModelPricingMap(merged.llmModelPricingMap || {});
  merged.llmTimeoutMs = merged.llmTimeoutMs || merged.openaiTimeoutMs;
  merged.openaiApiKey = merged.llmApiKey;
  merged.openaiBaseUrl = merged.llmBaseUrl;
  merged.openaiModelExtract = merged.llmModelExtract;
  merged.openaiModelPlan = merged.llmModelPlan;
  merged.openaiModelWrite = merged.llmModelWrite;
  merged.openaiTimeoutMs = merged.llmTimeoutMs;

  return applyRunProfile(
    merged,
    filtered.runProfile || cfg.runProfile
  );
}

export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  // Rule 1: LLM enabled requires API key
  if (config.llmEnabled && !config.llmApiKey) {
    errors.push({
      code: 'LLM_NO_API_KEY',
      message: 'LLM_ENABLED=true but LLM_API_KEY is not set'
    });
  }

  // Rule 2: Discovery enabled requires search provider
  if (config.discoveryEnabled && config.searchProvider === 'none') {
    errors.push({
      code: 'DISCOVERY_NO_SEARCH_PROVIDER',
      message: 'DISCOVERY_ENABLED=true but SEARCH_PROVIDER is "none"'
    });
  }

  // Rule 3: Cortex enabled requires base URL
  if (config.cortexEnabled && !config.cortexBaseUrl) {
    errors.push({
      code: 'CORTEX_NO_BASE_URL',
      message: 'CORTEX_ENABLED=true but CORTEX_BASE_URL is not set'
    });
  }

  // Rule 4: S3 output mode requires AWS credentials
  if (config.outputMode === 's3' && !config.mirrorToS3) {
    warnings.push({
      code: 'S3_MODE_NO_CREDS',
      message: 'OUTPUT_MODE=s3 but AWS credentials not detected'
    });
  }

  // Rule 5: Aggressive mode should have frontier enabled
  if (config.aggressiveModeEnabled && !config.frontierEnableSqlite && !config.frontierDbPath) {
    warnings.push({
      code: 'AGGRESSIVE_NO_FRONTIER',
      message: 'AGGRESSIVE_MODE_ENABLED=true but frontier DB is not configured'
    });
  }

  // Rule 6: manufacturerReserveUrls should not exceed maxUrlsPerProduct
  if (config.maxUrlsPerProduct < config.manufacturerReserveUrls) {
    warnings.push({
      code: 'MANUFACTURER_RESERVE_EXCEEDS_MAX',
      message: `manufacturerReserveUrls (${config.manufacturerReserveUrls}) > maxUrlsPerProduct (${config.maxUrlsPerProduct})`
    });
  }

  // Rule 7: Uber aggressive requires aggressive mode
  if (config.uberAggressiveEnabled && !config.aggressiveModeEnabled) {
    warnings.push({
      code: 'UBER_WITHOUT_AGGRESSIVE',
      message: 'UBER_AGGRESSIVE_ENABLED=true but AGGRESSIVE_MODE_ENABLED=false'
    });
  }

  // Rule 8: Budget guards disabled is risky
  if (config.llmDisableBudgetGuards) {
    warnings.push({
      code: 'BUDGET_GUARDS_DISABLED',
      message: 'LLM_DISABLE_BUDGET_GUARDS=true — no cost ceiling in effect'
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
