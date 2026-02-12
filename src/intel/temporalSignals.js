function round(value, digits = 4) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

const MONTH_LOOKUP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toIsoDate(year, month = 1, day = 1) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function isReasonableYear(year) {
  return year >= 1995 && year <= 2100;
}

function collectDateHits(text, sourceType) {
  const token = String(text || '');
  if (!token) {
    return [];
  }

  const hits = [];
  const dedupe = new Set();

  const isoRegex = /\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/g;
  for (const match of token.matchAll(isoRegex)) {
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    if (!isReasonableYear(year) || month < 1 || month > 12 || day < 1 || day > 31) {
      continue;
    }
    const value = toIsoDate(year, month, day);
    if (dedupe.has(value)) {
      continue;
    }
    dedupe.add(value);
    hits.push({ value, precision: 'day', source: sourceType });
  }

  const usRegex = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g;
  for (const match of token.matchAll(usRegex)) {
    const month = Number.parseInt(match[1], 10);
    const day = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3], 10);
    if (!isReasonableYear(year) || month < 1 || month > 12 || day < 1 || day > 31) {
      continue;
    }
    const value = toIsoDate(year, month, day);
    if (dedupe.has(value)) {
      continue;
    }
    dedupe.add(value);
    hits.push({ value, precision: 'day', source: sourceType });
  }

  const monthNameRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),\s*(20\d{2})\b/gi;
  for (const match of token.matchAll(monthNameRegex)) {
    const monthToken = String(match[1] || '').toLowerCase();
    const month = MONTH_LOOKUP[monthToken];
    const day = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3], 10);
    if (!month || !isReasonableYear(year) || day < 1 || day > 31) {
      continue;
    }
    const value = toIsoDate(year, month, day);
    if (dedupe.has(value)) {
      continue;
    }
    dedupe.add(value);
    hits.push({ value, precision: 'day', source: sourceType });
  }

  const yearMonthRegex = /\b(20\d{2})[-\/](\d{1,2})\b/g;
  for (const match of token.matchAll(yearMonthRegex)) {
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    if (!isReasonableYear(year) || month < 1 || month > 12) {
      continue;
    }
    const value = toIsoDate(year, month, 1);
    if (dedupe.has(value)) {
      continue;
    }
    dedupe.add(value);
    hits.push({ value, precision: 'month', source: sourceType });
  }

  const yearRegex = /\b(20\d{2})\b/g;
  for (const match of token.matchAll(yearRegex)) {
    const year = Number.parseInt(match[1], 10);
    if (!isReasonableYear(year)) {
      continue;
    }
    const value = toIsoDate(year, 1, 1);
    if (dedupe.has(value)) {
      continue;
    }
    dedupe.add(value);
    hits.push({ value, precision: 'year', source: sourceType });
  }

  return hits;
}

function collectVersionHits(text, sourceType, limit = 12) {
  const token = String(text || '');
  if (!token) {
    return [];
  }

  const dedupe = new Set();
  const out = [];

  const patterns = [
    /\b(?:firmware|fw)\s*v?\d+(?:\.\d+){0,3}\b/gi,
    /\b(?:rev(?:ision)?|version)\s*[a-z0-9._-]+\b/gi,
    /\bv\d+(?:\.\d+){1,4}\b/gi
  ];

  for (const regex of patterns) {
    for (const match of token.matchAll(regex)) {
      const value = String(match[0] || '').trim().replace(/\s+/g, ' ');
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);
      out.push({ value, source: sourceType });
      if (out.length >= limit) {
        return out;
      }
    }
  }

  return out;
}

function sourceWeight(sourceType) {
  if (sourceType === 'field_candidates') {
    return 1.2;
  }
  if (sourceType === 'title') {
    return 1;
  }
  if (sourceType === 'network') {
    return 0.9;
  }
  if (sourceType === 'url') {
    return 0.7;
  }
  return 0.6;
}

function rankDateHints(dateHints, limit = 20) {
  const now = Date.now();
  const byValue = new Map();

  for (const row of dateHints || []) {
    if (!byValue.has(row.value)) {
      byValue.set(row.value, {
        value: row.value,
        precision: row.precision,
        evidence_count: 0,
        sources: new Set(),
        score: 0
      });
    }

    const bucket = byValue.get(row.value);
    bucket.evidence_count += 1;
    bucket.sources.add(row.source);
    bucket.score += sourceWeight(row.source);
    if (row.precision === 'day') {
      bucket.score += 0.4;
    } else if (row.precision === 'month') {
      bucket.score += 0.2;
    }

    const ageDays = Math.abs((now - Date.parse(row.value)) / 86_400_000);
    if (Number.isFinite(ageDays)) {
      bucket.score += ageDays <= 720 ? 0.2 : 0;
    }
  }

  return [...byValue.values()]
    .map((item) => ({
      value: item.value,
      precision: item.precision,
      evidence_count: item.evidence_count,
      source_count: item.sources.size,
      sources: [...item.sources],
      score: round(item.score, 4)
    }))
    .sort((a, b) => b.score - a.score || b.evidence_count - a.evidence_count || b.value.localeCompare(a.value))
    .slice(0, Math.max(1, limit));
}

