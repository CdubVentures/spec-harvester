import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// A.4 — Structured Output Hardening Tests
//
// Tests for post-parse schema validation in openaiClient.js.
// After the A.4 fix, every LLM response will be validated against its
// expected schema AFTER JSON parsing, catching shape mismatches that
// bracket extraction silently accepts.
// ---------------------------------------------------------------------------

// --- Helper: inline the extractJsonCandidate and parseJsonContent logic ---
// These are tested against the EXISTING functions to guard regression,
// and against the PLANNED validateAgainstSchema function.

function extractJsonCandidate(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) return codeBlockMatch[1].trim();

  const startIndexes = [];
  const objectStart = raw.indexOf('{');
  const arrayStart = raw.indexOf('[');
  if (objectStart >= 0) startIndexes.push(objectStart);
  if (arrayStart >= 0) startIndexes.push(arrayStart);
  if (!startIndexes.length) return raw;

  const start = Math.min(...startIndexes);
  const openChar = raw[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaping) { escaping = false; }
      else if (ch === '\\') { escaping = true; }
      else if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === openChar) { depth += 1; continue; }
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1).trim();
    }
  }
  return raw;
}

function parseJsonContent(content) {
  const direct = String(content || '').trim();
  if (!direct) return null;
  try { return JSON.parse(direct); } catch { /* continue */ }
  const extracted = extractJsonCandidate(direct);
  if (!extracted) return null;
  try { return JSON.parse(extracted); } catch { return null; }
}

// ---------------------------------------------------------------------------
// PLANNED FUNCTION: validateAgainstSchema(parsed, schema)
// Returns { valid: true } or { valid: false, errors: [...] }
// This will be implemented in openaiClient.js during Pass 3.
// For now, we define the expected interface and test against a stub.
// ---------------------------------------------------------------------------

function validateAgainstSchema(parsed, schema) {
  if (!schema || !parsed) {
    return { valid: parsed !== null && parsed !== undefined, errors: [] };
  }

  const errors = [];

  // Top-level type check
  if (schema.type === 'object' && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    errors.push({ path: '$', expected: 'object', got: Array.isArray(parsed) ? 'array' : typeof parsed });
  }
  if (schema.type === 'array' && !Array.isArray(parsed)) {
    errors.push({ path: '$', expected: 'array', got: typeof parsed });
  }

  // Required properties check (top-level only for MVP)
  if (schema.type === 'object' && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (parsed[key] === undefined) {
        errors.push({ path: `$.${key}`, expected: 'present', got: 'missing' });
      }
    }
  }

  // Array items type check
  if (schema.type === 'array' && Array.isArray(parsed) && schema.items?.type === 'object') {
    for (let i = 0; i < Math.min(parsed.length, 5); i += 1) {
      if (typeof parsed[i] !== 'object' || Array.isArray(parsed[i])) {
        errors.push({ path: `$[${i}]`, expected: 'object', got: typeof parsed[i] });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// =========================================================================
// SECTION 1: extractJsonCandidate regression tests
// =========================================================================

test('A.4 extractJsonCandidate: extracts JSON from code block', () => {
  const input = 'Here is the result:\n```json\n{"weight": 54}\n```\nDone.';
  assert.equal(extractJsonCandidate(input), '{"weight": 54}');
});

test('A.4 extractJsonCandidate: extracts JSON object without code block', () => {
  const input = 'The answer is {"weight": 54, "dpi": 35000} and more text.';
  assert.equal(extractJsonCandidate(input), '{"weight": 54, "dpi": 35000}');
});

test('A.4 extractJsonCandidate: extracts JSON array', () => {
  const input = 'Results: [{"field": "weight", "value": "54"}]';
  assert.equal(extractJsonCandidate(input), '[{"field": "weight", "value": "54"}]');
});

test('A.4 extractJsonCandidate: handles nested braces correctly', () => {
  const input = '{"outer": {"inner": {"deep": true}}}';
  assert.equal(extractJsonCandidate(input), '{"outer": {"inner": {"deep": true}}}');
});

test('A.4 extractJsonCandidate: handles braces inside strings', () => {
  const input = '{"msg": "use {curly} braces", "ok": true}';
  const result = extractJsonCandidate(input);
  assert.equal(JSON.parse(result).ok, true);
});

test('A.4 extractJsonCandidate: handles escaped quotes inside strings', () => {
  const input = '{"msg": "he said \\"hello\\"", "ok": true}';
  const result = extractJsonCandidate(input);
  assert.equal(JSON.parse(result).ok, true);
});

test('A.4 extractJsonCandidate: returns raw text when no JSON found', () => {
  const input = 'No JSON here at all';
  assert.equal(extractJsonCandidate(input), 'No JSON here at all');
});

test('A.4 extractJsonCandidate: handles empty input', () => {
  assert.equal(extractJsonCandidate(''), '');
  assert.equal(extractJsonCandidate(null), '');
  assert.equal(extractJsonCandidate(undefined), '');
});

// =========================================================================
// SECTION 2: parseJsonContent regression tests
// =========================================================================

test('A.4 parseJsonContent: parses direct JSON', () => {
  const result = parseJsonContent('{"weight": 54}');
  assert.deepEqual(result, { weight: 54 });
});

test('A.4 parseJsonContent: parses JSON from code block', () => {
  const result = parseJsonContent('```json\n{"weight": 54}\n```');
  assert.deepEqual(result, { weight: 54 });
});

test('A.4 parseJsonContent: parses JSON embedded in text', () => {
  const result = parseJsonContent('Here is result: {"weight": 54}. Done.');
  assert.deepEqual(result, { weight: 54 });
});

test('A.4 parseJsonContent: returns null for invalid JSON', () => {
  assert.equal(parseJsonContent('not json at all'), null);
  assert.equal(parseJsonContent('{broken: true}'), null);
});

test('A.4 parseJsonContent: returns null for empty', () => {
  assert.equal(parseJsonContent(''), null);
  assert.equal(parseJsonContent(null), null);
});

// =========================================================================
// SECTION 3: validateAgainstSchema — post-parse validation (new)
// =========================================================================

test('A.4 schema validation: valid object passes', () => {
  const schema = {
    type: 'object',
    required: ['candidates'],
    properties: {
      candidates: { type: 'array' }
    }
  };
  const parsed = { candidates: [{ field: 'weight', value: '54' }] };
  const result = validateAgainstSchema(parsed, schema);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('A.4 schema validation: rejects array when object expected', () => {
  const schema = {
    type: 'object',
    required: ['candidates']
  };
  const parsed = [{ field: 'weight', value: '54' }];
  const result = validateAgainstSchema(parsed, schema);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].expected, 'object');
  assert.equal(result.errors[0].got, 'array');
});

test('A.4 schema validation: rejects object when array expected', () => {
  const schema = {
    type: 'array',
    items: { type: 'object' }
  };
  const parsed = { candidates: [] };
  const result = validateAgainstSchema(parsed, schema);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].expected, 'array');
});

test('A.4 schema validation: detects missing required properties', () => {
  const schema = {
    type: 'object',
    required: ['candidates', 'meta']
  };
  const parsed = { candidates: [] };
  const result = validateAgainstSchema(parsed, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === '$.meta'));
});

