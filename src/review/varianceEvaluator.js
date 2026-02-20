// ── Variance Evaluator ───────────────────────────────────────────────
//
// Pure functions for evaluating whether a product-level value conforms
// to a component DB's variance policy.  Zero external dependencies.
//
// Supports the 5 validated policy types from categoryCompile.js:
//   null / missing    → always compliant (no enforcement)
//   override_allowed  → always compliant
//   authoritative     → exact match (case-insensitive, numeric-normalised)
//   upper_bound       → product value ≤ DB value
//   lower_bound       → product value ≥ DB value
//   range             → product value within ±tolerance of DB value (default 10%)

const SKIP_VALUES = new Set(['', 'unk', 'n/a', 'n-a', 'null', 'undefined', 'unknown', '-']);

/**
 * Parse a potentially formatted numeric string into a number.
 * Strips commas, whitespace, and trailing units.
 * Returns NaN if not parseable.
 */
function parseNumeric(val) {
  if (val == null) return NaN;
  const s = String(val).trim().replace(/,/g, '').replace(/\s+/g, '');
  // Strip common trailing units (g, ms, dpi, hz, mm, ips, etc.)
  const cleaned = s.replace(/[a-zA-Z%°]+$/, '');
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function isSkipValue(val) {
  if (val == null) return true;
  return SKIP_VALUES.has(String(val).trim().toLowerCase());
}

/**
 * Evaluate a single product value against a variance policy.
 *
 * @param {string|null} policy  - One of: null, 'override_allowed', 'authoritative', 'upper_bound', 'lower_bound', 'range'
 * @param {*} dbValue           - The component DB's canonical value
 * @param {*} productValue      - The product-level value to check
 * @param {object} [options]
 * @param {number} [options.tolerance=0.10] - Fractional tolerance for 'range' policy (default 10%)
 * @returns {{ compliant: boolean, reason?: string, details?: object }}
 */
export function evaluateVariance(policy, dbValue, productValue, options = {}) {
  // No policy or override_allowed → always compliant
  if (!policy || policy === 'override_allowed') {
    return { compliant: true };
  }

  // Skip enforcement when either side is missing/unknown
  if (isSkipValue(dbValue) || isSkipValue(productValue)) {
    return { compliant: true, reason: 'skipped_missing_value' };
  }

  const dbStr = String(dbValue).trim();
  const prodStr = String(productValue).trim();

  switch (policy) {
    case 'authoritative': {
      // Case-insensitive string match, with numeric normalisation
      const dbNum = parseNumeric(dbStr);
      const prodNum = parseNumeric(prodStr);
      if (!Number.isNaN(dbNum) && !Number.isNaN(prodNum)) {
        if (dbNum === prodNum) return { compliant: true };
        return {
          compliant: false,
          reason: 'authoritative_mismatch',
          details: { expected: dbStr, actual: prodStr, expected_numeric: dbNum, actual_numeric: prodNum },
        };
      }
      // String comparison (case-insensitive)
      if (dbStr.toLowerCase() === prodStr.toLowerCase()) return { compliant: true };
      return {
        compliant: false,
        reason: 'authoritative_mismatch',
        details: { expected: dbStr, actual: prodStr },
      };
    }

    case 'upper_bound': {
      const dbNum = parseNumeric(dbStr);
      const prodNum = parseNumeric(prodStr);
      if (Number.isNaN(dbNum) || Number.isNaN(prodNum)) {
        return { compliant: true, reason: 'skipped_non_numeric' };
      }
      if (prodNum <= dbNum) return { compliant: true };
      return {
        compliant: false,
        reason: 'exceeds_upper_bound',
        details: { bound: dbNum, actual: prodNum },
      };
    }

    case 'lower_bound': {
      const dbNum = parseNumeric(dbStr);
      const prodNum = parseNumeric(prodStr);
      if (Number.isNaN(dbNum) || Number.isNaN(prodNum)) {
        return { compliant: true, reason: 'skipped_non_numeric' };
      }
      if (prodNum >= dbNum) return { compliant: true };
      return {
        compliant: false,
        reason: 'below_lower_bound',
        details: { bound: dbNum, actual: prodNum },
      };
    }

    case 'range': {
      const dbNum = parseNumeric(dbStr);
      const prodNum = parseNumeric(prodStr);
      if (Number.isNaN(dbNum) || Number.isNaN(prodNum)) {
        return { compliant: true, reason: 'skipped_non_numeric' };
      }
      const tolerance = options.tolerance ?? 0.10;
      const margin = Math.abs(dbNum) * tolerance;
      const lo = dbNum - margin;
      const hi = dbNum + margin;
      if (prodNum >= lo && prodNum <= hi) return { compliant: true };
      return {
        compliant: false,
        reason: 'outside_range',
        details: { expected: dbNum, actual: prodNum, tolerance, lo, hi },
      };
    }

    default:
      // Unknown policy → skip enforcement
      return { compliant: true, reason: 'unknown_policy' };
  }
}

/**
 * Evaluate a batch of product entries against a variance policy.
 *
 * @param {string|null} policy
 * @param {*} dbValue
 * @param {Array<{ product_id: string, value: * }>} productEntries
 * @param {object} [options]
 * @returns {{ summary: { total: number, compliant: number, violations: number }, results: Array }}
 */
export function evaluateVarianceBatch(policy, dbValue, productEntries, options = {}) {
  const results = [];
  let compliantCount = 0;
  let violationCount = 0;

  for (const entry of productEntries) {
    const result = evaluateVariance(policy, dbValue, entry.value, options);
    results.push({ product_id: entry.product_id, value: entry.value, ...result });
    if (result.compliant) {
      compliantCount++;
    } else {
      violationCount++;
    }
  }

  return {
    summary: { total: productEntries.length, compliant: compliantCount, violations: violationCount },
    results,
  };
}
