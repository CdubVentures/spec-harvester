import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadDotEnvFile, applyRunProfile } from '../../src/config.js';
import { createStorage } from '../../src/s3/storage.js';
import { runProduct } from '../../src/pipeline/runProduct.js';

loadDotEnvFile();

const BENCHMARK_PRODUCTS = [
  { s3Key: 'specs/inputs/mouse/products/mouse-corsair-dark-core-rgb-pro.json', label: 'Corsair Dark Core RGB Pro', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-alienware-alienware-pro.json', label: 'Alienware Pro', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-acer-cestus-350.json', label: 'Acer Cestus 350', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-alienware-aw620m.json', label: 'Alienware AW620M', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-acer-cestus-330.json', label: 'Acer Cestus 330', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-acer-cestus-310.json', label: 'Acer Cestus 310', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-acer-cestus-335.json', label: 'Acer Cestus 335', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json', label: 'Razer Viper V3 Pro', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2.json', label: 'Logitech G Pro X Superlight 2', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-razer-viper-v3-hyperspeed.json', label: 'Razer Viper V3 Hyperspeed', hasRef: true },
  { s3Key: 'specs/inputs/mouse/products/mouse-endgame-gear-op1we-wireless.json', label: 'Endgame Gear OP1we', hasRef: false },
  { s3Key: 'specs/inputs/mouse/products/mouse-finalmouse-ulx-prophecy-tfue.json', label: 'Finalmouse ULX Prophecy Tfue', hasRef: false },
  { s3Key: 'specs/inputs/mouse/products/mouse-hyperx-pulsefire-haste-2-wireless.json', label: 'HyperX Pulsefire Haste 2 Wireless', hasRef: false },
  { s3Key: 'specs/inputs/mouse/products/mouse-asus-rog-harpe-ace-extreme.json', label: 'ASUS ROG Harpe Ace Extreme', hasRef: false },
  { s3Key: 'specs/inputs/mouse/products/mouse-corsair-m75-wireless.json', label: 'Corsair M75 Wireless', hasRef: false }
];

const RUNS_PER_PRODUCT = 3;
const IDENTITY_FIELDS = new Set(['id', 'brand', 'model', 'base_model', 'category', 'sku', 'variant', 'mpn', 'gtin', 'upc', 'ean', 'asin']);

function countNonUnkFields(fields) {
  if (!fields || typeof fields !== 'object') return 0;
  return Object.entries(fields)
    .filter(([key]) => !IDENTITY_FIELDS.has(key))
    .filter(([, value]) => value !== 'unk' && value !== '' && value !== null && value !== undefined)
    .length;
}

function countTotalFields(fields) {
  if (!fields || typeof fields !== 'object') return 0;
  return Object.keys(fields).filter((key) => !IDENTITY_FIELDS.has(key)).length;
}

function extractMetrics(result) {
  const summary = result?.summary || {};
  const fields = result?.normalized?.fields || {};
  const nonUnk = countNonUnkFields(fields);
  const total = countTotalFields(fields);

  return {
    runId: result?.runId || 'unknown',
    durationMs: summary.duration_ms || 0,
    identityCertainty: summary.identity_confidence || 0,
    identityGateValidated: Boolean(summary.identity_gate_validated),
    identityStatus: summary.identity_gate?.status || 'unknown',
    fieldsExtracted: nonUnk,
    totalFields: total,
    fieldExtractionRate: total > 0 ? (nonUnk / total) : 0,
    sourcesFound: summary.sources_found || 0,
    sourcesIdentityMatched: summary.sources_identity_matched || 0,
    sourcesAccepted: summary.sources_accepted || 0,
    confidence: summary.confidence || 0,
    validated: Boolean(summary.validated),
    publishable: Boolean(summary.publishable),
    reasonCodes: summary.reason_codes || [],
    identityProvisional: Boolean(result?.normalized?.identity_provisional)
  };
}

async function runSingleProduct(storage, config, s3Key) {
  const startMs = Date.now();
  try {
    const result = await runProduct({
      storage,
      config,
      s3Key
    });
    const wallClockMs = Date.now() - startMs;
    const metrics = extractMetrics(result);
    metrics.wallClockMs = wallClockMs;
    metrics.success = true;
    metrics.error = null;
    return metrics;
  } catch (error) {
    return {
      runId: 'error',
      wallClockMs: Date.now() - startMs,
      success: false,
      error: String(error?.message || error),
      identityCertainty: 0,
      identityGateValidated: false,
      fieldsExtracted: 0,
      totalFields: 0,
      fieldExtractionRate: 0,
      sourcesFound: 0,
      sourcesIdentityMatched: 0,
      sourcesAccepted: 0,
      confidence: 0,
      validated: false,
      publishable: false,
      reasonCodes: [],
      identityProvisional: false
    };
  }
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

async function main() {
  const profileArg = process.argv.find((arg) => arg.startsWith('--profile='));
  const profileName = profileArg ? profileArg.split('=')[1] : 'standard';
  const runsArg = process.argv.find((arg) => arg.startsWith('--runs='));
  const runsPerProduct = runsArg ? Number.parseInt(runsArg.split('=')[1], 10) : RUNS_PER_PRODUCT;
  const productFilterArg = process.argv.find((arg) => arg.startsWith('--product='));
  const productFilter = productFilterArg ? productFilterArg.split('=')[1] : null;

  const baseConfig = loadConfig({ localMode: true, discoveryEnabled: true, fetchCandidateSources: true });
  const config = applyRunProfile(baseConfig, profileName);

  const storage = createStorage(config);

  const products = productFilter
    ? BENCHMARK_PRODUCTS.filter((p) => p.label.toLowerCase().includes(productFilter.toLowerCase()))
    : BENCHMARK_PRODUCTS;

  console.log(`\n=== Pipeline Benchmark ===`);
  console.log(`Profile: ${profileName}`);
  console.log(`Products: ${products.length}`);
  console.log(`Runs per product: ${runsPerProduct}`);
  console.log(`Total runs: ${products.length * runsPerProduct}`);
  console.log('');

  const allResults = [];
  const productSummaries = [];

  for (const product of products) {
    console.log(`--- ${product.label} ---`);
    const runs = [];

    for (let run = 0; run < runsPerProduct; run++) {
      const runLabel = `  Run ${run + 1}/${runsPerProduct}`;
      process.stdout.write(`${runLabel}...`);

      const metrics = await runSingleProduct(storage, config, product.s3Key);
      runs.push(metrics);

      const status = metrics.success
        ? `${metrics.fieldsExtracted}/${metrics.totalFields} fields, ${formatDuration(metrics.wallClockMs)}, identity=${(metrics.identityCertainty * 100).toFixed(0)}%`
        : `ERROR: ${metrics.error}`;
      console.log(` ${status}`);
    }

    const successRuns = runs.filter((r) => r.success);
    const productSummary = {
      label: product.label,
      s3Key: product.s3Key,
      hasRef: product.hasRef,
      totalRuns: runs.length,
      successfulRuns: successRuns.length,
      avgWallClockMs: avg(successRuns.map((r) => r.wallClockMs)),
      avgFieldsExtracted: avg(successRuns.map((r) => r.fieldsExtracted)),
      avgFieldExtractionRate: avg(successRuns.map((r) => r.fieldExtractionRate)),
      avgIdentityCertainty: avg(successRuns.map((r) => r.identityCertainty)),
      identityPassRate: successRuns.filter((r) => r.identityCertainty >= 0.70).length / Math.max(1, successRuns.length),
      anyFieldsExtracted: successRuns.some((r) => r.fieldsExtracted > 0),
      runs
    };

    productSummaries.push(productSummary);
    allResults.push(...runs);
    console.log(`  Avg: ${productSummary.avgFieldsExtracted.toFixed(1)} fields, ${formatDuration(productSummary.avgWallClockMs)}, identity pass: ${(productSummary.identityPassRate * 100).toFixed(0)}%\n`);
  }

  const successResults = allResults.filter((r) => r.success);
  const wallClockTimes = successResults.map((r) => r.wallClockMs);
  const fieldExtractionRates = successResults.map((r) => r.fieldExtractionRate);
  const identityCertainties = successResults.map((r) => r.identityCertainty);

  const aggregateSummary = {
    profile: profileName,
    totalProducts: products.length,
    totalRuns: allResults.length,
    successfulRuns: successResults.length,
    failedRuns: allResults.length - successResults.length,
    wallClock: {
      meanMs: avg(wallClockTimes),
      medianMs: median(wallClockTimes),
      p95Ms: p95(wallClockTimes),
      totalMs: wallClockTimes.reduce((sum, v) => sum + v, 0)
    },
    fieldExtraction: {
      meanRate: avg(fieldExtractionRates),
      medianRate: median(fieldExtractionRates),
      productsWithFields: productSummaries.filter((p) => p.anyFieldsExtracted).length,
      productsWithFieldsRate: productSummaries.filter((p) => p.anyFieldsExtracted).length / products.length
    },
    identity: {
      meanCertainty: avg(identityCertainties),
      passRate: successResults.filter((r) => r.identityCertainty >= 0.70).length / Math.max(1, successResults.length),
      provisionalRate: successResults.filter((r) => r.identityProvisional).length / Math.max(1, successResults.length)
    }
  };

  console.log('\n=== AGGREGATE SUMMARY ===');
  console.log(`Profile: ${aggregateSummary.profile}`);
  console.log(`Total runs: ${aggregateSummary.totalRuns} (${aggregateSummary.successfulRuns} ok, ${aggregateSummary.failedRuns} failed)`);
  console.log(`Wall clock: mean=${formatDuration(aggregateSummary.wallClock.meanMs)}, median=${formatDuration(aggregateSummary.wallClock.medianMs)}, p95=${formatDuration(aggregateSummary.wallClock.p95Ms)}`);
  console.log(`Field extraction: mean=${(aggregateSummary.fieldExtraction.meanRate * 100).toFixed(1)}%, products with fields: ${aggregateSummary.fieldExtraction.productsWithFields}/${products.length} (${(aggregateSummary.fieldExtraction.productsWithFieldsRate * 100).toFixed(0)}%)`);
  console.log(`Identity: mean certainty=${(aggregateSummary.identity.meanCertainty * 100).toFixed(1)}%, pass rate=${(aggregateSummary.identity.passRate * 100).toFixed(0)}%, provisional=${(aggregateSummary.identity.provisionalRate * 100).toFixed(0)}%`);

  const outputData = {
    timestamp: new Date().toISOString(),
    aggregate: aggregateSummary,
    products: productSummaries
  };

  const outDir = path.resolve('test/benchmark');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'benchmark-results.json'), JSON.stringify(outputData, null, 2));

  const md = buildMarkdownReport(aggregateSummary, productSummaries);
  fs.writeFileSync(path.join(outDir, 'benchmark-summary.md'), md);

  console.log(`\nResults saved to test/benchmark/benchmark-results.json`);
  console.log(`Summary saved to test/benchmark/benchmark-summary.md`);
}

