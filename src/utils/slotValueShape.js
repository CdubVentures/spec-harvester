function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase();
}

function looksLikeJson(text) {
  const trimmed = String(text || '').trim();
  return (trimmed.startsWith('[') && trimmed.endsWith(']'))
    || (trimmed.startsWith('{') && trimmed.endsWith('}'));
}

function tryParseJson(text) {
  if (!looksLikeJson(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeUnknownToken(value) {
  const token = normalizeToken(value);
  return token === ''
    || token === 'unk'
    || token === 'unknown'
    || token === 'n/a'
    || token === 'null'
    || token === 'none'
    || token === '-';
}

export function stableSerializeSlotValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializeSlotValue(item)).join(',')}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${key}:${stableSerializeSlotValue(item)}`).join(',')}}`;
  }
  return String(value ?? '');
}

function unwrapValue(value) {
  if (isObject(value) && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return value.value;
  }
  return value;
}

function normalizeScalarValue(value) {
  const raw = unwrapValue(value);
  if (raw === null || raw === undefined) {
    return { value: 'unk', reason: 'empty' };
  }

  if (typeof raw === 'string') {
    const trimmed = normalizeText(raw);
    if (normalizeUnknownToken(trimmed)) {
      return { value: 'unk', reason: 'unknown_token' };
    }
    const parsed = tryParseJson(trimmed);
    if (parsed !== null) {
      return normalizeScalarValue(parsed);
    }
    return { value: trimmed, reason: null };
  }

  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return { value: raw, reason: null };
  }

  if (Array.isArray(raw)) {
    const normalized = raw
      .map((entry) => normalizeScalarValue(entry))
      .filter((entry) => !normalizeUnknownToken(entry.value));
    if (normalized.length === 1) {
      return { value: normalized[0].value, reason: 'scalar_from_singleton_array' };
    }
    return { value: 'unk', reason: 'shape_mismatch_scalar_array' };
  }

  if (isObject(raw)) {
    return { value: 'unk', reason: 'shape_mismatch_scalar_object' };
  }

  const text = normalizeText(raw);
  if (!text || normalizeUnknownToken(text)) {
    return { value: 'unk', reason: 'unknown_token' };
  }
  return { value: text, reason: null };
}

function normalizeListItems(value) {
  const raw = unwrapValue(value);
  if (raw === null || raw === undefined) {
    return [];
  }

  if (typeof raw === 'string') {
    const trimmed = normalizeText(raw);
    if (!trimmed || normalizeUnknownToken(trimmed)) {
      return [];
    }
    const parsed = tryParseJson(trimmed);
    if (parsed !== null) {
      return normalizeListItems(parsed);
    }
    return trimmed
      .split(/[,;|/]+/)
      .map((part) => normalizeText(part))
      .filter((part) => part && !normalizeUnknownToken(part));
  }

  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return [String(raw)];
  }

  if (Array.isArray(raw)) {
    const out = [];
    for (const entry of raw) {
      out.push(...normalizeListItems(entry));
    }
    return out;
  }

  if (isObject(raw)) {
    const unwrapped = unwrapValue(raw);
    if (!isObject(unwrapped)) {
      return normalizeListItems(unwrapped);
    }
    return [stableSerializeSlotValue(unwrapped)];
  }

  const text = normalizeText(raw);
  return text && !normalizeUnknownToken(text) ? [text] : [];
}

function normalizeListValue(value) {
  const rawItems = normalizeListItems(value);
  const seen = new Set();
  const items = [];
  for (const item of rawItems) {
    const text = normalizeText(item);
    if (!text || normalizeUnknownToken(text)) continue;
    const token = normalizeToken(text);
    if (seen.has(token)) continue;
    seen.add(token);
    items.push(text);
  }
  if (items.length === 0) {
    return { value: 'unk', reason: 'empty_list' };
  }
  return { value: items, reason: null };
}

export function normalizeSlotValueForShape(value, shape = 'scalar') {
  if (String(shape || 'scalar').trim().toLowerCase() === 'list') {
    return normalizeListValue(value);
  }
  return normalizeScalarValue(value);
}

export function slotValueToText(value, shape = 'scalar') {
  const normalizedShape = String(shape || 'scalar').trim().toLowerCase();
  const raw = unwrapValue(value);
  if (raw === null || raw === undefined) {
    return null;
  }
  if (normalizedShape === 'list') {
    if (Array.isArray(raw)) {
      return raw.map((item) => normalizeText(item)).filter(Boolean).join(', ') || 'unk';
    }
    const text = normalizeText(raw);
    return text || 'unk';
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  const text = normalizeText(raw);
  return text || 'unk';
}

export function isKnownSlotValue(value, shape = 'scalar') {
  const normalized = normalizeSlotValueForShape(value, shape);
  if (String(shape || 'scalar').trim().toLowerCase() === 'list') {
    return Array.isArray(normalized.value) && normalized.value.length > 0;
  }
  return !normalizeUnknownToken(normalized.value);
}

export function slotValueComparableToken(value, shape = 'scalar') {
  const normalized = normalizeSlotValueForShape(value, shape);
  const text = slotValueToText(normalized.value, shape);
  return normalizeToken(text);
}
