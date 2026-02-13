import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortDeep(value[key]);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(sortDeep(value), null, 2);
}

function stripVolatileKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripVolatileKeys(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === 'generated_at'
      || key === 'compiled_at'
      || key === 'created_at'
      || key === 'version_id'
    ) {
      continue;
    }
    out[key] = stripVolatileKeys(nested);
  }
  return out;
}

async function readFileOrThrow(filePath, label) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label}_not_found:${filePath}`);
    }
    throw error;
  }
}

function safeParse(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

function summarizeDiff(goldenJson, generatedJson) {
  if (!isObject(goldenJson) || !isObject(generatedJson)) {
    return {
      parseable_json: false
    };
  }
  const goldenTop = Object.keys(goldenJson).sort();
  const generatedTop = Object.keys(generatedJson).sort();
  const goldenFields = isObject(goldenJson.fields) ? Object.keys(goldenJson.fields).sort() : [];
  const generatedFields = isObject(generatedJson.fields) ? Object.keys(generatedJson.fields).sort() : [];
  const goldenFieldSet = new Set(goldenFields);
  const generatedFieldSet = new Set(generatedFields);
  const missingFields = goldenFields.filter((field) => !generatedFieldSet.has(field));
  const extraFields = generatedFields.filter((field) => !goldenFieldSet.has(field));
  return {
    parseable_json: true,
    top_level_keys_golden: goldenTop,
    top_level_keys_generated: generatedTop,
    field_count_golden: goldenFields.length,
    field_count_generated: generatedFields.length,
    missing_fields: missingFields.slice(0, 25),
    extra_fields: extraFields.slice(0, 25),
    missing_fields_count: missingFields.length,
    extra_fields_count: extraFields.length,
    semantic_equal: stableStringify(stripVolatileKeys(goldenJson)) === stableStringify(stripVolatileKeys(generatedJson))
  };
}

export async function verifyGeneratedFieldRules({
  category,
  config = {},
  fixturePath = '',
  strictBytes = false
}) {
  const normalizedCategory = String(category || '').trim();
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const generatedPath = path.join(helperRoot, normalizedCategory, '_generated', 'field_rules.json');
  const resolvedFixturePath = String(fixturePath || '').trim()
    ? path.resolve(fixturePath)
    : path.resolve('test', 'fixtures', normalizedCategory, 'field_rules.golden.json');

  const [generatedBuffer, fixtureBuffer] = await Promise.all([
    readFileOrThrow(generatedPath, 'generated_field_rules'),
    readFileOrThrow(resolvedFixturePath, 'golden_fixture')
  ]);

  const generatedSha = sha256(generatedBuffer);
  const fixtureSha = sha256(fixtureBuffer);
  const byteEqual = generatedSha === fixtureSha;
  const fixtureJson = safeParse(fixtureBuffer);
  const generatedJson = safeParse(generatedBuffer);
  const parseable = isObject(fixtureJson) && isObject(generatedJson);
  const semanticEqual = parseable
    ? stableStringify(stripVolatileKeys(fixtureJson)) === stableStringify(stripVolatileKeys(generatedJson))
    : null;
  const verified = strictBytes
    ? byteEqual
    : (parseable ? semanticEqual : byteEqual);
  const diff = verified
    ? null
    : summarizeDiff(fixtureJson, generatedJson);

  return {
    category: normalizedCategory,
    verified,
    verify_mode: strictBytes ? 'bytes' : (parseable ? 'semantic' : 'bytes'),
    byte_equal: byteEqual,
    semantic_equal: semanticEqual,
    generated_path: generatedPath,
    fixture_path: resolvedFixturePath,
    generated_sha256: generatedSha,
    fixture_sha256: fixtureSha,
    bytes_generated: generatedBuffer.length,
    bytes_fixture: fixtureBuffer.length,
    diff
  };
}
