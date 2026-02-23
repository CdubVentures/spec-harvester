export function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

export function isIndexingHelperFlowEnabled(config = {}) {
  return Boolean(config?.helperFilesEnabled && config?.indexingHelperFilesEnabled);
}
