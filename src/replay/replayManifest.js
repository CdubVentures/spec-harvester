import zlib from 'node:zlib';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(value) {
  const token = String(value || '').trim();
  if (!token) {
    return '';
  }
  try {
    return new URL(token).toString();
  } catch {
    return '';
  }
}

function normalizeHost(host, url = '') {
  const direct = String(host || '').trim().toLowerCase().replace(/^www\./, '');
  if (direct) {
    return direct;
  }
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function parseJsonl(text = '') {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed rows
    }
  }
  return rows;
}

function decodeEventLog(buffer) {
  if (!buffer || buffer.length === 0) {
    return '';
  }
  try {
    return zlib.gunzipSync(buffer).toString('utf8');
  } catch {
    return buffer.toString('utf8');
  }
}

function ensureArrayMap(map, key) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  return map.get(key);
}

export async function loadReplayManifest({
  storage,
  category,
  productId,
  runId
}) {
  if (!category || !productId || !runId) {
    throw new Error('replay manifest requires category, productId, and runId');
  }

  const runBase = storage.resolveOutputKey(category, productId, 'runs', runId);
  const eventsGzKey = `${runBase}/logs/events.jsonl.gz`;
  const eventsJsonlKey = `${runBase}/logs/events.jsonl`;
  const eventBuffer = await storage.readObjectOrNull(eventsGzKey);
  let eventsText = decodeEventLog(eventBuffer);
  if (!eventsText) {
    eventsText = await storage.readTextOrNull(eventsJsonlKey) || '';
  }
  if (!eventsText) {
    throw new Error(`Replay run events are missing for ${runBase}`);
  }

  const events = parseJsonl(eventsText);
  if (!events.length) {
    throw new Error(`Replay run events are empty for ${runBase}`);
  }

  const startedByUrl = new Map();
  for (const row of events) {
    if (String(row?.event || '') !== 'source_fetch_started') {
      continue;
    }
    const url = normalizeUrl(row.url);
    if (!url) {
      continue;
    }
    ensureArrayMap(startedByUrl, url).push(row);
  }

  const sources = [];
  const sourceUrls = [];
  const seenSourceUrls = new Set();
  const processedRows = events.filter((row) => String(row?.event || '') === 'source_processed');
  for (const row of processedRows) {
    const url = normalizeUrl(row.url || row.finalUrl || '');
    if (!url) {
      continue;
    }
    const startQueue = startedByUrl.get(url) || [];
    const started = startQueue.length > 0 ? startQueue.shift() : null;
    const host = normalizeHost(row.host || started?.host, url);
    const index = sources.length;
    const artifactKey = `${host}__${String(index).padStart(4, '0')}`;
    const finalUrl = normalizeUrl(row.finalUrl || row.url || started?.url || '');

    sources.push({
      index,
      artifact_key: artifactKey,
      url,
      final_url: finalUrl || url,
      host,
      status: toInt(row.status, toInt(started?.status, 0)),
      tier: toInt(started?.tier, 0),
      role: String(started?.role || '').trim().toLowerCase(),
      approved_domain: Boolean(started?.approved_domain),
      candidate_source: Boolean(row.candidate_source)
    });

    if (!seenSourceUrls.has(url)) {
      seenSourceUrls.add(url);
      sourceUrls.push(url);
    }
  }

  if (!sources.length) {
    throw new Error(`Replay run ${runId} has no source_processed events`);
  }

  return {
    category,
    productId,
    runId,
    runBase,
    source_count: sources.length,
    source_urls: sourceUrls,
    sources
  };
}
