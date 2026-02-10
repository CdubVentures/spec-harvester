import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { toPosixKey } from '../s3/storage.js';
import { nowIso } from '../utils/common.js';
import { upsertQueueProduct } from '../queue/queueState.js';

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function safeJsonParse(value, fallback = null) {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toList(value) {
  return String(value || '')
    .split(/[|,;\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  const flushCell = () => {
    row.push(current);
    current = '';
  };

  const flushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ',') {
      flushCell();
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') {
        i += 1;
      }
      flushCell();
      flushRow();
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    flushCell();
    flushRow();
  }

  const normalizedRows = rows
    .map((r) => r.map((c) => String(c || '').trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (!normalizedRows.length) {
    return [];
  }

  const headers = normalizedRows[0].map((item) => item.toLowerCase());
  return normalizedRows.slice(1).map((cells, index) => {
    const out = { __row: index + 2 };
    for (let i = 0; i < headers.length; i += 1) {
      out[headers[i]] = cells[i] || '';
    }
    return out;
  });
}

function buildProductId({ category, brand, model, variant }) {
  return [slug(category), slug(brand), slug(model), slug(variant)]
    .filter(Boolean)
    .join('-');
}

function buildImportHash({ csvPath, content }) {
  const hash = crypto.createHash('sha256');
  hash.update(path.basename(csvPath));
  hash.update('\n');
  hash.update(content);
  return hash.digest('hex');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function categoryImportPaths(importsRoot, category) {
  const root = path.resolve(importsRoot, category);
  return {
    root,
    incoming: path.join(root, 'incoming'),
    processed: path.join(root, 'processed'),
    failed: path.join(root, 'failed'),
    state: path.join(root, 'state.json')
  };
}

async function readImportState(filePath, category) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        category,
        updated_at: nowIso(),
        processed_files: {},
        products: {}
      };
    }
    throw error;
  }
}

async function writeImportState(filePath, state) {
  const next = {
    ...state,
    updated_at: nowIso()
  };
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeIdentityLock(row) {
  return {
    brand: String(row.brand || '').trim(),
    model: String(row.model || '').trim(),
    variant: String(row.variant || '').trim(),
    sku: String(row.sku || '').trim(),
    mpn: String(row.mpn || '').trim(),
    gtin: String(row.gtin || '').trim()
  };
}

function buildJobFromRow({ category, row }) {
  const identityLock = normalizeIdentityLock(row);
  if (!identityLock.brand || !identityLock.model) {
    return null;
  }

  const productId = buildProductId({
    category,
    brand: identityLock.brand,
    model: identityLock.model,
    variant: identityLock.variant
  });
  if (!productId) {
    return null;
  }

  const anchors = safeJsonParse(row.anchors_json, {}) || {};
  const requirements = safeJsonParse(row.requirements_json, null);

  const job = {
    productId,
    category,
    identityLock,
    seedUrls: toList(row.seed_urls),
    anchors
  };
  if (requirements && typeof requirements === 'object') {
    job.requirements = requirements;
  }

  return job;
}

function buildProcessedFileName(csvPath) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const ext = path.extname(csvPath) || '.csv';
  const base = path.basename(csvPath, ext);
  return `${base}.${stamp}${ext}`;
}

export async function ingestCsvFile({
  storage,
  config,
  category,
  csvPath,
  importsRoot = config.importsRoot || 'imports'
}) {
  const paths = categoryImportPaths(importsRoot, category);
  await ensureDir(paths.root);
  await ensureDir(paths.incoming);
  await ensureDir(paths.processed);
  await ensureDir(paths.failed);

  const content = await fs.readFile(csvPath, 'utf8');
  const importHash = buildImportHash({ csvPath, content });
  const state = await readImportState(paths.state, category);
  if (state.processed_files?.[importHash]) {
    return {
      skipped: true,
      reason: 'duplicate_import_hash',
      hash: importHash,
      category,
      file: csvPath,
      existing: state.processed_files[importHash]
    };
  }

  const rows = parseCsv(content);
  const jobs = [];
  const invalidRows = [];

  for (const row of rows) {
    const job = buildJobFromRow({ category, row });
    if (!job) {
      invalidRows.push({
        row: row.__row,
        reason: 'missing_brand_or_model'
      });
      continue;
    }
    jobs.push(job);
  }

  for (const job of jobs) {
    const s3key = toPosixKey(config.s3InputPrefix, category, 'products', `${job.productId}.json`);
    await storage.writeObject(
      s3key,
      Buffer.from(JSON.stringify(job, null, 2), 'utf8'),
      { contentType: 'application/json' }
    );

    await upsertQueueProduct({
      storage,
      category,
      productId: job.productId,
      s3key,
      patch: {
        status: 'pending',
        next_action_hint: 'fast_pass'
      }
    });

    state.products[job.productId] = {
      last_seen_at: nowIso(),
      source_file: path.basename(csvPath)
    };
  }

  state.processed_files[importHash] = {
    file: path.basename(csvPath),
    hash: importHash,
    processed_at: nowIso(),
    row_count: rows.length,
    job_count: jobs.length,
    invalid_row_count: invalidRows.length
  };
  await writeImportState(paths.state, state);

  const movedName = buildProcessedFileName(csvPath);
  const movedPath = path.join(paths.processed, movedName);
  await fs.rename(csvPath, movedPath);

  return {
    skipped: false,
    category,
    file: csvPath,
    processed_file: movedPath,
    hash: importHash,
    row_count: rows.length,
    job_count: jobs.length,
    invalid_rows: invalidRows,
    jobs: jobs.map((job) => ({
      productId: job.productId,
      s3key: toPosixKey(config.s3InputPrefix, category, 'products', `${job.productId}.json`)
    }))
  };
}

export async function discoverIncomingCsvFiles({
  category,
  importsRoot
}) {
  const paths = categoryImportPaths(importsRoot, category);
  await ensureDir(paths.incoming);
  const entries = await fs.readdir(paths.incoming, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.csv$/i.test(entry.name))
    .map((entry) => path.join(paths.incoming, entry.name))
    .sort();
}

export async function ingestIncomingCsvs({
  storage,
  config,
  category,
  importsRoot = config.importsRoot || 'imports'
}) {
  const files = await discoverIncomingCsvFiles({ category, importsRoot });
  const runs = [];
  for (const csvPath of files) {
    try {
      const result = await ingestCsvFile({
        storage,
        config,
        category,
        csvPath,
        importsRoot
      });
      runs.push({
        ok: true,
        ...result
      });
    } catch (error) {
      const paths = categoryImportPaths(importsRoot, category);
      await ensureDir(paths.failed);
      const movedName = buildProcessedFileName(csvPath);
      const failedPath = path.join(paths.failed, movedName);
      try {
        await fs.rename(csvPath, failedPath);
      } catch {
        // keep original path when rename fails
      }
      runs.push({
        ok: false,
        file: csvPath,
        error: error.message
      });
    }
  }

  return {
    category,
    imports_root: path.resolve(importsRoot),
    discovered_csv_count: files.length,
    processed_count: runs.filter((run) => run.ok).length,
    failed_count: runs.filter((run) => !run.ok).length,
    runs
  };
}

export async function listImportCategories(importsRoot) {
  const root = path.resolve(importsRoot);
  await ensureDir(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
