// ── Constraint Expression Parser & Evaluator ────────────────────────
//
// Evaluates simple cross-field constraints like:
//   "sensor_year <= release_date"
//   "max_dpi >= dpi"
//   "component_release_date != unk"
//
// Expression format: <left_field> <operator> <right_field_or_literal>
// Operators: <=, >=, <, >, ==, !=
//
// Resolution: field names are resolved against component properties first,
// then product field values. Bare numbers/strings are treated as literals.

const OPERATORS = ['<=', '>=', '!=', '==', '<', '>'];

function parseConstraint(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const trimmed = expr.trim();

  const requiresMatch = trimmed.match(/^(.+?)\s+requires\s+(.+)$/);
  if (requiresMatch) {
    return { left: requiresMatch[1].trim(), op: 'requires', right: requiresMatch[2].trim(), raw: trimmed };
  }

  for (const op of OPERATORS) {
    const idx = trimmed.indexOf(op);
    if (idx > 0) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + op.length).trim();
      if (left && right) {
        return { left, op, right, raw: trimmed };
      }
    }
  }
  return null;
}

function resolveValue(fieldName, componentProps = {}, productValues = {}) {
  // Try literal number (including scientific notation like 1.5e3, -2e-4)
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(fieldName)) {
    return { value: Number(fieldName), source: 'literal' };
  }
  // Try literal string (matching quotes only — 'foo' or "foo", not 'foo")
  if ((fieldName.length >= 2 && fieldName[0] === "'" && fieldName[fieldName.length - 1] === "'") ||
      (fieldName.length >= 2 && fieldName[0] === '"' && fieldName[fieldName.length - 1] === '"')) {
    return { value: fieldName.slice(1, -1), source: 'literal' };
  }
  // Known tokens
  if (fieldName === 'unk' || fieldName === 'unknown' || fieldName === 'null') {
    return { value: fieldName, source: 'literal' };
  }

  const normalized = fieldName.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

  // Check component properties first
  if (componentProps && typeof componentProps === 'object') {
    if (componentProps[fieldName] !== undefined) {
      return { value: componentProps[fieldName], source: 'component' };
    }
    if (componentProps[normalized] !== undefined) {
      return { value: componentProps[normalized], source: 'component' };
    }
  }

  // Check product values
  if (productValues && typeof productValues === 'object') {
    if (productValues[fieldName] !== undefined) {
      return { value: productValues[fieldName], source: 'product' };
    }
    if (productValues[normalized] !== undefined) {
      return { value: productValues[normalized], source: 'product' };
    }
  }

  return { value: undefined, source: 'unresolved' };
}

function coerceNumeric(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Empty string is not numeric
    if (trimmed === '') return null;
    // Extract timestamp from date strings like "2024-01-15"
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed)) {
      const d = new Date(trimmed.replace(/\//g, '-'));
      if (!isNaN(d.getTime())) return d.getTime();
      return null; // Invalid date like "2024-13-45"
    }
    // Bare year like "2024"
    if (/^\d{4}$/.test(trimmed)) {
      return Number(trimmed);
    }
    // General numeric
    const n = Number(trimmed);
    if (!isNaN(n)) return n;
  }
  return null;
}

function compare(leftVal, op, rightVal) {
  // Try numeric comparison first
  const leftNum = coerceNumeric(leftVal);
  const rightNum = coerceNumeric(rightVal);

  if (leftNum !== null && rightNum !== null) {
    switch (op) {
      case '<=': return leftNum <= rightNum;
      case '>=': return leftNum >= rightNum;
      case '<':  return leftNum < rightNum;
      case '>':  return leftNum > rightNum;
      case '==': return leftNum === rightNum;
      case '!=': return leftNum !== rightNum;
    }
  }

  // Fall back to string comparison
  const leftStr = String(leftVal || '').toLowerCase().trim();
  const rightStr = String(rightVal || '').toLowerCase().trim();

  switch (op) {
    case '<=': return leftStr <= rightStr;
    case '>=': return leftStr >= rightStr;
    case '<':  return leftStr < rightStr;
    case '>':  return leftStr > rightStr;
    case '==': return leftStr === rightStr;
    case '!=': return leftStr !== rightStr;
  }

  return false; // Unknown operator = fail (should never reach here with valid OPERATORS)
}

