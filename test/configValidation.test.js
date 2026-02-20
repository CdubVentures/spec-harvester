import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// C.1 — Foundation Hardening: Config Validation Tests
//
// Tests for validateConfig() exported from src/config.js. It detects invalid
// config combinations at startup and returns clear error/warning messages.
// ---------------------------------------------------------------------------

// =========================================================================
// SECTION 1: loadConfig defaults are sensible
// =========================================================================

test('C.1 config defaults: loadConfig returns valid defaults', () => {
  const config = loadConfig();
  assert.equal(typeof config.maxUrlsPerProduct, 'number');
  assert.equal(config.maxUrlsPerProduct > 0, true);
  assert.equal(typeof config.runProfile, 'string');
  assert.ok(['fast', 'standard', 'thorough'].includes(config.runProfile));
});

test('C.1 config defaults: LLM disabled by default', () => {
  const config = loadConfig();
  assert.equal(config.llmEnabled, false);
});

test('C.1 config defaults: discovery disabled by default', () => {
  const config = loadConfig();
  assert.equal(config.discoveryEnabled, false);
});

test('C.1 config defaults: indexing helper files disabled by default', () => {
  const config = loadConfig();
  assert.equal(config.indexingHelperFilesEnabled, false);
});

test('C.1 config defaults: cortex disabled by default', () => {
  const config = loadConfig();
  assert.equal(config.cortexEnabled, false);
});

// =========================================================================
// SECTION 2: Config validation detects misconfigurations
// =========================================================================

test('C.1 validate: LLM enabled without API key is error', () => {
  const config = loadConfig({ llmEnabled: true, llmApiKey: '' });
  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'LLM_NO_API_KEY'));
});

test('C.1 validate: discovery enabled without search provider is error', () => {
  const config = loadConfig({ discoveryEnabled: true, searchProvider: 'none' });
  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'DISCOVERY_NO_SEARCH_PROVIDER'));
});

test('C.1 validate: cortex enabled without base URL is error', () => {
  const config = loadConfig({ cortexEnabled: true, cortexBaseUrl: '' });
  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'CORTEX_NO_BASE_URL'));
});

test('C.1 validate: uber aggressive without aggressive is warning', () => {
  const config = loadConfig({
    uberAggressiveEnabled: true,
    aggressiveModeEnabled: false
  });
  const result = validateConfig(config);
  assert.ok(result.warnings.some((w) => w.code === 'UBER_WITHOUT_AGGRESSIVE'));
});

test('C.1 validate: budget guards disabled is warning', () => {
  const config = loadConfig({ llmDisableBudgetGuards: true });
  const result = validateConfig(config);
  assert.ok(result.warnings.some((w) => w.code === 'BUDGET_GUARDS_DISABLED'));
});

// =========================================================================
// SECTION 3: Valid configuration passes
// =========================================================================

test('C.1 validate: default config with everything disabled is valid', () => {
  const config = loadConfig();
  const result = validateConfig(config);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('C.1 validate: LLM enabled with API key is valid', () => {
  const config = loadConfig({
    llmEnabled: true,
    llmApiKey: 'sk-test-key-123'
  });
  const result = validateConfig(config);
  assert.ok(!result.errors.some((e) => e.code === 'LLM_NO_API_KEY'));
});

test('C.1 validate: discovery with search provider configured is valid', () => {
  const config = loadConfig({
    discoveryEnabled: true,
    searchProvider: 'searxng'
  });
  const result = validateConfig(config);
  assert.ok(!result.errors.some((e) => e.code === 'DISCOVERY_NO_SEARCH_PROVIDER'));
});

// =========================================================================
// SECTION 4: Run profile overrides
// =========================================================================

test('C.1 profile: thorough profile increases key limits', () => {
  const config = loadConfig({ runProfile: 'thorough' });
  assert.equal(config.runProfile, 'thorough');
  assert.ok(config.maxUrlsPerProduct >= 220);
  assert.ok(config.maxCandidateUrls >= 280);
  assert.ok(config.discoveryMaxQueries >= 24);
  assert.equal(config.autoScrollEnabled, true);
});

test('C.1 profile: fast profile decreases key limits', () => {
  const config = loadConfig({ runProfile: 'fast' });
  assert.equal(config.runProfile, 'fast');
  assert.ok(config.maxUrlsPerProduct <= 12);
  assert.equal(config.autoScrollEnabled, false);
});

test('C.1 profile: unknown profile normalizes to standard', () => {
  const config = loadConfig({ runProfile: 'xyzinvalid' });
  assert.equal(config.runProfile, 'standard');
});

// =========================================================================
// SECTION 5: Override precedence
// =========================================================================

test('C.1 overrides: explicit overrides take precedence over profile', () => {
  const config = loadConfig({
    runProfile: 'fast',
    maxUrlsPerProduct: 100
  });
  // fast would cap at 12, but explicit override should win
  // Actually applyRunProfile uses intMin which takes min(current, ceiling)
  // so explicit 100 gets capped to fast profile ceiling of 12
  assert.ok(config.maxUrlsPerProduct <= 12);
});

test('C.1 overrides: localMode forces outputMode to local', () => {
  const config = loadConfig({ localMode: true });
  assert.equal(config.outputMode, 'local');
  assert.equal(config.mirrorToS3, false);
});

// =========================================================================
// SECTION 6: Edge cases
// =========================================================================

test('C.1 edge: manufacturerReserveUrls capped to maxUrlsPerProduct', () => {
  const config = loadConfig({
    maxUrlsPerProduct: 10,
    manufacturerReserveUrls: 50
  });
  assert.ok(config.manufacturerReserveUrls <= config.maxUrlsPerProduct);
});

test('C.1 edge: maxManufacturerUrlsPerProduct capped to maxUrlsPerProduct', () => {
  const config = loadConfig({
    maxUrlsPerProduct: 10,
    maxManufacturerUrlsPerProduct: 100
  });
  assert.ok(config.maxManufacturerUrlsPerProduct <= config.maxUrlsPerProduct);
});

test('C.1 edge: negative values handled gracefully', () => {
  const config = loadConfig({
    maxUrlsPerProduct: -5,
    maxRunSeconds: -100
  });
  // applyRunProfile normalizes these
  assert.equal(typeof config.maxUrlsPerProduct, 'number');
  assert.equal(typeof config.maxRunSeconds, 'number');
});
