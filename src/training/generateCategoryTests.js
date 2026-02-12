import fs from 'node:fs/promises';
import path from 'node:path';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function esc(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function buildSchemaTestContent({ category, contract, expectations }) {
  const fieldOrder = toArray(contract?.fields).map((row) => row?.key).filter(Boolean);
  const required = toArray(expectations?.required_fields);
  const expectedEasy = toArray(expectations?.expected_easy_fields);
  const expectedSometimes = toArray(expectations?.expected_sometimes_fields);
  const deep = toArray(expectations?.deep_fields);
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    `const FIELD_ORDER = ${JSON.stringify(fieldOrder, null, 2)};`,
    `const REQUIRED_FIELDS = ${JSON.stringify(required, null, 2)};`,
    `const EXPECTED_EASY_FIELDS = ${JSON.stringify(expectedEasy, null, 2)};`,
    `const EXPECTED_SOMETIMES_FIELDS = ${JSON.stringify(expectedSometimes, null, 2)};`,
    `const DEEP_FIELDS = ${JSON.stringify(deep, null, 2)};`,
    '',
    `test('${esc(category)} expectations map only known schema fields', () => {`,
    '  const known = new Set(FIELD_ORDER);',
    '  for (const field of [...REQUIRED_FIELDS, ...EXPECTED_EASY_FIELDS, ...EXPECTED_SOMETIMES_FIELDS, ...DEEP_FIELDS]) {',
    '    assert.equal(known.has(field), true, `Unknown field in expectations: ${field}`);',
    '  }',
    '});',
    '',
    `test('${esc(category)} required fields are tracked as expected-easy', () => {`,
    '  const easy = new Set(EXPECTED_EASY_FIELDS);',
    '  for (const field of REQUIRED_FIELDS) {',
    '    assert.equal(easy.has(field), true, `Required field missing from expected_easy_fields: ${field}`);',
    '  }',
    '});',
    '',
    `test('${esc(category)} expectation buckets do not overlap unexpectedly', () => {`,
    '  const easy = new Set(EXPECTED_EASY_FIELDS);',
    '  const sometimes = new Set(EXPECTED_SOMETIMES_FIELDS);',
    '  const deep = new Set(DEEP_FIELDS);',
    '  for (const field of easy) {',
    '    assert.equal(deep.has(field), false, `Field appears in expected_easy and deep: ${field}`);',
    '  }',
    '  for (const field of sometimes) {',
    '    assert.equal(deep.has(field), false, `Field appears in expected_sometimes and deep: ${field}`);',
    '  }',
    '});',
    ''
  ].join('\n');
}

function buildNormalizationTestContent({ category, contract }) {
  const constraints = contract?.constraints?.fields || {};
  const preferredFields = new Set(['connection', 'connectivity']);
  const candidateFields = [];
  for (const [field, rule] of Object.entries(constraints)) {
    if (!preferredFields.has(field)) {
      continue;
    }
    candidateFields.push([field, rule]);
  }
  if (!candidateFields.length) {
    for (const [field, rule] of Object.entries(constraints)) {
      if (String(rule?.type || '') !== 'string') {
        continue;
      }
      if (!Array.isArray(rule?.enum) || rule.enum.length === 0 || rule.enum.length > 30) {
        continue;
      }
      candidateFields.push([field, rule]);
      if (candidateFields.length >= 2) {
        break;
      }
    }
  }

  const aliasCases = [];
  for (const [field, rule] of candidateFields) {
    const aliases = rule?.aliases && typeof rule.aliases === 'object' ? rule.aliases : {};
    const entries = Object.entries(aliases);
    if (!entries.length) {
      continue;
    }
    for (const [alias, canonical] of entries.slice(0, 4)) {
      aliasCases.push({
        field,
        alias,
        canonical
      });
    }
  }
  const fallbackCases = aliasCases.length ? aliasCases : [{
    field: 'connection',
    alias: '2.4 GHz + wired',
    canonical: 'hybrid'
  }];
  const fieldOrder = uniqueSorted(fallbackCases.map((row) => row.field));
  const constraintSubset = {
    fields: Object.fromEntries(
      fieldOrder
        .map((field) => [field, constraints[field]])
        .filter(([, value]) => value && typeof value === 'object')
    )
  };
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { runDeterministicCritic } from '../../src/validator/critic.js';",
    '',
    `const ALIAS_CASES = ${JSON.stringify(fallbackCases, null, 2)};`,
    `const FIELD_ORDER = ${JSON.stringify(fieldOrder, null, 2)};`,
    `const CONSTRAINTS = ${JSON.stringify(constraintSubset, null, 2)};`,
    '',
    `test('${esc(category)} enum alias normalization via deterministic critic', () => {`,
    '  for (const row of ALIAS_CASES) {',
    "    const normalized = { fields: { [row.field]: row.alias } };",
    '    const provenance = {};',
    '    const decisions = runDeterministicCritic({',
    '      normalized,',
    '      provenance,',
    '      fieldReasoning: {},',
      `      categoryConfig: { fieldOrder: FIELD_ORDER },`,
    '      constraints: CONSTRAINTS',
    '    });',
    '    const rejected = (decisions.reject || []).find((entry) => entry.field === row.field);',
    '    assert.equal(Boolean(rejected), false, `Alias was rejected for field ${row.field}`);',
    '    assert.equal(String(normalized.fields[row.field]), String(row.canonical));',
    '  }',
    '});',
    ''
  ].join('\n');
}

function buildComponentTestContent({ category, contract }) {
  const aliasMap = contract?.components?.alias_map && typeof contract.components.alias_map === 'object'
    ? contract.components.alias_map
    : {};
  const componentRows = Object.entries(aliasMap).map(([name, values]) => ({
    name,
    values: uniqueSorted(toArray(values))
  }));
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    `const COMPONENTS = ${JSON.stringify(componentRows, null, 2)};`,
    '',
    `test('${esc(category)} component alias map is deterministic and deduped', () => {`,
    '  for (const row of COMPONENTS) {',
    '    const deduped = [...new Set(row.values)];',
    '    assert.deepEqual(row.values, deduped, `Component aliases are not deduped for ${row.name}`);',
    '  }',
    '});',
    ''
  ].join('\n');
}

export async function writeGeneratedCategoryTests({
  category,
  contract,
  expectations
}) {
  const dir = path.resolve('test', 'category');
  await fs.mkdir(dir, { recursive: true });

  const schemaPath = path.join(dir, `${category}.schema.test.js`);
  const normalizationPath = path.join(dir, `${category}.normalization.test.js`);
  const componentPath = path.join(dir, `${category}.component.test.js`);

  await fs.writeFile(
    schemaPath,
    `${buildSchemaTestContent({ category, contract, expectations })}\n`,
    'utf8'
  );
  await fs.writeFile(
    normalizationPath,
    `${buildNormalizationTestContent({ category, contract })}\n`,
    'utf8'
  );
  await fs.writeFile(
    componentPath,
    `${buildComponentTestContent({ category, contract })}\n`,
    'utf8'
  );

  return {
    schema_test: schemaPath,
    normalization_test: normalizationPath,
    component_test: componentPath
  };
}
