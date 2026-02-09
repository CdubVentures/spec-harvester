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

function parseBoolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const norm = String(raw).trim().toLowerCase();
  return norm === '1' || norm === 'true' || norm === 'yes' || norm === 'on';
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
    localInputRoot: process.env.LOCAL_S3_ROOT || 'fixtures/s3',
    localOutputRoot: process.env.LOCAL_OUTPUT_ROOT || 'out',
    writeMarkdownSummary: parseBoolEnv('WRITE_MARKDOWN_SUMMARY', true),
    discoveryEnabled: parseBoolEnv('DISCOVERY_ENABLED', false),
    fetchCandidateSources: parseBoolEnv('FETCH_CANDIDATE_SOURCES', true),
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
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
    openaiModelExtract: process.env.OPENAI_MODEL_EXTRACT || 'gpt-4.1-mini',
    openaiModelPlan: process.env.OPENAI_MODEL_PLAN || process.env.OPENAI_MODEL_EXTRACT || 'gpt-4.1-mini',
    openaiModelWrite: process.env.OPENAI_MODEL_WRITE || process.env.OPENAI_MODEL_EXTRACT || 'gpt-4.1-mini',
    openaiMaxInputChars: parseIntEnv('OPENAI_MAX_INPUT_CHARS', 50_000),
    openaiTimeoutMs: parseIntEnv('OPENAI_TIMEOUT_MS', 40_000),
    graphqlReplayEnabled: parseBoolEnv('GRAPHQL_REPLAY_ENABLED', true),
    maxGraphqlReplays: parseIntEnv('MAX_GRAPHQL_REPLAYS', 5),
    allowBelowPassTargetFill: parseBoolEnv('ALLOW_BELOW_PASS_TARGET_FILL', false),
    selfImproveEnabled: parseBoolEnv('SELF_IMPROVE_ENABLED', true),
    maxHypothesisItems: parseIntEnv('MAX_HYPOTHESIS_ITEMS', 50),
    batchStrategy: (process.env.BATCH_STRATEGY || 'mixed').toLowerCase()
  };

  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  );

  return {
    ...cfg,
    ...filtered
  };
}
