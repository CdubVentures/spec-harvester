import fs from 'node:fs/promises';
import path from 'node:path';
import { initCategory } from '../field-rules/compiler.js';
import {
  loadQueueState,
  recordQueueFailure,
  selectNextQueueProduct,
  upsertQueueProduct
} from '../queue/queueState.js';
import { buildSourceHealth } from '../publish/publishingPipeline.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeCategory(item))
    .filter(Boolean);
}

function toPosix(...parts) {
  return parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonIfMissing(filePath, payload) {
  if (await fileExists(filePath)) {
    return false;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return true;
}

function seededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomHost(rand) {
  const hosts = [
    'manufacturer.example',
    'rtings.example',
    'review.example',
    'retail.example',
    'lab.example'
  ];
  return hosts[Math.floor(rand() * hosts.length)] || hosts[0];
}

function randomStatus(rand) {
  const statuses = [200, 200, 200, 403, 429, 500];
  return statuses[Math.floor(rand() * statuses.length)] || 200;
}

function randomHex(rand, len = 8) {
  let out = '';
  for (let idx = 0; idx < len; idx += 1) {
    out += Math.floor(rand() * 16).toString(16);
  }
  return out;
}

function safeSemver(value) {
  return String(value || '').trim();
}

export async function bootstrapExpansionCategories({
  config = {},
  categories = ['monitor', 'keyboard'],
  template = 'electronics',
  goldenRoot = path.resolve('fixtures', 'golden')
} = {}) {
  const helperFilesRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoriesRoot = path.resolve(config.categoriesRoot || 'categories');
  const normalizedTemplate = normalizeToken(template) || 'electronics';
  const targets = categories.length > 0 ? categories : ['monitor', 'keyboard'];
  const normalizedTargets = [...new Set(targets.map((value) => normalizeCategory(value)).filter(Boolean))];

  const rows = [];
  for (const category of normalizedTargets) {
    const initResult = await initCategory({
      category,
      template: normalizedTemplate,
      config: {
        ...config,
        helperFilesRoot,
        categoriesRoot
      }
    });

    const manifestPath = path.resolve(goldenRoot, category, 'manifest.json');
    const manifestCreated = await writeJsonIfMissing(manifestPath, {
      category,
      version: 1,
      generated_at: new Date().toISOString(),
      cases: []
    });

    rows.push({
      category,
      template: normalizedTemplate,
      helper_category_root: initResult.paths.helper_category_root,
      category_root: initResult.paths.category_root,
      starter_workbook: path.join(initResult.paths.source_root, 'field_catalog.xlsx'),
      golden_manifest: manifestPath,
      golden_manifest_created: manifestCreated,
      created_files_count: Array.isArray(initResult.created_files) ? initResult.created_files.length : 0
    });
  }

  return {
    generated_at: new Date().toISOString(),
    helper_root: helperFilesRoot,
    categories_root: categoriesRoot,
    golden_root: path.resolve(goldenRoot),
    categories: normalizedTargets,
    categories_count: rows.length,
    rows
  };
}

export async function runQueueLoadHarness({
  storage,
  category = 'mouse',
  productCount = 200,
  selectCycles = 100
}) {
  const normalizedCategory = normalizeCategory(category) || 'mouse';
  const count = Math.max(1, toInt(productCount, 200));
  const cycles = Math.max(1, toInt(selectCycles, 100));
  const start = Date.now();
  for (let idx = 0; idx < count; idx += 1) {
    const productId = `${normalizedCategory}-load-${String(idx + 1).padStart(4, '0')}`;
    await upsertQueueProduct({
      storage,
      category: normalizedCategory,
      productId,
      s3key: `specs/inputs/${normalizedCategory}/products/${productId}.json`,
      patch: {
        status: 'pending',
        priority: (idx % 5) + 1,
        next_action_hint: 'fast_pass'
      }
    });
  }

  let selected = 0;
  for (let idx = 0; idx < cycles; idx += 1) {
    const loaded = await loadQueueState({ storage, category: normalizedCategory });
    const next = selectNextQueueProduct(loaded.state);
    if (!next || !next.productId) {
      break;
    }
    selected += 1;
    await upsertQueueProduct({
      storage,
      category: normalizedCategory,
      productId: next.productId,
      s3key: next.s3key || `specs/inputs/${normalizedCategory}/products/${next.productId}.json`,
      patch: {
        status: 'complete',
        next_action_hint: 'none'
      }
    });
  }

  const durationMs = Date.now() - start;
  return {
    category: normalizedCategory,
    seeded_products: count,
    select_cycles_requested: cycles,
    select_cycles_completed: selected,
    duration_ms: durationMs,
    selects_per_second: Number.parseFloat((selected / Math.max(0.001, durationMs / 1000)).toFixed(4)),
    status: selected > 0 ? 'ok' : 'no_selectable_products'
  };
}

export async function runFailureInjectionHarness({
  storage,
  category = 'mouse',
  productId = '',
  maxAttempts = 3
}) {
  const normalizedCategory = normalizeCategory(category) || 'mouse';
  const targetProductId = normalizeCategory(productId) || `${normalizedCategory}-failure-injection`;
  const attempts = Math.max(1, toInt(maxAttempts, 3));
  const s3key = `specs/inputs/${normalizedCategory}/products/${targetProductId}.json`;

  await upsertQueueProduct({
    storage,
    category: normalizedCategory,
    productId: targetProductId,
    s3key,
    patch: {
      status: 'pending',
      max_attempts: attempts
    }
  });

  const events = [];
  for (let idx = 0; idx < attempts; idx += 1) {
    const result = await recordQueueFailure({
      storage,
      category: normalizedCategory,
      productId: targetProductId,
      s3key,
      error: new Error(`injected_failure_${idx + 1}`)
    });
    events.push({
      attempt: idx + 1,
      status: result.product.status,
      retry_count: result.product.retry_count,
      next_retry_at: result.product.next_retry_at || null
    });
  }

  const loaded = await loadQueueState({ storage, category: normalizedCategory });
  const final = loaded.state.products[targetProductId] || {};
  return {
    category: normalizedCategory,
    product_id: targetProductId,
    max_attempts: attempts,
    final_status: String(final.status || 'unknown'),
    final_retry_count: toInt(final.retry_count, 0),
    passed: String(final.status || '') === 'failed' && toInt(final.retry_count, 0) >= attempts,
    events
  };
}

export async function runFuzzSourceHealthHarness({
  storage,
  category = 'mouse',
  iterations = 200,
  seed = 1337
}) {
  const normalizedCategory = normalizeCategory(category) || 'mouse';
  const count = Math.max(1, toInt(iterations, 200));
  const rand = seededRandom(seed);
  const lines = [];
  let malformedCount = 0;
  for (let idx = 0; idx < count; idx += 1) {
    const malformed = rand() < 0.3;
    if (malformed) {
      malformedCount += 1;
      const badLine = rand() < 0.5
        ? `{"ts":"${new Date(Date.now() - idx * 60000).toISOString()}","host":"${randomHost(rand)}"`
        : `not-json-${randomHex(rand, 12)}`;
      lines.push(badLine);
      continue;
    }
    const host = randomHost(rand);
    const ts = new Date(Date.now() - idx * 60000).toISOString();
    lines.push(JSON.stringify({
      ts,
      host,
      source_id: host.replace(/\./g, '_'),
      status: randomStatus(rand),
      page_content_hash: `sha256:${randomHex(rand, 24)}`,
      text_hash: `sha256:${randomHex(rand, 24)}`
    }));
  }

  const relPath = toPosix('final', normalizedCategory, 'fuzz-brand', 'fuzz-model', 'evidence', 'sources.jsonl');
  const legacyPath = storage.resolveOutputKey('final', normalizedCategory, 'fuzz-brand', 'fuzz-model', 'evidence', 'sources.jsonl');
  const text = `${lines.join('\n')}\n`;
  const body = Buffer.from(text, 'utf8');
  await storage.writeObject(relPath, body, { contentType: 'application/x-ndjson' });
  await storage.writeObject(legacyPath, body, { contentType: 'application/x-ndjson' });

  const health = await buildSourceHealth({
    storage,
    category: normalizedCategory,
    periodDays: 30
  });

  return {
    category: normalizedCategory,
    iterations: count,
    malformed_count: malformedCount,
    parsed_sources: toInt(health.total_sources, 0),
    alerts: Array.isArray(health.alerts) ? health.alerts.length : 0,
    passed: toInt(health.total_sources, 0) >= 1
  };
}

export async function runProductionHardeningReport({
  rootDir = process.cwd(),
  requiredDocs = [
    'README.md',
    'docs/ARCHITECTURE.md',
    'docs/NEW-CATEGORY-GUIDE.md',
    'docs/RUNBOOK.md',
    'docs/API-REFERENCE.md'
  ]
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const packagePath = path.join(resolvedRoot, 'package.json');
  const packageLockPath = path.join(resolvedRoot, 'package-lock.json');
  const gitIgnorePath = path.join(resolvedRoot, '.gitignore');

  const issues = [];
  const warnings = [];

  let packageJson = null;
  if (await fileExists(packagePath)) {
    try {
      packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    } catch (error) {
      issues.push({
        code: 'package_json_invalid',
        severity: 'high',
        message: error.message
      });
    }
  } else {
    issues.push({
      code: 'package_json_missing',
      severity: 'high',
      message: 'package.json was not found'
    });
  }

  const dependencyRows = [];
  const nonExact = [];
  if (packageJson && typeof packageJson === 'object') {
    for (const sectionName of ['dependencies', 'devDependencies']) {
      const section = packageJson[sectionName] && typeof packageJson[sectionName] === 'object'
        ? packageJson[sectionName]
        : {};
      for (const [name, version] of Object.entries(section)) {
        const spec = safeSemver(version);
        dependencyRows.push({ name, section: sectionName, version: spec });
        if (/^[~^]|x$|\*$/.test(spec) || spec.includes('>') || spec.includes('<')) {
          nonExact.push({ name, section: sectionName, version: spec });
        }
      }
    }
  }

  if (!(await fileExists(packageLockPath))) {
    issues.push({
      code: 'package_lock_missing',
      severity: 'high',
      message: 'package-lock.json missing (lockfile required for reproducible builds)'
    });
  }

  if (nonExact.length > 0) {
    warnings.push({
      code: 'dependency_versions_not_exact',
      severity: 'medium',
      count: nonExact.length
    });
  }

  const docsMissing = [];
  for (const relPath of requiredDocs) {
    const absPath = path.join(resolvedRoot, relPath);
    if (!(await fileExists(absPath))) {
      docsMissing.push(relPath);
    }
  }
  if (docsMissing.length > 0) {
    issues.push({
      code: 'docs_missing',
      severity: 'medium',
      missing: docsMissing
    });
  }

  let gitIgnoreText = '';
  if (await fileExists(gitIgnorePath)) {
    gitIgnoreText = await fs.readFile(gitIgnorePath, 'utf8');
  } else {
    issues.push({
      code: 'gitignore_missing',
      severity: 'medium',
      message: '.gitignore missing'
    });
  }
  if (gitIgnoreText && !/^\s*\.env\s*$/m.test(gitIgnoreText)) {
    issues.push({
      code: 'gitignore_missing_env',
      severity: 'high',
      message: '.env is not explicitly ignored'
    });
  }

  const enginesNode = String(packageJson?.engines?.node || '').trim();
  if (!enginesNode) {
    warnings.push({
      code: 'engines_node_missing',
      severity: 'low',
      message: 'package.json engines.node is not set'
    });
  }

  return {
    generated_at: new Date().toISOString(),
    root_dir: resolvedRoot,
    dependency_count: dependencyRows.length,
    non_exact_dependency_count: nonExact.length,
    non_exact_dependencies: nonExact.slice(0, 100),
    lockfile_present: await fileExists(packageLockPath),
    docs_required_count: requiredDocs.length,
    docs_missing_count: docsMissing.length,
    docs_missing: docsMissing,
    engines_node: enginesNode || null,
    issues,
    warnings,
    passed: issues.filter((row) => normalizeToken(row.severity) === 'high').length === 0
  };
}

export function parseExpansionCategories(value, fallback = ['monitor', 'keyboard']) {
  const parsed = parseCsvList(value);
  return parsed.length > 0 ? parsed : [...fallback];
}
