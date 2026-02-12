import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCompiledHelperContract } from '../helperFiles/compiledContract.js';
import {
  buildFieldOrderFromExcelSeed,
  extractExcelSeedData,
  loadCategoryFieldRules
} from './excelSeed.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRequiredField(value) {
  const token = String(value || '').trim();
  if (!token) {
    return '';
  }
  const lowered = token.toLowerCase();
  if (lowered.startsWith('identity.') || lowered.startsWith('fields.')) {
    return lowered;
  }
  return `fields.${normalizeField(token)}`;
}

function normalizeContractTypeFromFieldRule(rule = {}) {
  const shape = String(rule.shape || '').trim().toLowerCase();
  const type = String(rule.type || '').trim().toLowerCase();
  if (shape === 'list') {
    return 'list';
  }
  if (type === 'number') {
    return 'number';
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'date') {
    return 'date';
  }
  if (type === 'list') {
    return 'list';
  }
  return 'string';
}

function normalizeEnumValue(value) {
  return String(value || '').trim().toLowerCase();
}

function buildFieldContractOverridesFromFieldRules(fieldRules = {}) {
  const fields = isObject(fieldRules.fields) ? fieldRules.fields : {};
  const overrides = {};
  for (const [rawField, rawRule] of Object.entries(fields)) {
    const field = normalizeField(rawField);
    if (!field || !isObject(rawRule)) {
      continue;
    }
    const type = normalizeContractTypeFromFieldRule(rawRule);
    const override = {
      type
    };

    const unit = String(rawRule.unit || '').trim();
    if (unit) {
      override.unit = unit;
    }

    const validate = isObject(rawRule.validate) ? rawRule.validate : {};
    if (String(validate.kind || '').trim().toLowerCase() === 'number_range') {
      const min = Number.parseFloat(String(validate.min));
      const max = Number.parseFloat(String(validate.max));
      if (Number.isFinite(min) || Number.isFinite(max)) {
        override.range = {
          ...(Number.isFinite(min) ? { min } : {}),
          ...(Number.isFinite(max) ? { max } : {})
        };
      }
    }

    const vocab = isObject(rawRule.vocab) ? rawRule.vocab : {};
    const knownValues = [...new Set(
      toArray(vocab.known_values)
        .map((value) => normalizeEnumValue(value))
        .filter(Boolean)
    )];
    const vocabMode = String(vocab.mode || '').trim().toLowerCase();
    const shouldSetEnum = knownValues.length > 0 && (vocabMode === 'closed' || knownValues.length <= 60);
    if (shouldSetEnum) {
      override.enum = knownValues.sort((a, b) => a.localeCompare(b));
    }

    const synonyms = isObject(rawRule.synonyms) ? rawRule.synonyms : {};
    const aliases = {};
    for (const [aliasRaw, canonicalRaw] of Object.entries(synonyms)) {
      const alias = normalizeEnumValue(aliasRaw);
      const canonical = normalizeEnumValue(canonicalRaw);
      if (!alias || !canonical) {
        continue;
      }
      if (Array.isArray(override.enum) && override.enum.length > 0 && !override.enum.includes(canonical)) {
        continue;
      }
      aliases[alias] = canonical;
    }
    if (Object.keys(aliases).length > 0) {
      override.aliases = aliases;
    }

    overrides[field] = override;
  }
  return overrides;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

async function readJsonOrNull(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function helperCategoryDir({ category, config = {} }) {
  return path.resolve(config.helperFilesRoot || 'helper_files', category);
}

function runtimeCategoryDir(category) {
  return path.resolve('categories', category);
}

function schemaPathCandidates({ category, config = {} }) {
  return [
    path.join(helperCategoryDir({ category, config }), 'schema.json'),
    path.join(runtimeCategoryDir(category), 'schema.json')
  ];
}

async function readFirstExistingJson(paths = []) {
  for (const filePath of paths) {
    const loaded = await readJsonOrNull(filePath);
    if (loaded !== null) {
      return {
        file_path: filePath,
        value: loaded
      };
    }
  }
  return null;
}

export async function syncCategorySchemaFromExcel({
  category,
  config = {}
}) {
  const fieldRulesLoaded = await loadCategoryFieldRules(category, config);
  if (!fieldRulesLoaded || !isObject(fieldRulesLoaded.value)) {
    return {
      category,
      synced: false,
      reason: 'field_rules_missing'
    };
  }
  const fieldRules = fieldRulesLoaded.value;
  const extracted = await extractExcelSeedData({
    category,
    config,
    fieldRules,
    fieldOrder: []
  });
  if (!extracted.enabled) {
    return {
      category,
      synced: false,
      reason: extracted.error || 'excel_extract_failed',
      workbook_path: extracted.workbook_path || null
    };
  }

  const helperDir = helperCategoryDir({ category, config });
  const runtimeDir = runtimeCategoryDir(category);
  const helperSchemaPath = path.join(helperDir, 'schema.json');
  const helperRequiredPath = path.join(helperDir, 'required_fields.json');
  const runtimeSchemaPath = path.join(runtimeDir, 'schema.json');
  const runtimeRequiredPath = path.join(runtimeDir, 'required_fields.json');
  const mirrorRuntimeFiles = Boolean(config.categoryMirrorRuntimeFiles);
  const sourceSchema = await readFirstExistingJson(schemaPathCandidates({ category, config }));

  const existingSchema = isObject(sourceSchema?.value) ? sourceSchema.value : {};
  const ruleSchema = isObject(fieldRules.schema) ? fieldRules.schema : {};
  const fieldOrder = buildFieldOrderFromExcelSeed({
    fieldRows: extracted.field_rows,
    fieldRules,
    existingFieldOrder: existingSchema.field_order || []
  });

  const criticalFields = unique(
    toArray(
      ruleSchema.critical_fields ||
      fieldRules.critical_fields ||
      existingSchema.critical_fields ||
      []
    ).map((field) => normalizeField(field))
  ).filter((field) => fieldOrder.includes(field));

  const expectedEasyFields = unique(
    toArray(
      ruleSchema.expected_easy_fields ||
      fieldRules.expected_easy_fields ||
      existingSchema.expected_easy_fields ||
      []
    ).map((field) => normalizeField(field))
  ).filter((field) => fieldOrder.includes(field));

  const expectedSometimesFields = unique(
    toArray(
      ruleSchema.expected_sometimes_fields ||
      fieldRules.expected_sometimes_fields ||
      existingSchema.expected_sometimes_fields ||
      []
    ).map((field) => normalizeField(field))
  ).filter((field) => fieldOrder.includes(field));

  const deepFields = unique(
    toArray(
      ruleSchema.deep_fields ||
      fieldRules.deep_fields ||
      existingSchema.deep_fields ||
      []
    ).map((field) => normalizeField(field))
  ).filter((field) => fieldOrder.includes(field));

  const schema = {
    ...(existingSchema || {}),
    category,
    field_order: fieldOrder,
    critical_fields: criticalFields,
    expected_easy_fields: expectedEasyFields,
    expected_sometimes_fields: expectedSometimesFields,
    deep_fields: deepFields,
    field_contract_overrides: {
      ...buildFieldContractOverridesFromFieldRules(fieldRules),
      ...(isObject(existingSchema.field_contract_overrides) ? existingSchema.field_contract_overrides : {}),
      ...(isObject(fieldRules.field_contract_overrides) ? fieldRules.field_contract_overrides : {})
    },
    targets: isObject(ruleSchema.targets)
      ? ruleSchema.targets
      : (existingSchema.targets || {
        targetCompleteness: 0.9,
        targetConfidence: 0.8
      }),
    editorial_fields: toArray(existingSchema.editorial_fields || [])
  };

  const configuredRequired = unique(
    toArray(
      fieldRules.required_fields ||
      ruleSchema.required_fields ||
      []
    )
      .map((field) => normalizeRequiredField(field))
      .filter((field) => field.startsWith('fields.'))
  );
  const requiredFields = configuredRequired.length
    ? configuredRequired
    : unique(criticalFields.map((field) => `fields.${field}`));
  const shouldWriteRequiredFieldsFile = configuredRequired.length > 0;

  await writeJson(helperSchemaPath, schema);
  if (shouldWriteRequiredFieldsFile) {
    await writeJson(helperRequiredPath, requiredFields);
  } else {
    await fs.rm(helperRequiredPath, { force: true });
  }
  if (mirrorRuntimeFiles) {
    await writeJson(runtimeSchemaPath, schema);
    if (shouldWriteRequiredFieldsFile) {
      await writeJson(runtimeRequiredPath, requiredFields);
    } else {
      await fs.rm(runtimeRequiredPath, { force: true });
    }
  }

  const compiled = await buildCompiledHelperContract({
    category,
    categoryConfig: {
      category,
      schema,
      fieldOrder,
      requiredFields,
      fieldRules: {
        ...(fieldRules || {}),
        __meta: {
          file_path: fieldRulesLoaded.file_path || null
        }
      }
    },
    helperData: {
      category_root: helperDir,
      active: [],
      supportive: [],
      excel_seed: extracted,
      schema_file: helperSchemaPath,
      field_rules_file: fieldRulesLoaded.file_path || null,
      tooltip_hints: {},
      tooltip_source_file: null
    },
    config
  });

  return {
    category,
    synced: true,
    field_rules_path: fieldRulesLoaded.file_path,
    workbook_path: extracted.workbook_path,
    sheet: extracted.sheet,
    field_count: fieldOrder.length,
    product_count: extracted.products.length,
    helper_schema_path: helperSchemaPath,
    helper_required_fields_path: shouldWriteRequiredFieldsFile ? helperRequiredPath : null,
    schema_path: mirrorRuntimeFiles ? runtimeSchemaPath : null,
    required_fields_path: mirrorRuntimeFiles && shouldWriteRequiredFieldsFile ? runtimeRequiredPath : null,
    helper_compiled_contract_path: compiled.helper_file_path,
    helper_compiled_expectations_path: compiled.helper_expectations_file_path,
    compiled_contract_path: compiled.file_path,
    compiled_expectations_path: compiled.expectations_file_path,
    compiled_contract_hash: compiled.contract?.hash || null
  };
}