function rankVersionHints(versionHints, limit = 20) {
  const byValue = new Map();

  for (const row of versionHints || []) {
    const key = String(row.value || '').toLowerCase();
    if (!key) {
      continue;
    }

    if (!byValue.has(key)) {
      byValue.set(key, {
        value: row.value,
        evidence_count: 0,
        sources: new Set(),
        score: 0
      });
    }

    const bucket = byValue.get(key);
    bucket.evidence_count += 1;
    bucket.sources.add(row.source);
    bucket.score += sourceWeight(row.source);
  }

  return [...byValue.values()]
    .map((item) => ({
      value: item.value,
      evidence_count: item.evidence_count,
      source_count: item.sources.size,
      sources: [...item.sources],
      score: round(item.score, 4)
    }))
    .sort((a, b) => b.score - a.score || b.evidence_count - a.evidence_count || a.value.localeCompare(b.value))
    .slice(0, Math.max(1, limit));
}

export function extractTemporalSignals({ source, pageData, fieldCandidates = [] }) {
  const dateHints = [];
  const versionHints = [];

  const html = String(pageData?.html || '');
  const title = String(pageData?.title || '');
  const sourceUrl = String(pageData?.finalUrl || source?.url || '');

  dateHints.push(...collectDateHits(title, 'title'));
  dateHints.push(...collectDateHits(sourceUrl, 'url'));
  dateHints.push(...collectDateHits(html.slice(0, 140_000), 'html'));

  versionHints.push(...collectVersionHits(title, 'title'));
  versionHints.push(...collectVersionHits(sourceUrl, 'url'));
  versionHints.push(...collectVersionHits(html.slice(0, 140_000), 'html'));

  for (const row of pageData?.networkResponses || []) {
    const endpointUrl = row.request_url || row.url || '';
    dateHints.push(...collectDateHits(endpointUrl, 'network'));
    versionHints.push(...collectVersionHits(endpointUrl, 'network'));

    if (row.jsonFull && typeof row.jsonFull === 'object') {
      const preview = JSON.stringify(row.jsonFull).slice(0, 3500);
      dateHints.push(...collectDateHits(preview, 'network'));
      versionHints.push(...collectVersionHits(preview, 'network'));
    }
  }

  for (const candidate of fieldCandidates || []) {
    if (!candidate?.value) {
      continue;
    }
    const field = String(candidate.field || '').toLowerCase();
    if (field.includes('date') || field.includes('version') || field.includes('firmware')) {
      dateHints.push(...collectDateHits(candidate.value, 'field_candidates'));
      versionHints.push(...collectVersionHits(candidate.value, 'field_candidates'));
    }
  }

  const rankedDates = rankDateHints(dateHints, 20);
  const rankedVersions = rankVersionHints(versionHints, 20);

  return {
    date_hints: rankedDates,
    version_hints: rankedVersions,
    top_date_hint: rankedDates[0] || null,
    top_version_hint: rankedVersions[0] || null
  };
}

export function aggregateTemporalSignals(sourceResults, limit = 30) {
  const dateHints = [];
  const versionHints = [];

  for (const source of sourceResults || []) {
    const sourceHint = source.temporalSignals || {};
    for (const row of sourceHint.date_hints || []) {
      dateHints.push({
        value: row.value,
        precision: row.precision || 'day',
        source: source.url ? `source:${source.url}` : 'source'
      });
    }
    for (const row of sourceHint.version_hints || []) {
      versionHints.push({
        value: row.value,
        source: source.url ? `source:${source.url}` : 'source'
      });
    }
  }

  const rankedDates = rankDateHints(dateHints, limit);
  const rankedVersions = rankVersionHints(versionHints, limit);

  return {
    date_hint_count: rankedDates.length,
    version_hint_count: rankedVersions.length,
    top_dates: rankedDates,
    top_versions: rankedVersions,
    latest_date_hint: rankedDates[0]?.value || null
  };
}
