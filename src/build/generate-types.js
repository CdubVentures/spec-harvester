import fs from 'node:fs/promises';
import path from 'node:path';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeCategory(value) {
  return normalizeFieldKey(value);
}

function pascalCase(value) {
  return String(value || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

async function readJsonOrThrow(filePath, label) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label}_not_found:${filePath}`);
    }
    throw error;
  }
}

function quoteEnumValue(value) {
  return JSON.stringify(String(value));
}

function uniqueEnumValues(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const token = normalizeText(value);
    if (!token) {
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(token);
  }
  return out;
}

function baseZodForField({
  field,
  rule,
  knownValues
}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const dataType = normalizeText(rule.data_type || contract.type || rule.type || 'string').toLowerCase();
  const shape = normalizeText(rule.output_shape || contract.shape || rule.shape || 'scalar').toLowerCase();

  let base = 'z.string()';
  if (dataType === 'number' || dataType === 'float' || dataType === 'decimal') {
    base = 'z.number()';
  } else if (dataType === 'integer' || dataType === 'int') {
    base = 'z.number().int()';
  } else if (dataType === 'boolean' || dataType === 'bool') {
    base = 'z.boolean()';
  } else if (dataType === 'object' || shape === 'object') {
    base = 'z.record(z.string(), z.any())';
  }

  const enumValues = uniqueEnumValues(toArray(knownValues[field]));
  if (
    base === 'z.string()'
    && enumValues.length >= 2
    && enumValues.length <= 200
  ) {
    base = `z.enum([${enumValues.map((value) => quoteEnumValue(value)).join(', ')}])`;
  }

  const range = isObject(contract.range) ? contract.range : {};
  const min = Number.parseFloat(String(range.min ?? ''));
  const max = Number.parseFloat(String(range.max ?? ''));
  if (base.startsWith('z.number()') || base.startsWith('z.number().int()')) {
    if (Number.isFinite(min)) {
      base = `${base}.min(${min})`;
    }
    if (Number.isFinite(max)) {
      base = `${base}.max(${max})`;
    }
  }

  if (shape === 'list' || shape === 'array') {
    base = `z.array(${base})`;
  }
  return base;
}

function isRequiredField(rule = {}) {
  const requiredLevel = normalizeText(
    rule.required_level ||
    (isObject(rule.priority) ? rule.priority.required_level : '') ||
    'optional'
  ).toLowerCase();
  return requiredLevel === 'required'
    || requiredLevel === 'critical'
    || requiredLevel === 'identity';
}

function buildSchemaCode({
  category,
  fields,
  knownValues
}) {
  const categoryToken = normalizeCategory(category);
  const categoryPascal = pascalCase(categoryToken);
  const orderedFields = Object.keys(fields).sort((a, b) => a.localeCompare(b));
  const fieldKeyConst = `${categoryToken}FieldKeys`;
  const fieldSchemaMap = `${categoryToken}FieldSchemaMap`;
  const mainSchema = `${categoryPascal}SpecSchema`;
  const partialSchema = `${categoryPascal}SpecPartialSchema`;

  const lines = [];
  lines.push("import { z } from 'zod';");
  lines.push('');
  lines.push(`export const ${fieldKeyConst} = [`);
  for (const field of orderedFields) {
    lines.push(`  ${JSON.stringify(field)},`);
  }
  lines.push('] as const;');
  lines.push('');
  lines.push(`export const ${fieldSchemaMap} = {`);
  for (const field of orderedFields) {
    const rule = fields[field];
    const validator = baseZodForField({
      field,
      rule,
      knownValues
    });
    const requiredExpr = isRequiredField(rule) ? validator : `${validator}.optional()`;
    lines.push(`  ${JSON.stringify(field)}: ${requiredExpr},`);
  }
  lines.push('} as const;');
  lines.push('');
  lines.push(`export const ${mainSchema} = z.object(${fieldSchemaMap});`);
  lines.push(`export const ${partialSchema} = ${mainSchema}.partial();`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildTypesCode({
  category
}) {
  const categoryToken = normalizeCategory(category);
  const categoryPascal = pascalCase(categoryToken);
  const fieldKeyConst = `${categoryToken}FieldKeys`;
  const mainSchema = `${categoryPascal}SpecSchema`;
  const partialSchema = `${categoryPascal}SpecPartialSchema`;

  const lines = [];
  lines.push("import { z } from 'zod';");
  lines.push(`import { ${mainSchema}, ${partialSchema}, ${fieldKeyConst} } from './${categoryToken}.schema.js';`);
  lines.push('');
  lines.push(`export type ${categoryPascal}Spec = z.infer<typeof ${mainSchema}>;`);
  lines.push(`export type ${categoryPascal}SpecPartial = z.infer<typeof ${partialSchema}>;`);
  lines.push(`export type ${categoryPascal}FieldKey = (typeof ${fieldKeyConst})[number];`);
  lines.push('');
  lines.push(`export type ${categoryPascal}FieldValue = ${categoryPascal}Spec[${categoryPascal}FieldKey];`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export async function generateTypesForCategory({
  category,
  config = {},
  outDir = ''
}) {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const generatedRoot = path.join(helperRoot, normalizedCategory, '_generated');
  const fieldRulesPath = path.join(generatedRoot, 'field_rules.json');
  const knownValuesPath = path.join(generatedRoot, 'known_values.json');
  const fieldRules = await readJsonOrThrow(fieldRulesPath, 'field_rules');
  const knownValues = await readJsonOrThrow(knownValuesPath, 'known_values');
  const fields = {};
  for (const [rawField, rawRule] of Object.entries(isObject(fieldRules.fields) ? fieldRules.fields : {})) {
    const field = normalizeFieldKey(rawField);
    if (!field || !isObject(rawRule)) {
      continue;
    }
    fields[field] = rawRule;
  }
  const knownValuesByField = isObject(knownValues.fields) ? knownValues.fields : {};

  const targetDir = path.resolve(outDir || path.join('src', 'generated'));
  await fs.mkdir(targetDir, { recursive: true });
  const schemaFile = path.join(targetDir, `${normalizedCategory}.schema.ts`);
  const typesFile = path.join(targetDir, `${normalizedCategory}.types.ts`);
  const schemaCode = buildSchemaCode({
    category: normalizedCategory,
    fields,
    knownValues: knownValuesByField
  });
  const typesCode = buildTypesCode({
    category: normalizedCategory
  });

  await fs.writeFile(schemaFile, schemaCode, 'utf8');
  await fs.writeFile(typesFile, typesCode, 'utf8');

  return {
    generated: true,
    category: normalizedCategory,
    generated_root: targetDir,
    schema_file: schemaFile,
    types_file: typesFile,
    field_count: Object.keys(fields).length
  };
}
