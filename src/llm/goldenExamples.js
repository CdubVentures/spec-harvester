const CACHE = new Map();
const CACHE_TTL_MS = 45_000;

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeToken(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function toSet(value) {
  return new Set(tokenize(value));
}

function tokenOverlap(aSet, bSet) {
  if (!aSet.size || !bSet.size) {
    return 0;
  }
  let hits = 0;
  for (const token of aSet) {
    if (bSet.has(token)) {
      hits += 1;
    }
  }
  return hits / Math.max(1, aSet.size);
}

function scoreExample(job, spec = {}) {
  const brandA = toSet(job.identityLock?.brand || '');
  const brandB = toSet(spec.brand || '');
  const modelA = toSet(job.identityLock?.model || '');
  const modelB = toSet(spec.model || '');
  const variantA = toSet(job.identityLock?.variant || '');
  const variantB = toSet(spec.variant || '');
  const sensorA = toSet(spec.sensor || '');
  const sensorB = toSet(job.identityLock?.sensor || '');

  let score = 0;
  score += tokenOverlap(brandA, brandB) * 2;
  score += tokenOverlap(modelA, modelB) * 3;
  score += tokenOverlap(variantA, variantB) * 1;
  score += tokenOverlap(sensorA, sensorB) * 1.2;
  return score;
}

function compactExample(spec = {}, summary = {}, key = '') {
  return {
    key,
    validated: Boolean(summary.validated),
    confidence: Number(summary.confidence || 0),
    fields: {
      brand: spec.brand || '',
      model: spec.model || '',
      variant: spec.variant || '',
      connection: spec.connection || '',
      connectivity: spec.connectivity || '',
      sensor: spec.sensor || '',
      sensor_brand: spec.sensor_brand || '',
      polling_rate: spec.polling_rate || '',
      dpi: spec.dpi || '',
      weight: spec.weight || '',
      lngth: spec.lngth || '',
      width: spec.width || '',
      height: spec.height || '',
      switch: spec.switch || '',
      encoder: spec.encoder || ''
    }
  };
}

export async function retrieveGoldenExamples({
  storage,
  category,
  job,
  limit = 5,
  maxScan = 200
}) {
  const cacheKey = `${category}::${normalizeToken(job.identityLock?.brand)}::${normalizeToken(job.identityLock?.model)}`;
  const cached = CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.rows;
  }

  const prefix = `final/${category}`;
  const keys = await storage.listKeys(prefix);
  const specKeys = keys
    .filter((key) => String(key).endsWith('/spec.json'))
    .slice(0, Math.max(limit * 20, maxScan));

  const rows = [];
  for (const key of specKeys) {
    const summaryKey = key.replace(/\/spec\.json$/i, '/summary.json');
    const [spec, summary] = await Promise.all([
      storage.readJsonOrNull(key),
      storage.readJsonOrNull(summaryKey)
    ]);
    if (!spec || !summary || !summary.validated) {
      continue;
    }
    const score = scoreExample(job, spec);
    rows.push({
      score,
      row: compactExample(spec, summary, key)
    });
  }

  const selected = rows
    .sort((a, b) => b.score - a.score || b.row.confidence - a.row.confidence)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.row);

  CACHE.set(cacheKey, {
    ts: Date.now(),
    rows: selected
  });
  return selected;
}