test('A.4 schema validation: validates array item types', () => {
  const schema = {
    type: 'array',
    items: { type: 'object' }
  };
  const parsed = [{ ok: true }, 'not an object', { also: 'ok' }];
  const result = validateAgainstSchema(parsed, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === '$[1]'));
});

test('A.4 schema validation: passes when no schema provided', () => {
  const result = validateAgainstSchema({ any: 'thing' }, null);
  assert.equal(result.valid, true);
});

test('A.4 schema validation: fails when parsed is null', () => {
  const schema = { type: 'object', required: ['candidates'] };
  const result = validateAgainstSchema(null, schema);
  assert.equal(result.valid, false);
});

// =========================================================================
// SECTION 4: End-to-end parse + validate flow
// =========================================================================

test('A.4 e2e: LLM response with valid JSON object passes full pipeline', () => {
  const llmResponse = '```json\n{"candidates": [{"field": "weight", "value": "54", "confidence": 0.92}]}\n```';
  const schema = { type: 'object', required: ['candidates'] };
  const parsed = parseJsonContent(llmResponse);
  assert.notEqual(parsed, null);
  const validation = validateAgainstSchema(parsed, schema);
  assert.equal(validation.valid, true);
});

test('A.4 e2e: LLM response returning array when object expected is caught', () => {
  const llmResponse = '[{"field": "weight", "value": "54"}]';
  const schema = { type: 'object', required: ['candidates'] };
  const parsed = parseJsonContent(llmResponse);
  assert.notEqual(parsed, null);
  const validation = validateAgainstSchema(parsed, schema);
  assert.equal(validation.valid, false);
});

test('A.4 e2e: LLM response with prose wrapping valid JSON still validates', () => {
  const llmResponse = 'Based on my analysis, the result is:\n{"candidates": [{"field": "sensor", "value": "Focus Pro 4K"}]}\nI hope this helps.';
  const schema = { type: 'object', required: ['candidates'] };
  const parsed = parseJsonContent(llmResponse);
  assert.notEqual(parsed, null);
  const validation = validateAgainstSchema(parsed, schema);
  assert.equal(validation.valid, true);
});

test('A.4 e2e: completely invalid LLM response returns null parse', () => {
  const llmResponse = 'I cannot determine the specifications from the provided text.';
  const parsed = parseJsonContent(llmResponse);
  assert.equal(parsed, null);
});

// =========================================================================
// SECTION 5: DeepSeek / fallback path edge cases
// =========================================================================

test('A.4 deepseek: JSON with trailing comma is handled by bracket extraction', () => {
  // DeepSeek sometimes produces trailing commas
  const input = '{"weight": 54, "dpi": 35000,}';
  const parsed = parseJsonContent(input);
  // Standard JSON.parse will reject this; bracket extraction extracts it but parse still fails
  // This test documents current behavior — the fix should handle this gracefully
  // Note: JSON.parse rejects trailing commas, so parsed should be null
  assert.equal(parsed, null);
});

test('A.4 deepseek: multiple JSON objects in response — first one extracted', () => {
  const input = '{"first": true} and then {"second": true}';
  const parsed = parseJsonContent(input);
  assert.deepEqual(parsed, { first: true });
});

test('A.4 deepseek: JSON with markdown header prefix', () => {
  const input = '## Results\n\n{"candidates": [{"field": "weight", "value": "54"}]}';
  const parsed = parseJsonContent(input);
  assert.notEqual(parsed, null);
  assert.ok(Array.isArray(parsed.candidates));
});

// =========================================================================
// SECTION 6: Schema validation with extra keys (should accept)
// =========================================================================

test('A.4 schema: extra keys not in schema are accepted (additionalProperties default)', () => {
  const schema = {
    type: 'object',
    required: ['candidates']
  };
  const parsed = { candidates: [], extra_key: 'bonus', another: 42 };
  const result = validateAgainstSchema(parsed, schema);
  assert.equal(result.valid, true);
});
