function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toStringSafe(value) {
  return String(value ?? '').trim();
}

function asNumber(value) {
  if (isFiniteNumber(value)) {
    return value;
  }
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberAndUnit(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return { value: null, unit: '' };
  }
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z"%]+)?/);
  if (!match) {
    return { value: null, unit: '' };
  }
  return {
    value: asNumber(match[1]),
    unit: String(match[2] || '').toLowerCase()
  };
}

function canonicalUnitToken(unit) {
  const token = String(unit || '').trim().toLowerCase();
  if (!token) {
    return '';
  }
  if (['g', 'gram', 'grams'].includes(token)) return 'g';
  if (['oz', 'ounce', 'ounces'].includes(token)) return 'oz';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(token)) return 'lbs';
  if (['mm', 'millimeter', 'millimeters'].includes(token)) return 'mm';
  if (['cm', 'centimeter', 'centimeters'].includes(token)) return 'cm';
  if (['in', 'inch', 'inches', '"'].includes(token)) return 'in';
  return token;
}

function convertUnit(value, fromUnit, toUnit) {
  const from = canonicalUnitToken(fromUnit);
  const to = canonicalUnitToken(toUnit);
  if (!isFiniteNumber(value) || !from || !to || from === to) {
    return value;
  }
  if (from === 'oz' && to === 'g') return value * 28.3495;
  if (from === 'lbs' && to === 'g') return value * 453.592;
  if (from === 'in' && to === 'mm') return value * 25.4;
  if (from === 'cm' && to === 'mm') return value * 10;
  if (from === 'g' && to === 'oz') return value / 28.3495;
  if (from === 'g' && to === 'lbs') return value / 453.592;
  return value;
}

function parseBoolean(value) {
  const token = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(token)) {
    return false;
  }
  return null;
}

function parseDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const token = String(value ?? '').trim();
  if (!token) {
    return null;
  }
  const parsed = new Date(token);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  const token = String(value ?? '').trim();
  if (!token) {
    return [];
  }
  return token
    .split(/[,;|/]+/)
    .map((part) => String(part || '').trim())
    .filter(Boolean);
}

function stripUnitSuffix(value) {
  const token = toStringSafe(value).replace(/[a-zA-Z%°]+$/, '').trim();
  return asNumber(token);
}

function stripCommas(value) {
  return toStringSafe(value).replace(/,/g, '');
}

function parsePollingList(value) {
  const values = parseList(value)
    .map((entry) => Number.parseInt(stripCommas(entry), 10))
    .filter((entry) => Number.isFinite(entry));
  return [...new Set(values)].sort((a, b) => b - a);
}

function parseDimensionList(value) {
  const text = Array.isArray(value) ? value.join(' ') : toStringSafe(value);
  const matches = text.match(/[\d.]+/g) || [];
  if (matches.length < 3) {
    return null;
  }
  const length = asNumber(matches[0]);
  const width = asNumber(matches[1]);
  const height = asNumber(matches[2]);
  if (length === null || width === null || height === null) {
    return null;
  }
  return {
    length,
    width,
    height
  };
}

function normalizeColorList(value) {
  return parseList(value)
    .map((entry) => toStringSafe(entry).toLowerCase())
    .filter(Boolean);
}

function parseLatencyList(value) {
  const parts = parseList(value);
  const out = [];
  for (const part of parts) {
    const match = String(part).match(/([\d.]+)\s*(wireless|wired|bluetooth|usb|2\.4g|2\.4ghz)?/i);
    if (!match) {
      continue;
    }
    const latency = asNumber(match[1]);
    if (latency === null) {
      continue;
    }
    out.push({
      value: latency,
      mode: toStringSafe(match[2] || 'default').toLowerCase()
    });
  }
  return out;
}

function parseDateExcel(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  return toStringSafe(value);
}

function normalizeBoolean(value) {
  return parseBoolean(value);
}

export const NORMALIZATION_FUNCTIONS = {
  asNumber,
  parseNumberAndUnit,
  canonicalUnitToken,
  convertUnit,
  parseBoolean,
  parseDate,
  parseList,
  strip_unit_suffix: stripUnitSuffix,
  strip_commas: stripCommas,
  oz_to_g: (value) => {
    const numeric = asNumber(value);
    return numeric === null ? null : Math.round(convertUnit(numeric, 'oz', 'g'));
  },
  lbs_to_g: (value) => {
    const numeric = asNumber(value);
    return numeric === null ? null : Math.round(convertUnit(numeric, 'lbs', 'g'));
  },
  inches_to_mm: (value) => {
    const numeric = asNumber(value);
    return numeric === null ? null : Number.parseFloat(convertUnit(numeric, 'in', 'mm').toFixed(1));
  },
  cm_to_mm: (value) => {
    const numeric = asNumber(value);
    return numeric === null ? null : Number.parseFloat(convertUnit(numeric, 'cm', 'mm').toFixed(1));
  },
  parse_polling_list: parsePollingList,
  parse_dimension_list: parseDimensionList,
  normalize_color_list: normalizeColorList,
  parse_latency_list: parseLatencyList,
  parse_date_excel: parseDateExcel,
  normalize_boolean: normalizeBoolean
};

export {
  asNumber,
  stripUnitSuffix,
  stripCommas,
  parsePollingList,
  parseDimensionList,
  normalizeColorList,
  parseLatencyList,
  parseDateExcel,
  normalizeBoolean,
  parseBoolean,
  parseDate,
  parseList,
  parseNumberAndUnit,
  convertUnit,
  canonicalUnitToken
};
