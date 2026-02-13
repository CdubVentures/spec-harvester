import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { compileCategoryWorkbook, saveWorkbookMap } from '../ingest/categoryCompile.js';

const REQUIRED_ARTIFACTS = [
  'field_rules.json',
  'ui_field_catalog.json',
  'known_values.json',
  'parse_templates.json',
  'cross_validation_rules.json',
  'field_groups.json',
  'key_migrations.json'
];

const SHARED_SCHEMA_FILES = {
  'field_rules.json': 'base_field_schema.json',
  'ui_field_catalog.json': 'ui_field_catalog_schema.json',
  'known_values.json': 'known_values_schema.json',
  'parse_templates.json': 'parse_templates_schema.json',
  'cross_validation_rules.json': 'cross_validation_rules_schema.json',
  'field_groups.json': 'field_groups_schema.json',
  'key_migrations.json': 'key_migrations_schema.json',
  component_db: 'base_component_schema.json'
};

const TEMPLATE_PRESETS = {
  electronics: {
    common_identity: ['brand', 'model', 'variant', 'base_model', 'sku', 'mpn', 'gtin', 'category'],
    common_physical: ['weight', 'length', 'width', 'height', 'material', 'color'],
    common_connectivity: ['connection', 'wireless_technology', 'cable_type', 'cable_length'],
    common_editorial: ['overall_score', 'pros', 'cons', 'verdict', 'key_takeaway'],
    common_commerce: ['price_range', 'affiliate_links', 'images'],
    common_media: ['youtube_url', 'feature_image', 'gallery_images']
  }
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(' ');
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

async function writeJsonStable(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${stableStringify(payload)}\n`, 'utf8');
}

async function readJsonIfExists(filePath) {
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureSharedSchemaPack(categoriesRootInput = '') {
  const categoriesRoot = path.resolve(categoriesRootInput || 'categories');
  const targetSharedRoot = path.join(categoriesRoot, '_shared');
  const sourceSharedRoot = path.resolve('categories', '_shared');
  await fs.mkdir(targetSharedRoot, { recursive: true });

  const copied = [];
  const missing = [];
  const fileNames = [...new Set(Object.values(SHARED_SCHEMA_FILES))];
  for (const fileName of fileNames) {
    const targetPath = path.join(targetSharedRoot, fileName);
    if (await fileExists(targetPath)) {
      continue;
    }
    const sourcePath = path.join(sourceSharedRoot, fileName);
    if (await fileExists(sourcePath)) {
      await fs.copyFile(sourcePath, targetPath);
      copied.push(targetPath);
      continue;
    }
    missing.push(fileName);
  }

  return {
    shared_root: targetSharedRoot,
    copied,
    missing
  };
}

function schemaErrorToText(row = {}) {
  const pathToken = String(row.instancePath || row.schemaPath || '/').trim() || '/';
  const message = String(row.message || 'validation error').trim();
  return `${pathToken}: ${message}`;
}

function asNumber(value) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickGeneratedAt(fieldRules = {}) {
  return String(fieldRules.generated_at || '').trim() || new Date(0).toISOString();
}

function normalizePatterns(value) {
  const out = [];
  for (const item of toArray(value)) {
    if (typeof item === 'string') {
      if (item.trim()) {
        out.push({ regex: item.trim(), group: 1 });
      }
      continue;
    }
    if (!isObject(item)) {
      continue;
    }
    if (typeof item.regex === 'string' && item.regex.trim()) {
      out.push({
        regex: item.regex.trim(),
        group: Number.isFinite(Number(item.group)) ? Number(item.group) : 1,
        ...(item.unit ? { unit: String(item.unit) } : {}),
        ...(item.convert ? { convert: String(item.convert) } : {})
      });
    }
  }
  return out;
}

function buildParseTemplates(fieldRules = {}) {
  const fields = isObject(fieldRules.fields) ? fieldRules.fields : {};
  const templateLibrary = isObject(fieldRules.parse_templates) ? fieldRules.parse_templates : {};
  const templates = {};

  for (const [fieldKeyRaw, fieldRule] of Object.entries(fields)) {
    const fieldKey = normalizeFieldKey(fieldKeyRaw);
    if (!fieldKey || !isObject(fieldRule)) {
      continue;
    }
    const parse = isObject(fieldRule.parse) ? fieldRule.parse : {};
    const templateName = String(parse.template || '').trim();
    const templateDef = isObject(templateLibrary[templateName]) ? templateLibrary[templateName] : {};
    const patterns = [
      ...normalizePatterns(parse.patterns),
      ...normalizePatterns(templateDef.patterns),
      ...normalizePatterns(parse.regex ? [{ regex: parse.regex, group: parse.group || 1 }] : []),
      ...normalizePatterns(templateDef.regex ? [{ regex: templateDef.regex, group: templateDef.group || 1 }] : [])
    ];

    const contextKeywords = [
      ...toArray(parse.context_keywords),
      ...toArray(parse.keywords),
      ...toArray(fieldRule.aliases)
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const negativeKeywords = [
      ...toArray(parse.negative_keywords),
      ...toArray(parse.exclude_keywords)
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean);

    templates[fieldKey] = {
      patterns,
      ...(templateName ? { template: templateName } : {}),
      ...(contextKeywords.length ? { context_keywords: [...new Set(contextKeywords)] } : {}),
      ...(negativeKeywords.length ? { negative_keywords: [...new Set(negativeKeywords)] } : {}),
      ...(parse.unit ? { unit: String(parse.unit) } : {}),
      ...(parse.post_process ? { post_process: String(parse.post_process) } : {})
    };
  }

  return {
    category: String(fieldRules.category || '').trim(),
    version: 1,
    generated_at: pickGeneratedAt(fieldRules),
    templates,
    template_library: templateLibrary
  };
}

function extractRangeRule(rule = {}) {
  const contractRange = isObject(rule.contract?.range) ? rule.contract.range : {};
  const validateRange = isObject(rule.validate) && String(rule.validate.kind || '').trim() === 'number_range'
    ? rule.validate
    : {};
  const min = asNumber(contractRange.min ?? validateRange.min);
  const max = asNumber(contractRange.max ?? validateRange.max);
  if (min === null && max === null) {
    return null;
  }
  return {
    min,
    max
  };
}

function buildCrossValidationRules(fieldRules = {}) {
  const fields = isObject(fieldRules.fields) ? fieldRules.fields : {};
  const out = [];

  for (const [fieldKeyRaw, rule] of Object.entries(fields)) {
    const fieldKey = normalizeFieldKey(fieldKeyRaw);
    if (!fieldKey || !isObject(rule)) {
      continue;
    }
    const range = extractRangeRule(rule);
    if (!range) {
      continue;
    }
    out.push({
      rule_id: `${fieldKey}_plausibility`,
      description: `${fieldKey} must stay within configured plausible range`,
      trigger_field: fieldKey,
      check: {
        type: 'range',
        ...(range.min !== null ? { min: range.min } : {}),
        ...(range.max !== null ? { max: range.max } : {}),
        on_fail: 'reject_candidate'
      }
    });
  }

  const keySet = new Set(Object.keys(fields).map((key) => normalizeFieldKey(key)));
  if (keySet.has('connection') && keySet.has('battery_hours')) {
    out.push({
      rule_id: 'wireless_battery_required',
      description: 'Wireless products should provide battery_hours',
      trigger_field: 'connection',
      condition: "connection IN ['wireless','hybrid','bluetooth']",
      requires_field: 'battery_hours',
      on_fail: 'set_unknown_with_reason',
      unknown_reason: 'not_found_after_search'
    });
  }

  if (keySet.has('sensor') && keySet.has('dpi')) {
    out.push({
      rule_id: 'sensor_dpi_consistency',
      description: 'Claimed DPI should be consistent with sensor capabilities',
      trigger_field: 'dpi',
      depends_on: ['sensor'],
      check: {
        type: 'component_db_lookup',
        db: 'sensors',
        lookup_field: 'sensor',
        compare: 'dpi <= sensors[sensor].properties.max_dpi',
        on_fail: 'flag_for_review',
        tolerance_percent: 5
      }
    });
  }

  const dimKeySet = [
    ['length', 'width', 'height'],
    ['lngth', 'width', 'height']
  ].find((triplet) => triplet.every((item) => keySet.has(item)));
  if (dimKeySet) {
    out.push({
      rule_id: 'dimensions_consistency',
      description: 'Dimensions should be captured as a complete triplet',
      trigger_field: dimKeySet[0],
      related_fields: [dimKeySet[1], dimKeySet[2]],
      check: {
        type: 'group_completeness',
        minimum_present: 3,
        on_fail: 'flag_for_review'
      }
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const row of out) {
    const ruleId = String(row.rule_id || '').trim();
    if (!ruleId || seen.has(ruleId)) {
      continue;
    }
    seen.add(ruleId);
    deduped.push(row);
  }

  return {
    category: String(fieldRules.category || '').trim(),
    version: 1,
    generated_at: pickGeneratedAt(fieldRules),
    rules: deduped
  };
}

function buildFieldGroups({ category, generatedAt, uiFieldCatalog = {}, fieldRules = {} }) {
  const uiRows = toArray(uiFieldCatalog.fields);
  const fields = isObject(fieldRules.fields) ? fieldRules.fields : {};
  const groups = new Map();

  for (const row of uiRows) {
    if (!isObject(row)) {
      continue;
    }
    const fieldKey = normalizeFieldKey(row.key || row.canonical_key || '');
    if (!fieldKey) {
      continue;
    }
    const display = String(row.group || row.section || 'general').trim() || 'general';
    const groupKey = normalizeFieldKey(display) || 'general';
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        group_key: groupKey,
        display_name: display,
        field_keys: []
      });
    }
    groups.get(groupKey).field_keys.push(fieldKey);
  }

  if (groups.size === 0) {
    for (const [fieldKeyRaw, rule] of Object.entries(fields)) {
      const fieldKey = normalizeFieldKey(fieldKeyRaw);
      if (!fieldKey || !isObject(rule)) {
        continue;
      }
      const display = String(rule.ui?.group || rule.group || 'general').trim() || 'general';
      const groupKey = normalizeFieldKey(display) || 'general';
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          group_key: groupKey,
          display_name: display,
          field_keys: []
        });
      }
      groups.get(groupKey).field_keys.push(fieldKey);
    }
  }

  const normalizedGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      field_keys: [...new Set(group.field_keys)].sort((a, b) => a.localeCompare(b)),
      count: [...new Set(group.field_keys)].length
    }))
    .sort((a, b) => a.group_key.localeCompare(b.group_key));

  const groupIndex = {};
  for (const group of normalizedGroups) {
    groupIndex[group.group_key] = group.field_keys;
  }

  return {
    category,
    version: 1,
    generated_at: generatedAt,
    groups: normalizedGroups,
    group_index: groupIndex
  };
}

async function listJsonFilesRecursive(rootDir) {
  const out = [];
  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const nextPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        out.push(nextPath);
      }
    }
  }
  await walk(rootDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function stripVolatileKeys(value) {
  // Ignore timestamp/version snapshot churn so dry-run reports semantic diffs only.
  if (Array.isArray(value)) {
    return value.map((item) => stripVolatileKeys(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === 'generated_at' ||
      key === 'compiled_at' ||
      key === 'created_at' ||
      key === 'version_id'
    ) {
      continue;
    }
    out[key] = stripVolatileKeys(nested);
  }
  return out;
}

async function jsonEqualsIgnoringVolatile(leftPath, rightPath) {
  const [leftRaw, rightRaw] = await Promise.all([
    fs.readFile(leftPath, 'utf8'),
    fs.readFile(rightPath, 'utf8')
  ]);
  let leftParsed = null;
  let rightParsed = null;
  try {
    leftParsed = JSON.parse(leftRaw);
    rightParsed = JSON.parse(rightRaw);
  } catch {
    return leftRaw === rightRaw;
  }
  return stableStringify(stripVolatileKeys(leftParsed)) === stableStringify(stripVolatileKeys(rightParsed));
}

async function compareGeneratedArtifacts({ existingRoot, candidateRoot }) {
  const existingFiles = await listJsonFilesRecursive(existingRoot);
  const candidateFiles = await listJsonFilesRecursive(candidateRoot);
  const existingRelative = new Set(existingFiles.map((file) => path.relative(existingRoot, file).replace(/\\/g, '/')));
  const candidateRelative = new Set(candidateFiles.map((file) => path.relative(candidateRoot, file).replace(/\\/g, '/')));
  const all = [...new Set([...existingRelative, ...candidateRelative])]
    .filter((rel) => !rel.endsWith('_compile_report.json'))
    .sort((a, b) => a.localeCompare(b));

  const changes = [];
  for (const rel of all) {
    const leftPath = path.join(existingRoot, rel);
    const rightPath = path.join(candidateRoot, rel);
    const [leftExists, rightExists] = await Promise.all([
      fileExists(leftPath),
      fileExists(rightPath)
    ]);
    if (!leftExists && rightExists) {
      changes.push({ path: rel, type: 'added' });
      continue;
    }
    if (leftExists && !rightExists) {
      changes.push({ path: rel, type: 'removed' });
      continue;
    }
    const same = await jsonEqualsIgnoringVolatile(leftPath, rightPath);
    if (!same) {
      changes.push({ path: rel, type: 'modified' });
    }
  }
  return {
    would_change: changes.length > 0,
    changes
  };
}

async function validateArtifactsWithSchemas({
  generatedRoot,
  categoriesRoot,
  artifacts = {},
  componentFiles = []
}) {
  const schemaProvision = await ensureSharedSchemaPack(categoriesRoot);
  const sharedRoot = schemaProvision.shared_root;
  const fileEntries = [
    ['field_rules.json', artifacts.fieldRules],
    ['ui_field_catalog.json', artifacts.uiFieldCatalog],
    ['known_values.json', artifacts.knownValues],
    ['parse_templates.json', artifacts.parseTemplates],
    ['cross_validation_rules.json', artifacts.crossValidation],
    ['field_groups.json', artifacts.fieldGroups],
    ['key_migrations.json', artifacts.keyMigrations]
  ];

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false
  });
  addFormats(ajv);

  const results = [];
  const schemaLoadWarnings = [];
  for (const [artifactName, payload] of fileEntries) {
    if (!payload) {
      continue;
    }
    const schemaFile = SHARED_SCHEMA_FILES[artifactName];
    if (!schemaFile) {
      continue;
    }
    const schemaPath = path.join(sharedRoot, schemaFile);
    const schema = await readJsonIfExists(schemaPath);
    if (!schema) {
      schemaLoadWarnings.push(`missing schema file: ${schemaPath}`);
      continue;
    }
    const validate = ajv.compile(schema);
    const valid = Boolean(validate(payload));
    results.push({
      artifact: artifactName,
      schema: schemaFile,
      valid,
      errors: valid ? [] : toArray(validate.errors).map((row) => schemaErrorToText(row))
    });
  }

  const componentSchemaFile = SHARED_SCHEMA_FILES.component_db;
  const componentSchemaPath = path.join(sharedRoot, componentSchemaFile);
  const componentSchema = await readJsonIfExists(componentSchemaPath);
  if (!componentSchema) {
    schemaLoadWarnings.push(`missing schema file: ${componentSchemaPath}`);
  } else {
    const validate = ajv.compile(componentSchema);
    for (const filePath of componentFiles) {
      const payload = await readJsonIfExists(filePath);
      if (!payload) {
        continue;
      }
      const relativePath = path.relative(generatedRoot, filePath).replace(/\\/g, '/');
      const valid = Boolean(validate(payload));
      results.push({
        artifact: relativePath,
        schema: componentSchemaFile,
        valid,
        errors: valid ? [] : toArray(validate.errors).map((row) => schemaErrorToText(row))
      });
    }
  }

  const invalid = results.filter((row) => row.valid === false);
  return {
    valid: invalid.length === 0 && schemaLoadWarnings.length === 0,
    shared_root: sharedRoot,
    copied_schema_files: schemaProvision.copied,
    missing_schema_files: schemaProvision.missing,
    warnings: schemaLoadWarnings,
    artifacts: results
  };
}

async function ensurePhase1Artifacts({ category, generatedRoot }) {
  const fieldRulesPath = path.join(generatedRoot, 'field_rules.json');
  const uiCatalogPath = path.join(generatedRoot, 'ui_field_catalog.json');
  const knownValuesPath = path.join(generatedRoot, 'known_values.json');
  const parseTemplatesPath = path.join(generatedRoot, 'parse_templates.json');
  const crossValidationPath = path.join(generatedRoot, 'cross_validation_rules.json');
  const fieldGroupsPath = path.join(generatedRoot, 'field_groups.json');
  const keyMigrationsPath = path.join(generatedRoot, 'key_migrations.json');
  const componentRoot = path.join(generatedRoot, 'component_db');

  const [fieldRules, uiFieldCatalog, knownValues] = await Promise.all([
    readJsonIfExists(fieldRulesPath),
    readJsonIfExists(uiCatalogPath),
    readJsonIfExists(knownValuesPath)
  ]);

  if (!isObject(fieldRules) || !isObject(fieldRules.fields)) {
    throw new Error(`missing_or_invalid:${fieldRulesPath}`);
  }

  await writeJsonStable(parseTemplatesPath, buildParseTemplates(fieldRules));
  await writeJsonStable(crossValidationPath, buildCrossValidationRules(fieldRules));
  await writeJsonStable(
    fieldGroupsPath,
    buildFieldGroups({
      category,
      generatedAt: pickGeneratedAt(fieldRules),
      uiFieldCatalog: isObject(uiFieldCatalog) ? uiFieldCatalog : {},
      fieldRules
    })
  );
  if (!(await fileExists(keyMigrationsPath))) {
    await writeJsonStable(keyMigrationsPath, {});
  }
  if (!(await fileExists(componentRoot))) {
    await fs.mkdir(componentRoot, { recursive: true });
  }

  return {
    fieldRules: fieldRulesPath,
    uiFieldCatalog: uiCatalogPath,
    knownValues: knownValuesPath,
    parseTemplates: parseTemplatesPath,
    crossValidation: crossValidationPath,
    fieldGroups: fieldGroupsPath,
    keyMigrations: keyMigrationsPath,
    componentDbDir: componentRoot,
    field_count: Object.keys(fieldRules.fields || {}).length,
    known_value_buckets: Object.keys(knownValues?.enums || knownValues?.fields || {}).length
  };
}

async function compileIntoRoot({
  category,
  workbookPath = '',
  workbookMap = null,
  config = {},
  mapPath = null,
  helperFilesRoot
}) {
  const helperRoot = path.resolve(helperFilesRoot || 'helper_files');
  const categoryRoot = path.join(helperRoot, category);
  const preferredHelperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const preferredCategoryRoot = path.join(preferredHelperRoot, category);

  async function resolveFallbackWorkbookPath() {
    const direct = String(workbookPath || '').trim();
    if (direct) {
      return path.resolve(direct);
    }
    const namedDefault = path.join(categoryRoot, `${category}Data.xlsm`);
    if (await fileExists(namedDefault)) {
      return namedDefault;
    }
    const preferredNamedDefault = path.join(preferredCategoryRoot, `${category}Data.xlsm`);
    if (await fileExists(preferredNamedDefault)) {
      return preferredNamedDefault;
    }
    const entries = await fs.readdir(categoryRoot, { withFileTypes: true }).catch(() => []);
    const workbookCandidate = entries.find((entry) => (
      entry.isFile() && /\.(xlsm|xlsx)$/i.test(entry.name) && !entry.name.startsWith('~$')
    ));
    if (workbookCandidate) {
      return path.join(categoryRoot, workbookCandidate.name);
    }
    const preferredEntries = await fs.readdir(preferredCategoryRoot, { withFileTypes: true }).catch(() => []);
    const preferredCandidate = preferredEntries.find((entry) => (
      entry.isFile() && /\.(xlsm|xlsx)$/i.test(entry.name) && !entry.name.startsWith('~$')
    ));
    if (preferredCandidate) {
      return path.join(preferredCategoryRoot, preferredCandidate.name);
    }
    return '';
  }

  function buildDefaultWorkbookMap(resolvedWorkbookPath) {
    // Safe bootstrap map used only when no workbook_map exists yet.
    return {
      version: 1,
      workbook_path: resolvedWorkbookPath,
      sheet_roles: [
        { sheet: 'dataEntry', role: 'product_table' },
        { sheet: 'dataEntry', role: 'field_key_list' }
      ],
      key_list: {
        sheet: 'dataEntry',
        source: 'column_range',
        column: 'B',
        row_start: 9,
        row_end: 400
      },
      product_table: {
        sheet: 'dataEntry',
        layout: 'matrix',
        brand_row: 3,
        model_row: 4,
        variant_row: 5,
        value_col_start: 'C',
        value_col_end: '',
        sample_columns: 18
      },
      expectations: {
        required_fields: ['connection', 'weight', 'dpi'],
        critical_fields: ['polling_rate'],
        expected_easy_fields: [],
        expected_sometimes_fields: [],
        deep_fields: []
      },
      enum_lists: [],
      component_sheets: [],
      field_overrides: {}
    };
  }

  if (workbookMap) {
    await saveWorkbookMap({
      category,
      workbookMap,
      config: {
        ...config,
        helperFilesRoot
      },
      mapPath
    });
  }

  let compileResult;
  try {
    compileResult = await compileCategoryWorkbook({
      category,
      workbookPath,
      workbookMap,
      config: {
        ...config,
        helperFilesRoot
      },
      mapPath
    });
  } catch (error) {
    if (
      String(error?.message || '') === 'workbook_map_missing'
      && !workbookMap
    ) {
      const resolvedWorkbookPath = await resolveFallbackWorkbookPath();
      if (!resolvedWorkbookPath) {
        throw error;
      }
      const fallbackMap = buildDefaultWorkbookMap(resolvedWorkbookPath);
      await saveWorkbookMap({
        category,
        workbookMap: fallbackMap,
        config: {
          ...config,
          helperFilesRoot
        },
        mapPath
      });
      compileResult = await compileCategoryWorkbook({
        category,
        workbookPath: resolvedWorkbookPath,
        workbookMap: fallbackMap,
        config: {
          ...config,
          helperFilesRoot
        },
        mapPath
      });
    } else {
      throw error;
    }
  }

  if (!compileResult?.compiled) {
    return {
      compileResult,
      ensured: null
    };
  }
  const generatedRoot = path.join(path.resolve(helperFilesRoot || 'helper_files'), category, '_generated');
  const ensured = await ensurePhase1Artifacts({
    category,
    generatedRoot
  });
  return {
    compileResult,
    ensured
  };
}

function mapArtifactsToList(generatedRoot) {
  return [
    path.join(generatedRoot, 'field_rules.json'),
    path.join(generatedRoot, 'ui_field_catalog.json'),
    path.join(generatedRoot, 'known_values.json'),
    path.join(generatedRoot, 'parse_templates.json'),
    path.join(generatedRoot, 'cross_validation_rules.json'),
    path.join(generatedRoot, 'field_groups.json'),
    path.join(generatedRoot, 'key_migrations.json'),
    path.join(generatedRoot, 'component_db')
  ];
}

export async function compileRules({
  category,
  workbookPath = '',
  workbookMap = null,
  dryRun = false,
  config = {},
  mapPath = null
}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }

  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const generatedRoot = path.join(helperRoot, normalizedCategory, '_generated');

  if (dryRun) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-dry-run-'));
    const tempHelperRoot = path.join(tempRoot, 'helper_files');
    try {
      const staged = await compileIntoRoot({
        category: normalizedCategory,
        workbookPath,
        workbookMap,
        config,
        mapPath,
        helperFilesRoot: tempHelperRoot
      });
      if (!staged.compileResult?.compiled) {
        return {
          category: normalizedCategory,
          compiled: false,
          dry_run: true,
          would_change: true,
          errors: staged.compileResult?.errors || ['compile_failed'],
          warnings: staged.compileResult?.warnings || []
        };
      }
      const candidateGenerated = path.join(tempHelperRoot, normalizedCategory, '_generated');
      const existingPresent = await fileExists(generatedRoot);
      if (!existingPresent) {
        return {
          category: normalizedCategory,
          compiled: true,
          dry_run: true,
          would_change: true,
          changes: [{ path: '_generated', type: 'added' }],
          phase1_artifacts: mapArtifactsToList(candidateGenerated),
          field_count: staged.ensured?.field_count || 0,
          warnings: staged.compileResult?.warnings || []
        };
      }

      const diff = await compareGeneratedArtifacts({
        existingRoot: generatedRoot,
        candidateRoot: candidateGenerated
      });
      return {
        category: normalizedCategory,
        compiled: true,
        dry_run: true,
        would_change: diff.would_change,
        changes: diff.changes,
        phase1_artifacts: mapArtifactsToList(generatedRoot),
        field_count: staged.ensured?.field_count || 0,
        warnings: staged.compileResult?.warnings || []
      };
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }

  const result = await compileIntoRoot({
    category: normalizedCategory,
    workbookPath,
    workbookMap,
    config,
    mapPath,
    helperFilesRoot: helperRoot
  });

  if (!result.compileResult?.compiled) {
    return {
      category: normalizedCategory,
      compiled: false,
      errors: result.compileResult?.errors || ['compile_failed'],
      warnings: result.compileResult?.warnings || []
    };
  }

  return {
    category: normalizedCategory,
    compiled: true,
    dry_run: false,
    generated_root: generatedRoot,
    phase1_artifacts: mapArtifactsToList(generatedRoot),
    field_count: result.ensured?.field_count || result.compileResult?.field_count || 0,
    warnings: result.compileResult?.warnings || [],
    errors: []
  };
}

export async function validateRules({
  category,
  config = {}
}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }

  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoriesRoot = path.resolve(config.categoriesRoot || 'categories');
  const generatedRoot = path.join(helperRoot, normalizedCategory, '_generated');
  const errors = [];
  const warnings = [];

  for (const name of REQUIRED_ARTIFACTS) {
    const filePath = path.join(generatedRoot, name);
    if (!(await fileExists(filePath))) {
      errors.push(`missing required artifact: ${name}`);
    }
  }

  const componentRoot = path.join(generatedRoot, 'component_db');
  if (!(await fileExists(componentRoot))) {
    errors.push('missing required artifact: component_db/');
  }
  const componentFiles = (await listJsonFilesRecursive(componentRoot))
    .filter((file) => file.toLowerCase().endsWith('.json'));
  if (componentFiles.length === 0) {
    warnings.push('component_db has no JSON files');
  }

  const [fieldRules, knownValues, parseTemplates, crossValidation, fieldGroups, uiFieldCatalog, keyMigrations] = await Promise.all([
    readJsonIfExists(path.join(generatedRoot, 'field_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'known_values.json')),
    readJsonIfExists(path.join(generatedRoot, 'parse_templates.json')),
    readJsonIfExists(path.join(generatedRoot, 'cross_validation_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'field_groups.json')),
    readJsonIfExists(path.join(generatedRoot, 'ui_field_catalog.json')),
    readJsonIfExists(path.join(generatedRoot, 'key_migrations.json'))
  ]);

  if (!isObject(fieldRules) || !isObject(fieldRules.fields)) {
    errors.push('field_rules.json is missing fields object');
  }
  if (!isObject(knownValues)) {
    errors.push('known_values.json is not a JSON object');
  }
  if (!isObject(parseTemplates) || !isObject(parseTemplates.templates)) {
    errors.push('parse_templates.json is missing templates object');
  }
  if (!isObject(crossValidation) || !Array.isArray(crossValidation.rules)) {
    errors.push('cross_validation_rules.json is missing rules array');
  }
  if (!isObject(fieldGroups) || !Array.isArray(fieldGroups.groups)) {
    errors.push('field_groups.json is missing groups array');
  }

  const fieldCount = isObject(fieldRules?.fields) ? Object.keys(fieldRules.fields).length : 0;
  if (fieldCount === 0) {
    errors.push('field_rules.json has zero fields');
  }

  const enumCount = Object.keys(knownValues?.enums || knownValues?.fields || {}).length;
  const parseTemplateCount = Object.keys(parseTemplates?.templates || {}).length;
  const crossValidationCount = toArray(crossValidation?.rules).length;
  const fieldGroupCount = toArray(fieldGroups?.groups).length;

  const schema = await validateArtifactsWithSchemas({
    generatedRoot,
    categoriesRoot,
    artifacts: {
      fieldRules,
      uiFieldCatalog,
      knownValues,
      parseTemplates,
      crossValidation,
      fieldGroups,
      keyMigrations
    },
    componentFiles
  });
  for (const warning of schema.warnings || []) {
    warnings.push(`schema warning: ${warning}`);
  }
  for (const row of schema.artifacts || []) {
    if (row.valid) {
      continue;
    }
    const details = toArray(row.errors).slice(0, 5).join('; ');
    errors.push(`schema validation failed: ${row.artifact} (${row.schema})${details ? ` -> ${details}` : ''}`);
  }
  for (const missingFile of schema.missing_schema_files || []) {
    errors.push(`missing shared schema file: ${missingFile}`);
  }

  return {
    category: normalizedCategory,
    valid: errors.length === 0,
    errors,
    warnings,
    generated_root: generatedRoot,
    stats: {
      field_count: fieldCount,
      enum_count: enumCount,
      parse_template_count: parseTemplateCount,
      cross_validation_rule_count: crossValidationCount,
      field_group_count: fieldGroupCount,
      component_db_files: componentFiles.length,
      schema_artifacts_validated: toArray(schema.artifacts).length
    },
    schema
  };
}

function defaultCategorySchema(category, templateName) {
  return {
    category,
    template: templateName,
    field_order: [],
    critical_fields: [],
    expected_easy_fields: [],
    expected_sometimes_fields: [],
    deep_fields: [],
    editorial_fields: [],
    targets: {
      targetCompleteness: 0.9,
      targetConfidence: 0.8
    }
  };
}

function defaultSources() {
  return {
    approved: {
      manufacturer: [],
      lab: [],
      database: [],
      retailer: []
    },
    denylist: []
  };
}

function defaultSearchTemplates(category) {
  return [
    `${category} {brand} {model} specs`,
    `${category} {brand} {model} datasheet`,
    `${category} {brand} {model} manual pdf`
  ];
}

function defaultSourceSeed(category, templateName) {
  const preset = TEMPLATE_PRESETS[templateName] || TEMPLATE_PRESETS.electronics;
  return {
    category,
    template: templateName,
    groups: {
      identity: preset.common_identity,
      physical: preset.common_physical,
      connectivity: preset.common_connectivity,
      performance: [],
      features: [],
      editorial: preset.common_editorial,
      commerce: preset.common_commerce,
      media: preset.common_media
    }
  };
}

async function writeIfMissing(filePath, payload) {
  if (await fileExists(filePath)) {
    return false;
  }
  await writeJsonStable(filePath, payload);
  return true;
}

export async function initCategory({
  category,
  template = 'electronics',
  config = {}
}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const templateName = normalizeToken(template) || 'electronics';

  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoriesRoot = path.resolve(config.categoriesRoot || 'categories');
  const helperCategoryRoot = path.join(helperRoot, normalizedCategory);
  const sourceRoot = path.join(helperCategoryRoot, '_source');
  const generatedRoot = path.join(helperCategoryRoot, '_generated');
  const suggestionsRoot = path.join(helperCategoryRoot, '_suggestions');
  const overridesRoot = path.join(helperCategoryRoot, '_overrides');
  const categoryConfigRoot = path.join(categoriesRoot, normalizedCategory);

  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(generatedRoot, { recursive: true });
  await fs.mkdir(suggestionsRoot, { recursive: true });
  await fs.mkdir(overridesRoot, { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'component_db'), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'overrides'), { recursive: true });
  await fs.mkdir(categoryConfigRoot, { recursive: true });
  const schemaProvision = await ensureSharedSchemaPack(categoriesRoot);

  const createdFiles = [];
  const maybeCreated = [
    [path.join(sourceRoot, 'field_catalog.seed.json'), defaultSourceSeed(normalizedCategory, templateName)],
    [path.join(categoryConfigRoot, 'schema.json'), defaultCategorySchema(normalizedCategory, templateName)],
    [path.join(categoryConfigRoot, 'sources.json'), defaultSources()],
    [path.join(categoryConfigRoot, 'required_fields.json'), []],
    [path.join(categoryConfigRoot, 'search_templates.json'), defaultSearchTemplates(normalizedCategory)],
    [path.join(categoryConfigRoot, 'anchors.json'), {}]
  ];

  for (const [filePath, payload] of maybeCreated) {
    if (await writeIfMissing(filePath, payload)) {
      createdFiles.push(filePath);
    }
  }

  return {
    category: normalizedCategory,
    template: templateName,
    created: true,
    created_files: createdFiles,
    shared_schema_root: schemaProvision.shared_root,
    shared_schema_copied: schemaProvision.copied,
    paths: {
      helper_category_root: helperCategoryRoot,
      source_root: sourceRoot,
      generated_root: generatedRoot,
      suggestions_root: suggestionsRoot,
      overrides_root: overridesRoot,
      category_root: categoryConfigRoot
    }
  };
}

export async function listFields({
  category,
  config = {},
  group = '',
  requiredLevel = ''
}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }

  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const generatedRoot = path.join(helperRoot, normalizedCategory, '_generated');
  const [fieldRules, uiFieldCatalog] = await Promise.all([
    readJsonIfExists(path.join(generatedRoot, 'field_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'ui_field_catalog.json'))
  ]);
  if (!isObject(fieldRules) || !isObject(fieldRules.fields)) {
    throw new Error(`missing_or_invalid:${path.join(generatedRoot, 'field_rules.json')}`);
  }

  const uiRows = new Map();
  for (const row of toArray(uiFieldCatalog?.fields)) {
    if (!isObject(row)) {
      continue;
    }
    const key = normalizeFieldKey(row.key || row.canonical_key || '');
    if (!key) {
      continue;
    }
    uiRows.set(key, row);
  }

  const groupFilter = normalizeFieldKey(group);
  const requiredFilter = normalizeToken(requiredLevel);
  const rows = [];
  for (const [fieldKeyRaw, rule] of Object.entries(fieldRules.fields)) {
    const fieldKey = normalizeFieldKey(fieldKeyRaw);
    if (!fieldKey || !isObject(rule)) {
      continue;
    }
    const ui = uiRows.get(fieldKey) || {};
    const groupValue = String(ui.group || rule.ui?.group || rule.group || 'general');
    const requiredValue = String(rule.priority?.required_level || rule.required_level || '').trim().toLowerCase();
    if (groupFilter && normalizeFieldKey(groupValue) !== groupFilter) {
      continue;
    }
    if (requiredFilter && requiredValue !== requiredFilter) {
      continue;
    }
    rows.push({
      key: fieldKey,
      display_name: String(ui.label || rule.ui?.label || titleCase(fieldKey)),
      group: groupValue,
      required_level: requiredValue || 'optional',
      data_type: String(rule.contract?.type || rule.type || 'string'),
      output_shape: String(rule.contract?.shape || rule.shape || 'scalar'),
      unit: String(rule.contract?.unit || rule.unit || '')
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return {
    category: normalizedCategory,
    count: rows.length,
    fields: rows
  };
}

export async function fieldReport({
  category,
  config = {},
  format = 'md'
}) {
  const listing = await listFields({ category, config });
  const byGroup = new Map();
  for (const row of listing.fields) {
    const key = normalizeFieldKey(row.group) || 'general';
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        group: row.group || 'general',
        count: 0,
        required: 0,
        critical: 0
      });
    }
    const bucket = byGroup.get(key);
    bucket.count += 1;
    if (row.required_level === 'required') {
      bucket.required += 1;
    }
    if (row.required_level === 'critical') {
      bucket.critical += 1;
    }
  }

  const groupRows = [...byGroup.values()].sort((a, b) => a.group.localeCompare(b.group));
  if (normalizeToken(format) !== 'md') {
    return {
      category: listing.category,
      format: 'json',
      field_count: listing.count,
      groups: groupRows,
      fields: listing.fields
    };
  }

  const lines = [];
  lines.push(`# Field Report: ${listing.category}`);
  lines.push('');
  lines.push(`- Total fields: ${listing.count}`);
  lines.push('');
  lines.push('## Group Summary');
  lines.push('');
  lines.push('| Group | Fields | Required | Critical |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const row of groupRows) {
    lines.push(`| ${row.group} | ${row.count} | ${row.required} | ${row.critical} |`);
  }
  lines.push('');
  lines.push('## Fields');
  lines.push('');
  lines.push('| Key | Display Name | Group | Required Level | Type | Shape | Unit |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of listing.fields) {
    lines.push(`| ${row.key} | ${row.display_name} | ${row.group} | ${row.required_level} | ${row.data_type} | ${row.output_shape} | ${row.unit || ''} |`);
  }

  return {
    category: listing.category,
    format: 'md',
    report: `${lines.join('\n')}\n`
  };
}
