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
    next.llmPlanDiscoveryQueries = true;
    next.manufacturerBroadDiscovery = true;
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
    next.endpointSignalLimit = intMin(next.endpointSignalLimit, 24);
    next.endpointSuggestionLimit = intMin(next.endpointSuggestionLimit, 8);
    next.endpointNetworkScanLimit = intMin(next.endpointNetworkScanLimit, 400);
    next.hypothesisAutoFollowupRounds = intMin(next.hypothesisAutoFollowupRounds, 0);
    next.hypothesisFollowupUrlsPerRound = intMin(next.hypothesisFollowupUrlsPerRound, 8);
    next.postLoadWaitMs = intMin(next.postLoadWaitMs, 0);
    next.autoScrollEnabled = false;
    next.autoScrollPasses = 0;
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
    searchProvider: process.env.SEARCH_PROVIDER || 'none',
    bingSearchKey: process.env.BING_SEARCH_KEY || '',
    bingSearchEndpoint: process.env.BING_SEARCH_ENDPOINT || '',
    googleCseKey: process.env.GOOGLE_CSE_KEY || '',
    googleCseCx: process.env.GOOGLE_CSE_CX || '',
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
    llmModelValidate:
      process.env.LLM_MODEL_VALIDATE ||
      process.env.LLM_MODEL_PLAN ||
      process.env.LLM_MODEL_EXTRACT ||
      defaultModel,
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
    llmReasoningBudget: parseIntEnv('LLM_REASONING_BUDGET', 2048),
    llmVerifyMode: parseBoolEnv('LLM_VERIFY_MODE', false),
    llmVerifySampleRate: parseIntEnv('LLM_VERIFY_SAMPLE_RATE', 10),
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
    autoScrollEnabled: parseBoolEnv('AUTO_SCROLL_ENABLED', false),
    autoScrollPasses: parseIntEnv('AUTO_SCROLL_PASSES', 0),
    autoScrollDelayMs: parseIntEnv('AUTO_SCROLL_DELAY_MS', 900),
    robotsTxtCompliant: parseBoolEnv('ROBOTS_TXT_COMPLIANT', true),
    robotsTxtTimeoutMs: parseIntEnv('ROBOTS_TXT_TIMEOUT_MS', 6000),
    endpointSignalLimit: parseIntEnv('ENDPOINT_SIGNAL_LIMIT', 30),
    endpointSuggestionLimit: parseIntEnv('ENDPOINT_SUGGESTION_LIMIT', 12),
    endpointNetworkScanLimit: parseIntEnv('ENDPOINT_NETWORK_SCAN_LIMIT', 600),
    manufacturerBroadDiscovery: parseBoolEnv('MANUFACTURER_BROAD_DISCOVERY', false),
    allowBelowPassTargetFill: parseBoolEnv('ALLOW_BELOW_PASS_TARGET_FILL', false),
    selfImproveEnabled: parseBoolEnv('SELF_IMPROVE_ENABLED', true),
    maxHypothesisItems: parseIntEnv('MAX_HYPOTHESIS_ITEMS', 50),
    hypothesisAutoFollowupRounds: parseIntEnv('HYPOTHESIS_AUTO_FOLLOWUP_ROUNDS', 0),
    hypothesisFollowupUrlsPerRound: parseIntEnv('HYPOTHESIS_FOLLOWUP_URLS_PER_ROUND', 12),
    fieldRewardHalfLifeDays: parseIntEnv('FIELD_REWARD_HALF_LIFE_DAYS', 45),
    batchStrategy: (process.env.BATCH_STRATEGY || 'bandit').toLowerCase()
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
  merged.llmModelValidate = merged.llmModelValidate || merged.openaiModelWrite;
  merged.llmTimeoutMs = merged.llmTimeoutMs || merged.openaiTimeoutMs;
  merged.openaiApiKey = merged.llmApiKey;
  merged.openaiBaseUrl = merged.llmBaseUrl;
  merged.openaiModelExtract = merged.llmModelExtract;
  merged.openaiModelPlan = merged.llmModelPlan;
  merged.openaiModelWrite = merged.llmModelValidate;
  merged.openaiTimeoutMs = merged.llmTimeoutMs;

  return applyRunProfile(
    merged,
    filtered.runProfile || cfg.runProfile
  );
}
