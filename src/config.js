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

export function loadConfig(overrides = {}) {
  const cfg = {
    awsRegion: process.env.AWS_REGION || 'us-east-2',
    s3Bucket: process.env.S3_BUCKET || 'my-spec-harvester-data',
    s3InputPrefix: (process.env.S3_INPUT_PREFIX || 'specs/inputs').replace(/\/+$/, ''),
    s3OutputPrefix: (process.env.S3_OUTPUT_PREFIX || 'specs/outputs').replace(/\/+$/, ''),
    maxUrlsPerProduct: parseIntEnv('MAX_URLS_PER_PRODUCT', 8),
    maxPagesPerDomain: parseIntEnv('MAX_PAGES_PER_DOMAIN', 2),
    maxRunSeconds: parseIntEnv('MAX_RUN_SECONDS', 180),
    maxJsonBytes: parseIntEnv('MAX_JSON_BYTES', 2_000_000),
    concurrency: parseIntEnv('CONCURRENCY', 2),
    perHostMinDelayMs: parseIntEnv('PER_HOST_MIN_DELAY_MS', 800),
    userAgent:
      process.env.USER_AGENT ||
      'Mozilla/5.0 (compatible; EGSpecHarvester/1.0; +https://eggear.com)',
    localMode: parseBoolEnv('LOCAL_MODE', false),
    dryRun: parseBoolEnv('DRY_RUN', false),
    localInputRoot: process.env.LOCAL_S3_ROOT || 'fixtures/s3',
    localOutputRoot: process.env.LOCAL_OUTPUT_ROOT || 'out',
    writeMarkdownSummary: parseBoolEnv('WRITE_MARKDOWN_SUMMARY', true)
  };

  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  );

  return {
    ...cfg,
    ...filtered
  };
}
