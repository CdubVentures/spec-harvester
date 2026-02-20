function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function normalizeResumeMode(mode = '') {
  const token = String(mode || '').trim().toLowerCase();
  if (token === 'start_over' || token === 'fresh' || token === 'reset') return 'start_over';
  if (token === 'force_resume' || token === 'resume') return 'force_resume';
  return 'auto';
}

export function resumeStateAgeHours(updatedAt, nowMs = Date.now()) {
  const ts = Date.parse(String(updatedAt || ''));
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - ts) / (60 * 60 * 1000));
}

export function isResumeStateFresh(updatedAt, maxAgeHours = 48, nowMs = Date.now()) {
  const maxHours = Math.max(0, toFloat(maxAgeHours, 48));
  if (maxHours <= 0) return true;
  return resumeStateAgeHours(updatedAt, nowMs) <= maxHours;
}

export function normalizeHttpUrlList(values, limit = 120) {
  const seen = new Set();
  const out = [];
  const max = Math.max(1, toInt(limit, 120));
  for (const raw of values || []) {
    const url = normalizeUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

export function shouldQueueLlmRetry({ reason = '', status = 0, discoveryOnly = false } = {}) {
  const token = String(reason || '').trim().toLowerCase();
  const code = toInt(status, 0);
  if (discoveryOnly) return false;
  if (!token) return false;
  if (token === 'runtime_override_disable_llm') return true;
  if (token === 'llm_budget_guard_blocked') return true;
  if (token === 'http_status_source_unavailable' && code >= 500) return true;
  return false;
}

function normalizeRetryRows(rows = []) {
  const normalized = [];
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    const url = normalizeUrl(row.url);
    if (!url) continue;
    normalized.push({
      url,
      first_seen_at: String(row.first_seen_at || '').trim() || '',
      last_seen_at: String(row.last_seen_at || '').trim() || '',
      last_reason: String(row.last_reason || '').trim() || '',
      retry_count: Math.max(1, toInt(row.retry_count, 1))
    });
  }
  return normalized;
}

function normalizeSuccessRows(rows = []) {
  const normalized = [];
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    const url = normalizeUrl(row.url);
    if (!url) continue;
    normalized.push({
      url,
      last_success_at: String(row.last_success_at || '').trim() || '',
      success_count: Math.max(1, toInt(row.success_count, 1)),
      last_status: Math.max(0, toInt(row.last_status, 200))
    });
  }
  return normalized;
}

export function buildNextLlmRetryRows({
  previousRows = [],
  newReasonByUrl = new Map(),
  attemptedUrls = new Set(),
  nowIso = new Date().toISOString(),
  limit = 80
} = {}) {
  const max = Math.max(1, toInt(limit, 80));
  const attempted = new Set(normalizeHttpUrlList([...attemptedUrls], Number.MAX_SAFE_INTEGER));
  const merged = new Map();
  const previousNormalized = normalizeRetryRows(previousRows);
  const previousByUrl = new Map(previousNormalized.map((row) => [row.url, row]));

  for (const row of previousNormalized) {
    if (attempted.has(row.url)) {
      continue;
    }
    merged.set(row.url, row);
  }

  for (const [rawUrl, rawReason] of newReasonByUrl.entries()) {
    const url = normalizeUrl(rawUrl);
    if (!url) continue;
    const reason = String(rawReason || '').trim();
    const prev = merged.get(url) || previousByUrl.get(url) || null;
    merged.set(url, {
      url,
      first_seen_at: prev?.first_seen_at || nowIso,
      last_seen_at: nowIso,
      last_reason: reason || prev?.last_reason || '',
      retry_count: Math.max(1, toInt(prev?.retry_count, 0) + 1)
    });
  }

  return [...merged.values()]
    .sort((a, b) => {
      const aTs = Date.parse(a.last_seen_at || '') || 0;
      const bTs = Date.parse(b.last_seen_at || '') || 0;
      if (bTs !== aTs) return bTs - aTs;
      return b.retry_count - a.retry_count || a.url.localeCompare(b.url);
    })
    .slice(0, max);
}

export function collectPlannerPendingUrls(planner) {
  const rows = [
    ...(planner?.manufacturerQueue || []),
    ...(planner?.queue || []),
    ...(planner?.candidateQueue || [])
  ];
  return rows.map((row) => row?.url).filter(Boolean);
}

export function selectReextractSeedUrls({
  successRows = [],
  afterHours = 24,
  limit = 8,
  nowMs = Date.now()
} = {}) {
  const max = Math.max(1, toInt(limit, 8));
  const minHours = Math.max(0, toFloat(afterHours, 24));
  return normalizeSuccessRows(successRows)
    .filter((row) => {
      if (!row.last_success_at) return true;
      const ts = Date.parse(row.last_success_at);
      if (!Number.isFinite(ts)) return true;
      if (minHours <= 0) return true;
      return (nowMs - ts) >= (minHours * 60 * 60 * 1000);
    })
    .sort((a, b) => {
      const aTs = Date.parse(a.last_success_at || '') || 0;
      const bTs = Date.parse(b.last_success_at || '') || 0;
      return aTs - bTs || a.url.localeCompare(b.url);
    })
    .slice(0, max)
    .map((row) => row.url);
}

export function buildNextSuccessRows({
  previousRows = [],
  newSuccessByUrl = new Map(),
  nowIso = new Date().toISOString(),
  limit = 220
} = {}) {
  const max = Math.max(1, toInt(limit, 220));
  const merged = new Map(normalizeSuccessRows(previousRows).map((row) => [row.url, row]));
  for (const [rawUrl, payload] of newSuccessByUrl.entries()) {
    const url = normalizeUrl(rawUrl);
    if (!url) continue;
    const prev = merged.get(url) || null;
    const status = toInt(payload?.status, prev?.last_status || 200);
    const lastSuccessAt = String(payload?.last_success_at || nowIso).trim() || nowIso;
    merged.set(url, {
      url,
      last_success_at: lastSuccessAt,
      success_count: Math.max(1, toInt(prev?.success_count, 0) + 1),
      last_status: status
    });
  }
  return [...merged.values()]
    .sort((a, b) => {
      const aTs = Date.parse(a.last_success_at || '') || 0;
      const bTs = Date.parse(b.last_success_at || '') || 0;
      if (bTs !== aTs) return bTs - aTs;
      return b.success_count - a.success_count || a.url.localeCompare(b.url);
    })
    .slice(0, max);
}
