/**
 * Standardized FetchResult type (IP01-1D).
 *
 * Every fetch — Playwright, replay, or raw HTTP — returns a normalized
 * FetchResult. Downstream consumers (extraction, evidence pack, frontier)
 * can rely on a consistent shape.
 *
 * Shape:
 *   { url, final_url, status, content_type, bytes, elapsed_ms,
 *     error, ok, dead, redirect, fetched_at }
 */

function normalizeUrl(value) {
  return String(value || '').trim();
}

function normalizeContentType(value) {
  const raw = String(value || '').trim().toLowerCase();
  const semi = raw.indexOf(';');
  return semi >= 0 ? raw.slice(0, semi).trim() : raw;
}

function isDeadStatus(status) {
  const code = Number(status) || 0;
  return code === 404 || code === 410 || code === 451;
}

function isRedirect(url, finalUrl) {
  if (!url || !finalUrl) return false;
  return normalizeUrl(url).toLowerCase() !== normalizeUrl(finalUrl).toLowerCase();
}

/**
 * Build a normalized FetchResult from raw fetch outcome data.
 */
export function buildFetchResult({
  url,
  finalUrl,
  status,
  contentType,
  bytes,
  elapsedMs,
  error,
  html,
  blockedByRobots
} = {}) {
  const normalizedUrl = normalizeUrl(url);
  const normalizedFinalUrl = normalizeUrl(finalUrl || url);
  const statusCode = Number(status) || 0;
  const byteCount = Number(bytes) || (typeof html === 'string' ? Buffer.byteLength(html, 'utf8') : 0);

  return {
    url: normalizedUrl,
    final_url: normalizedFinalUrl,
    status: statusCode,
    content_type: normalizeContentType(contentType || 'text/html'),
    bytes: byteCount,
    elapsed_ms: Math.max(0, Number(elapsedMs) || 0),
    error: error ? String(error) : null,
    ok: statusCode >= 200 && statusCode < 400 && !error,
    dead: isDeadStatus(statusCode),
    redirect: isRedirect(normalizedUrl, normalizedFinalUrl),
    blocked_by_robots: Boolean(blockedByRobots),
    fetched_at: new Date().toISOString()
  };
}

/**
 * Build a FetchResult representing a failed fetch (network error, timeout, etc.)
 */
export function buildFetchError({ url, error, elapsedMs } = {}) {
  return buildFetchResult({
    url,
    status: 0,
    error: error?.message || String(error || 'unknown_error'),
    elapsedMs
  });
}

/**
 * Check if a FetchResult represents a dead URL (404/410/451).
 * Dead URLs should be recorded in frontier with cooldown.
 */
export function isFetchResultDead(result) {
  if (!result) return false;
  return Boolean(result.dead) || isDeadStatus(result.status);
}

/**
 * Check if a FetchResult should trigger extraction.
 * Extraction should not run on dead URLs or errors.
 */
export function shouldExtract(result) {
  if (!result) return false;
  return result.ok && !result.dead && !result.blocked_by_robots;
}

/**
 * Summarize a FetchResult for logging or metrics.
 */
export function summarizeFetchResult(result) {
  if (!result) return { url: '', status: 0, ok: false };
  return {
    url: result.url,
    final_url: result.final_url,
    status: result.status,
    content_type: result.content_type,
    bytes: result.bytes,
    elapsed_ms: result.elapsed_ms,
    ok: result.ok,
    dead: result.dead,
    redirect: result.redirect
  };
}
