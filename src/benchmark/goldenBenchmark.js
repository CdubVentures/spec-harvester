import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeExpectedValue(value) {
  if (value === null || value === undefined) {
    return 'unk';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function resolveFixturePath(category, fixturePath) {
  if (fixturePath) {
    return path.resolve(fixturePath);
  }
  return path.resolve('fixtures', 'benchmarks', `${category}.json`);
}

async function loadFixture(category, fixturePath) {
  const fullPath = resolveFixturePath(category, fixturePath);
  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = JSON.parse(raw);
  const cases = parsed.cases || parsed.products || [];
  if (!Array.isArray(cases)) {
    throw new Error('benchmark fixture must define an array at `cases`');
  }

  return {
    path: fullPath,
    category: parsed.category || category,
    cases
  };
}

function compareFields(expected, actualFields) {
  const diffs = [];
  let checked = 0;
  let passed = 0;

  for (const [field, expectedValue] of Object.entries(expected || {})) {
    checked += 1;
    const actualValue = normalizeExpectedValue(actualFields?.[field]);
    const expectedNorm = normalizeExpectedValue(expectedValue);
    if (actualValue === expectedNorm) {
      passed += 1;
      continue;
    }

    diffs.push({
      field,
      expected: expectedNorm,
      actual: actualValue
    });
  }

  return {
    checked,
    passed,
    failed: checked - passed,
    diffs
  };
}

async function readLatestNormalized(storage, category, productId) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  const normalized = await storage.readJsonOrNull(`${latestBase}/normalized.json`);
  const summary = await storage.readJsonOrNull(`${latestBase}/summary.json`);
  return {
    normalized,
    summary
  };
}

export async function runGoldenBenchmark({
  storage,
  category,
  fixturePath,
  maxCases = 0
}) {
  const fixture = await loadFixture(category, fixturePath);
  const cases = maxCases > 0
    ? fixture.cases.slice(0, maxCases)
    : fixture.cases;

  const results = [];
  for (const row of cases) {
    const productId = String(row.productId || row.product_id || '').trim();
    if (!productId) {
      continue;
    }

    const expectedFields = row.expected?.fields || row.expected_fields || {};
    const snapshot = await readLatestNormalized(storage, fixture.category, productId);

    if (!snapshot.normalized) {
      results.push({
        productId,
        status: 'missing_latest',
        checked_fields: Object.keys(expectedFields).length,
        passed_fields: 0,
        failed_fields: Object.keys(expectedFields).length,
        diffs: Object.entries(expectedFields).map(([field, expected]) => ({
          field,
          expected: normalizeExpectedValue(expected),
          actual: 'missing'
        }))
      });
      continue;
    }

    const comparison = compareFields(expectedFields, snapshot.normalized.fields || {});
    results.push({
      productId,
      status: comparison.failed === 0 ? 'pass' : 'fail',
      validated: snapshot.summary?.validated ?? null,
      confidence: snapshot.summary?.confidence ?? null,
      checked_fields: comparison.checked,
      passed_fields: comparison.passed,
      failed_fields: comparison.failed,
      diffs: comparison.diffs
    });
  }

  const totalChecked = results.reduce((sum, row) => sum + (row.checked_fields || 0), 0);
  const totalPassed = results.reduce((sum, row) => sum + (row.passed_fields || 0), 0);
  const passRate = totalChecked > 0
    ? Number.parseFloat((totalPassed / totalChecked).toFixed(6))
    : 0;

  return {
    fixture_path: fixture.path,
    category: fixture.category,
    case_count: results.length,
    pass_case_count: results.filter((row) => row.status === 'pass').length,
    fail_case_count: results.filter((row) => row.status === 'fail').length,
    missing_case_count: results.filter((row) => row.status === 'missing_latest').length,
    field_checks: totalChecked,
    field_passed: totalPassed,
    field_pass_rate: passRate,
    results
  };
}