function buildMarkdownReport(aggregate, products) {
  const lines = [
    `# Pipeline Benchmark Results`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**Profile:** ${aggregate.profile}`,
    `**Products:** ${aggregate.totalProducts}`,
    `**Total Runs:** ${aggregate.totalRuns}`,
    ``,
    `## Aggregate`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Mean wall clock | ${formatDuration(aggregate.wallClock.meanMs)} |`,
    `| Median wall clock | ${formatDuration(aggregate.wallClock.medianMs)} |`,
    `| P95 wall clock | ${formatDuration(aggregate.wallClock.p95Ms)} |`,
    `| Mean field extraction rate | ${(aggregate.fieldExtraction.meanRate * 100).toFixed(1)}% |`,
    `| Products with any fields | ${aggregate.fieldExtraction.productsWithFields}/${aggregate.totalProducts} |`,
    `| Identity pass rate (>= 0.70) | ${(aggregate.identity.passRate * 100).toFixed(0)}% |`,
    `| Mean identity certainty | ${(aggregate.identity.meanCertainty * 100).toFixed(1)}% |`,
    ``,
    `## Per-Product Results`,
    ``,
    `| Product | Avg Fields | Avg Rate | Avg Time | Identity Pass | Ref Data |`,
    `|---------|-----------|---------|---------|--------------|----------|`,
    ...products.map((p) =>
      `| ${p.label} | ${p.avgFieldsExtracted.toFixed(1)} | ${(p.avgFieldExtractionRate * 100).toFixed(0)}% | ${formatDuration(p.avgWallClockMs)} | ${(p.identityPassRate * 100).toFixed(0)}% | ${p.hasRef ? 'Yes' : 'No'} |`
    ),
    ``
  ];
  return lines.join('\n');
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