/**
 * Evaluate a single constraint expression.
 *
 * @param {string} expr - e.g. "sensor_year <= release_date"
 * @param {Object} componentProps - Component entity properties { sensor_year: 2023, max_dpi: 26000 }
 * @param {Object} productValues - Product field values { release_date: "2024", dpi: "26000" }
 * @returns {{ pass: boolean, message: string, parsed: Object|null, leftVal: *, rightVal: * }}
 */
function evaluateConstraint(expr, componentProps = {}, productValues = {}) {
  const parsed = parseConstraint(expr);
  if (!parsed) {
    return { pass: true, message: `Could not parse constraint: "${expr}"`, parsed: null, leftVal: undefined, rightVal: undefined };
  }

  const leftResolved = resolveValue(parsed.left, componentProps, productValues);
  const rightResolved = resolveValue(parsed.right, componentProps, productValues);

  const unkTokens = new Set(['unk', 'unknown', 'n/a', '']);
  const leftIsUnk = leftResolved.source === 'unresolved' || unkTokens.has(String(leftResolved.value).toLowerCase().trim());
  const rightIsUnk = rightResolved.source === 'unresolved' || unkTokens.has(String(rightResolved.value).toLowerCase().trim());

  if (parsed.op === 'requires') {
    if (leftIsUnk) {
      return {
        pass: true,
        message: `Constraint "${expr}" skipped: ${parsed.left} is unknown/unresolved`,
        parsed,
        leftVal: leftResolved.value,
        rightVal: rightResolved.value,
        skipped: true,
      };
    }
    if (rightIsUnk) {
      return {
        pass: false,
        message: `Constraint VIOLATION: ${parsed.left}(${leftResolved.value}) requires ${parsed.right} — dependency missing`,
        parsed,
        leftVal: leftResolved.value,
        rightVal: rightResolved.value,
        dependencyMissing: true,
      };
    }
    return {
      pass: true,
      message: `Constraint OK: ${parsed.left}(${leftResolved.value}) requires ${parsed.right}(${rightResolved.value})`,
      parsed,
      leftVal: leftResolved.value,
      rightVal: rightResolved.value,
    };
  }

  // If either side is unresolved, skip (don't flag — missing data is handled elsewhere)
  if (leftResolved.source === 'unresolved' || rightResolved.source === 'unresolved') {
    return {
      pass: true,
      message: `Constraint "${expr}" skipped: ${leftResolved.source === 'unresolved' ? parsed.left : parsed.right} not found`,
      parsed,
      leftVal: leftResolved.value,
      rightVal: rightResolved.value,
      skipped: true,
    };
  }

  // Check for unknown tokens — skip constraint if either value is unknown
  if (leftIsUnk || rightIsUnk) {
    return {
      pass: true,
      message: `Constraint "${expr}" skipped: value is unknown`,
      parsed,
      leftVal: leftResolved.value,
      rightVal: rightResolved.value,
      skipped: true,
    };
  }

  const result = compare(leftResolved.value, parsed.op, rightResolved.value);

  return {
    pass: result,
    message: result
      ? `Constraint OK: ${parsed.left}(${leftResolved.value}) ${parsed.op} ${parsed.right}(${rightResolved.value})`
      : `Constraint VIOLATION: ${parsed.left}(${leftResolved.value}) ${parsed.op} ${parsed.right}(${rightResolved.value}) — failed`,
    parsed,
    leftVal: leftResolved.value,
    rightVal: rightResolved.value,
  };
}

/**
 * Evaluate all constraints for a set of property mappings against a component entity.
 *
 * @param {Array} propertyMappings - From compiled component source [{key, field_key, constraints, ...}]
 * @param {Object} componentProps - The component entity's properties { sensor_year: 2023 }
 * @param {Object} productValues - The product's known field values { release_date: "2024" }
 * @returns {Array<{ expr: string, propertyKey: string, pass: boolean, message: string }>}
 */
function evaluateAllConstraints(propertyMappings = [], componentProps = {}, productValues = {}) {
  const results = [];
  for (const mapping of propertyMappings) {
    const constraints = Array.isArray(mapping.constraints) ? mapping.constraints : [];
    const propertyKey = mapping.field_key || mapping.key || '';
    for (const expr of constraints) {
      if (!expr || typeof expr !== 'string') continue;
      const result = evaluateConstraint(expr, componentProps, productValues);
      results.push({
        expr,
        propertyKey,
        ...result,
      });
    }
  }
  return results;
}

export { parseConstraint, evaluateConstraint, evaluateAllConstraints, resolveValue };
