import { parseNumber, splitListValue, normalizeToken } from '../utils/common.js';

function normalizeString(value) {
  return String(value || '').trim();
}

function listMaxNumeric(value) {
  if (!value) {
    return null;
  }
  const nums = splitListValue(value)
    .map((part) => parseNumber(part))
    .filter((n) => n !== null);
  if (!nums.length) {
    const fallback = parseNumber(value);
    return fallback;
  }
  return Math.max(...nums);
}

function isTruthyAnchor(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function compareExact(expected, actual) {
  const e = normalizeToken(expected);
  const a = normalizeToken(actual);
  if (!e || !a) {
    return null;
  }
  return e === a;
}

function pushConflict(conflicts, field, severity, expected, actual, reason) {
  conflicts.push({
    field,
    severity,
    expected: String(expected),
    actual: String(actual),
    reason
  });
}

function compareNumericDiff(conflicts, field, expected, actual, minorThreshold, reasonMinor, reasonMajor) {
  const e = parseNumber(expected);
  const a = parseNumber(actual);
  if (e === null || a === null) {
    return;
  }
  const diff = Math.abs(e - a);
  if (diff <= 0) {
    return;
  }
  if (diff <= minorThreshold) {
    pushConflict(conflicts, field, 'MINOR', expected, actual, `${reasonMinor}: ${diff}`);
  } else {
    pushConflict(conflicts, field, 'MAJOR', expected, actual, `${reasonMajor}: ${diff}`);
  }
}

function comparePollingOrDpi(conflicts, field, expected, actual) {
  const expMax = listMaxNumeric(expected);
  const actMax = listMaxNumeric(actual);
  if (expMax === null || actMax === null) {
    return;
  }
  if (Math.abs(expMax - actMax) > 0) {
    pushConflict(conflicts, field, 'MAJOR', expected, actual, `${field} max differs`);
  }
}

function compareIpsOrAcceleration(conflicts, field, expected, actual) {
  const e = parseNumber(expected);
  const a = parseNumber(actual);
  if (e === null || a === null) {
    const exact = compareExact(expected, actual);
    if (exact === false) {
      pushConflict(conflicts, field, 'MAJOR', expected, actual, `${field} class mismatch`);
    }
    return;
  }

  const diff = Math.abs(e - a);
  const relative = e === 0 ? 1 : diff / e;
  if (relative > 0.2 || diff >= 10) {
    pushConflict(conflicts, field, 'MAJOR', expected, actual, `${field} large difference`);
  }
}

export function evaluateAnchorConflicts(anchors = {}, candidateFields = {}) {
  const conflicts = [];
  const presentAnchors = Object.entries(anchors).filter(([, v]) => isTruthyAnchor(v));

  for (const [field, expected] of presentAnchors) {
    const actual = candidateFields[field];
    if (!isTruthyAnchor(actual)) {
      continue;
    }

    if (field === 'weight') {
      compareNumericDiff(
        conflicts,
        field,
        expected,
        actual,
        2,
        'Weight diff minor threshold',
        'Weight diff major threshold'
      );
      continue;
    }

    if (['lngth', 'width', 'height'].includes(field)) {
      compareNumericDiff(
        conflicts,
        field,
        expected,
        actual,
        1,
        'Dimension diff minor threshold',
        'Dimension diff major threshold'
      );
      continue;
    }

    if (['polling_rate', 'dpi'].includes(field)) {
      comparePollingOrDpi(conflicts, field, expected, actual);
      continue;
    }

    if (['ips', 'acceleration'].includes(field)) {
      compareIpsOrAcceleration(conflicts, field, expected, actual);
      continue;
    }

    if (
      [
        'sensor',
        'sensor_brand',
        'form_factor',
        'shape',
        'hump',
        'front_flare',
        'thumb_rest',
        'hot_swappable',
        'side_buttons',
        'middle_buttons'
      ].includes(field)
    ) {
      const same = compareExact(expected, actual);
      if (same === false) {
        pushConflict(conflicts, field, 'MAJOR', expected, actual, `${field} mismatch`);
      }
      continue;
    }

    const same = compareExact(expected, actual);
    if (same === false) {
      pushConflict(conflicts, field, 'MINOR', expected, actual, `${field} mismatch`);
    }
  }

  return {
    anchorFieldsPresent: presentAnchors.length > 0,
    conflicts,
    majorConflicts: conflicts.filter((c) => c.severity === 'MAJOR')
  };
}

export function hasMajorAnchorConflicts(anchorCheck) {
  return (anchorCheck?.majorConflicts || []).length > 0;
}

export function mergeAnchorConflictLists(sourceChecks) {
  const seen = new Set();
  const merged = [];

  for (const item of sourceChecks) {
    for (const conflict of item?.conflicts || []) {
      const key = `${conflict.field}|${conflict.expected}|${conflict.actual}|${conflict.severity}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(conflict);
    }
  }

  return merged;
}
