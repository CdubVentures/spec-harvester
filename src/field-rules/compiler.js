import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import ExcelJS from 'exceljs';
import semver from 'semver';
import { compileCategoryWorkbook, saveWorkbookMap } from '../ingest/categoryCompile.js';
import { buildMigrationPlan } from './migrations.js';
import {
  ruleType as ruleTypeAccessor,
  ruleShape as ruleShapeAccessor,
  ruleRequiredLevel as ruleRequiredLevelAccessor,
  ruleAvailability as ruleAvailabilityAccessor,
  ruleDifficulty as ruleDifficultyAccessor,
  ruleEffort as ruleEffortAccessor,
  ruleEvidenceRequired as ruleEvidenceRequiredAccessor
} from '../engine/ruleAccessors.js';

const REQUIRED_ARTIFACTS = [
  'field_rules.json',
  'ui_field_catalog.json',
  'known_values.json',
  'parse_templates.json',
  'cross_validation_rules.json',
  'field_groups.json',
  'key_migrations.json',
  'manifest.json'
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

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function hashFileWithMeta(filePath) {
  const buffer = await fs.readFile(filePath);
  const text = buffer.toString('utf8');
  try {
    const parsed = JSON.parse(text);
    const semantic = stableStringify(stripVolatileKeys(parsed));
    return {
      sha256: sha256Buffer(Buffer.from(semantic, 'utf8')),
      bytes: buffer.length
    };
  } catch {
    // Non-JSON files are hashed byte-for-byte.
  }
  return {
    sha256: sha256Buffer(buffer),
    bytes: buffer.length
  };
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

function nonEmptyString(value) {
  return String(value || '').trim().length > 0;
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

async function copyDirectoryRecursive(sourceDir, targetDir) {
  let entries = [];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
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

async function verifyGeneratedManifest({
  generatedRoot,
  manifest = {}
}) {
  if (!isObject(manifest) || !Array.isArray(manifest.artifacts)) {
    return {
      valid: false,
      errors: ['manifest.json missing artifacts array']
    };
  }
  const errors = [];
  for (const row of manifest.artifacts) {
    const relativePath = String(row?.path || '').trim();
    const expectedHash = String(row?.sha256 || '').trim().toLowerCase();
    if (!relativePath || !expectedHash) {
      errors.push(`manifest row missing path/hash: ${stableStringify(row)}`);
      continue;
    }
    const filePath = path.join(generatedRoot, relativePath);
    if (!(await fileExists(filePath))) {
      errors.push(`manifest references missing file: ${relativePath}`);
      continue;
    }
    const actual = await hashFileWithMeta(filePath);
    if (actual.sha256 !== expectedHash) {
      errors.push(`manifest hash mismatch: ${relativePath}`);
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

function validateKeyMigrationsMetadata(keyMigrations = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(keyMigrations)) {
    errors.push('key_migrations.json is not a JSON object');
    return { valid: false, errors, warnings };
  }

  const hasDocShape = Array.isArray(keyMigrations.migrations);
  if (!hasDocShape) {
    warnings.push('key_migrations.json is in legacy key-map shape (migrations array missing)');
    return { valid: true, errors, warnings };
  }

  const version = String(keyMigrations.version || '').trim();
  const previousVersion = String(keyMigrations.previous_version || '').trim();
  if (!semver.valid(semver.coerce(version))) {
    errors.push(`invalid key_migrations version: '${version || '(empty)'}'`);
  }
  if (!semver.valid(semver.coerce(previousVersion))) {
    errors.push(`invalid key_migrations previous_version: '${previousVersion || '(empty)'}'`);
  }
  if (!isObject(keyMigrations.key_map)) {
    warnings.push('key_migrations key_map missing or invalid');
  }

  for (const row of keyMigrations.migrations) {
    const type = String(row?.type || '').trim().toLowerCase();
    if (!type) {
      errors.push('key_migrations migration row missing type');
      continue;
    }
    if (type === 'rename') {
      const from = normalizeFieldKey(row?.from);
      const to = normalizeFieldKey(row?.to);
      if (!from || !to || from === to) {
        errors.push(`key_migrations rename invalid: from='${row?.from || ''}' to='${row?.to || ''}'`);
      }
    }
    if (type === 'merge') {
      const to = normalizeFieldKey(row?.to);
      const fromList = toArray(row?.from).map((value) => normalizeFieldKey(value)).filter(Boolean);
      if (!to || fromList.length < 2) {
        warnings.push(`key_migrations merge should include >=2 sources: to='${row?.to || ''}'`);
      }
    }
    if (type === 'split') {
      const from = normalizeFieldKey(row?.from);
      const toList = toArray(row?.to).map((value) => normalizeFieldKey(value)).filter(Boolean);
      if (!from || toList.length < 2) {
        warnings.push(`key_migrations split should include >=2 targets: from='${row?.from || ''}'`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function toPhase1Group(value) {
  const token = normalizeFieldKey(value || '');
  return token || 'general';
}

export function normalizeFieldRulesForPhase1(fieldRules = {}) {
  if (!isObject(fieldRules) || !isObject(fieldRules.fields)) {
    return fieldRules;
  }
  const out = {
    ...fieldRules,
    field_count: Object.keys(fieldRules.fields).length,
    fields: {}
  };
  for (const [fieldKeyRaw, ruleRaw] of Object.entries(fieldRules.fields)) {
    const fieldKey = normalizeFieldKey(fieldKeyRaw);
    if (!fieldKey || !isObject(ruleRaw)) {
      continue;
    }
    const rule = { ...ruleRaw };
    const priority = isObject(rule.priority) ? rule.priority : {};
    const contract = isObject(rule.contract) ? rule.contract : {};
    const evidence = isObject(rule.evidence) ? rule.evidence : {};
    const ui = isObject(rule.ui) ? rule.ui : {};
    const parse = isObject(rule.parse) ? rule.parse : {};
    const dataType = ruleTypeAccessor(rule);
    const outputShape = ruleShapeAccessor(rule);
    const requiredLevel = ruleRequiredLevelAccessor(rule);
    const availability = ruleAvailabilityAccessor(rule);
    const difficulty = ruleDifficultyAccessor(rule);
    const normalizedEffort = ruleEffortAccessor(rule);
    const evidenceRequired = ruleEvidenceRequiredAccessor(rule);

    rule.field_key = String(rule.field_key || fieldKey);
    rule.display_name = String(rule.display_name || ui.label || titleCase(fieldKey));
    rule.group = String(rule.group || toPhase1Group(ui.group));
    rule.data_type = dataType;
    rule.output_shape = outputShape;
    rule.required_level = requiredLevel;
    rule.availability = availability;
    rule.difficulty = difficulty;
    rule.effort = normalizedEffort;
    rule.evidence_required = evidenceRequired;
    rule.priority = {
      ...priority,
      required_level: requiredLevel,
      availability,
      difficulty,
      effort: normalizedEffort
    };
    rule.contract = {
      ...contract,
      type: String(contract.type || dataType || 'string'),
      shape: String(contract.shape || outputShape || 'scalar')
    };
    rule.parse = { ...parse };
    rule.evidence = {
      ...evidence,
      required: evidenceRequired
    };
    if (!nonEmptyString(rule.unknown_reason_default)) {
      rule.unknown_reason_default = 'not_found_after_search';
    }
    out.fields[fieldKey] = rule;
  }
  return out;
}

function auditFieldMetadata(fieldRules = {}) {
  const results = {
    errors: [],
    warnings: [],
    complete_count: 0,
    incomplete_count: 0
  };
  const fields = isObject(fieldRules?.fields) ? fieldRules.fields : {};
  for (const [fieldKeyRaw, rule] of Object.entries(fields)) {
    const fieldKey = normalizeFieldKey(fieldKeyRaw);
    if (!fieldKey || !isObject(rule)) {
      continue;
    }
    const missing = [];
    const requiredLevel = String(rule.required_level || rule.priority?.required_level || '').trim();
    const availability = String(rule.availability || rule.priority?.availability || '').trim();
    const difficulty = String(rule.difficulty || rule.priority?.difficulty || '').trim();
    const effortValue = Number.parseInt(String(rule.effort ?? rule.priority?.effort ?? ''), 10);
    const dataType = String(rule.data_type || rule.contract?.type || rule.type || '').trim();
    const outputShape = String(rule.output_shape || rule.contract?.shape || rule.shape || '').trim();
    const evidenceRequired = rule.evidence_required;
    const unknownReasonDefault = String(rule.unknown_reason_default || '').trim();

    if (!requiredLevel) missing.push('required_level');
    if (!availability) missing.push('availability');
    if (!difficulty) missing.push('difficulty');
    if (!Number.isFinite(effortValue)) missing.push('effort');
    if (!dataType) missing.push('data_type');
    if (!outputShape) missing.push('output_shape');
    if (typeof evidenceRequired !== 'boolean') missing.push('evidence_required');
    if (!unknownReasonDefault) missing.push('unknown_reason_default');

    if (missing.length > 0) {
      results.errors.push(`field '${fieldKey}' missing metadata: ${missing.join(', ')}`);
      results.incomplete_count += 1;
      continue;
    }
    if (effortValue < 1 || effortValue > 10) {
      results.errors.push(`field '${fieldKey}' has invalid effort ${effortValue}; expected 1..10`);
      results.incomplete_count += 1;
      continue;
    }
    results.complete_count += 1;
  }
  return results;
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
  const fieldRulesRuntimePath = path.join(generatedRoot, 'field_rules.runtime.json');
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
  const normalizedFieldRules = normalizeFieldRulesForPhase1(fieldRules);
  await writeJsonStable(fieldRulesPath, normalizedFieldRules);
  if (await fileExists(fieldRulesRuntimePath)) {
    await writeJsonStable(fieldRulesRuntimePath, normalizedFieldRules);
  }

  await writeJsonStable(parseTemplatesPath, buildParseTemplates(normalizedFieldRules));
  await writeJsonStable(crossValidationPath, buildCrossValidationRules(normalizedFieldRules));
  await writeJsonStable(
    fieldGroupsPath,
    buildFieldGroups({
      category,
      generatedAt: pickGeneratedAt(normalizedFieldRules),
      uiFieldCatalog: isObject(uiFieldCatalog) ? uiFieldCatalog : {},
      fieldRules: normalizedFieldRules
    })
  );
  const existingMigrations = await readJsonIfExists(keyMigrationsPath);
  const migrationPlan = buildMigrationPlan({
    previousRules: normalizedFieldRules,
    nextRules: normalizedFieldRules,
    keyMigrations: isObject(existingMigrations) ? existingMigrations : {},
    previousVersion: String(existingMigrations?.previous_version || existingMigrations?.version || '1.0.0'),
    nextVersion: String(existingMigrations?.version || '1.0.0')
  });
  await writeJsonStable(keyMigrationsPath, migrationPlan);
  if (!(await fileExists(componentRoot))) {
    await fs.mkdir(componentRoot, { recursive: true });
  }

  const manifestPath = path.join(generatedRoot, 'manifest.json');
  const artifactFiles = (await listJsonFilesRecursive(generatedRoot))
    .filter((filePath) => {
      const base = path.basename(filePath);
      return base !== 'manifest.json' && base !== '_compile_report.json';
    });
  const artifacts = [];
  for (const filePath of artifactFiles) {
    const meta = await hashFileWithMeta(filePath);
    artifacts.push({
      path: path.relative(generatedRoot, filePath).replace(/\\/g, '/'),
      sha256: meta.sha256,
      bytes: meta.bytes
    });
  }
  artifacts.sort((a, b) => a.path.localeCompare(b.path));
  await writeJsonStable(manifestPath, {
    version: 1,
    category,
    generated_at: new Date().toISOString(),
    algorithm: 'sha256',
    artifact_count: artifacts.length,
    artifacts
  });

  return {
    fieldRules: fieldRulesPath,
    uiFieldCatalog: uiCatalogPath,
    knownValues: knownValuesPath,
    parseTemplates: parseTemplatesPath,
    crossValidation: crossValidationPath,
    fieldGroups: fieldGroupsPath,
    keyMigrations: keyMigrationsPath,
    manifest: manifestPath,
    componentDbDir: componentRoot,
    field_count: Object.keys(normalizedFieldRules.fields || {}).length,
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

  async function resolveWorkbookFromDir(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    const workbookCandidate = entries.find((entry) => (
      entry.isFile() && /\.(xlsm|xlsx)$/i.test(entry.name) && !entry.name.startsWith('~$')
    ));
    return workbookCandidate ? path.join(dirPath, workbookCandidate.name) : '';
  }

  async function resolveFallbackWorkbookPath() {
    const direct = String(workbookPath || '').trim();
    if (direct) {
      return path.resolve(direct);
    }
    const explicitCandidates = [
      path.join(categoryRoot, `${category}Data.xlsm`),
      path.join(categoryRoot, `${category}Data.xlsx`),
      path.join(preferredCategoryRoot, `${category}Data.xlsm`),
      path.join(preferredCategoryRoot, `${category}Data.xlsx`),
      path.join(categoryRoot, '_source', 'field_catalog.xlsx'),
      path.join(preferredCategoryRoot, '_source', 'field_catalog.xlsx')
    ];
    for (const candidate of explicitCandidates) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    const scanDirs = [
      categoryRoot,
      preferredCategoryRoot,
      path.join(categoryRoot, '_source'),
      path.join(preferredCategoryRoot, '_source')
    ];
    for (const dirPath of scanDirs) {
      const workbookCandidate = await resolveWorkbookFromDir(dirPath);
      if (workbookCandidate) {
        return workbookCandidate;
      }
    }
    return '';
  }

  function buildDefaultWorkbookMap(resolvedWorkbookPath) {
    const normalizedName = path.basename(String(resolvedWorkbookPath || '')).toLowerCase();
    const isStarterCatalog = normalizedName === 'field_catalog.xlsx';
    if (isStarterCatalog) {
      return {
        version: 1,
        workbook_path: resolvedWorkbookPath,
        sheet_roles: [
          { sheet: 'field_catalog', role: 'field_key_list' }
        ],
        key_list: {
          sheet: 'field_catalog',
          source: 'column_range',
          column: 'B',
          row_start: 2,
          row_end: 2000
        },
        expectations: {
          required_fields: [],
          critical_fields: [],
          expected_easy_fields: [],
          expected_sometimes_fields: [],
          deep_fields: []
        },
        enum_lists: [],
        component_sheets: [],
        field_overrides: {}
      };
    }

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
    path.join(generatedRoot, 'manifest.json'),
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
      let dryRunWorkbookPath = workbookPath;
      let dryRunWorkbookMap = workbookMap;
      if (!dryRunWorkbookMap) {
        const existingMapPath = String(mapPath || '').trim()
          ? path.resolve(String(mapPath))
          : path.join(helperRoot, normalizedCategory, '_control_plane', 'workbook_map.json');
        const existingMap = await readJsonIfExists(existingMapPath);
        if (isObject(existingMap)) {
          dryRunWorkbookMap = existingMap;
          if (!String(dryRunWorkbookPath || '').trim() && nonEmptyString(existingMap.workbook_path)) {
            dryRunWorkbookPath = String(existingMap.workbook_path);
          }
        }
      }
      // Mirror current category context so dry-run diff matches real compile behavior.
      await copyDirectoryRecursive(
        path.join(helperRoot, normalizedCategory),
        path.join(tempHelperRoot, normalizedCategory)
      );
      const staged = await compileIntoRoot({
        category: normalizedCategory,
        workbookPath: dryRunWorkbookPath,
        workbookMap: dryRunWorkbookMap,
        config,
        mapPath: null,
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

  const [fieldRules, knownValues, parseTemplates, crossValidation, fieldGroups, uiFieldCatalog, keyMigrations, manifest] = await Promise.all([
    readJsonIfExists(path.join(generatedRoot, 'field_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'known_values.json')),
    readJsonIfExists(path.join(generatedRoot, 'parse_templates.json')),
    readJsonIfExists(path.join(generatedRoot, 'cross_validation_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'field_groups.json')),
    readJsonIfExists(path.join(generatedRoot, 'ui_field_catalog.json')),
    readJsonIfExists(path.join(generatedRoot, 'key_migrations.json')),
    readJsonIfExists(path.join(generatedRoot, 'manifest.json'))
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
  if (!isObject(manifest) || !Array.isArray(manifest.artifacts)) {
    errors.push('manifest.json is missing artifacts array');
  }
  const migrationMeta = validateKeyMigrationsMetadata(keyMigrations);
  for (const row of migrationMeta.errors) {
    errors.push(`key_migrations validation failed: ${row}`);
  }
  for (const row of migrationMeta.warnings) {
    warnings.push(`key_migrations warning: ${row}`);
  }

  const fieldCount = isObject(fieldRules?.fields) ? Object.keys(fieldRules.fields).length : 0;
  if (fieldCount === 0) {
    errors.push('field_rules.json has zero fields');
  }
  const metadataAudit = auditFieldMetadata(fieldRules);
  for (const row of metadataAudit.errors) {
    errors.push(`metadata validation failed: ${row}`);
  }
  for (const row of metadataAudit.warnings) {
    warnings.push(`metadata warning: ${row}`);
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

  if (isObject(manifest) && Array.isArray(manifest.artifacts)) {
    const manifestCheck = await verifyGeneratedManifest({
      generatedRoot,
      manifest
    });
    if (!manifestCheck.valid) {
      for (const row of manifestCheck.errors) {
        errors.push(`manifest validation failed: ${row}`);
      }
    }
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
      manifest_artifact_count: Array.isArray(manifest?.artifacts) ? manifest.artifacts.length : 0,
      key_migration_count: Array.isArray(keyMigrations?.migrations) ? keyMigrations.migrations.length : 0,
      schema_artifacts_validated: toArray(schema.artifacts).length,
      fields_with_complete_metadata: metadataAudit.complete_count,
      fields_with_incomplete_metadata: metadataAudit.incomplete_count
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

function starterFieldDefinition({ group, fieldKey }) {
  const normalizedGroup = normalizeFieldKey(group);
  const key = normalizeFieldKey(fieldKey);
  const isList = ['pros', 'cons', 'images', 'gallery_images', 'affiliate_links'].includes(key);
  const isUrl = key.includes('url');
  const isScore = key === 'overall_score';
  const dataType = isScore ? 'number' : (isUrl ? 'url' : 'string');
  const outputShape = isList ? 'list' : 'scalar';
  let requiredLevel = 'expected';
  let availability = 'expected';
  if (normalizedGroup === 'editorial') {
    requiredLevel = 'editorial';
    availability = 'editorial_only';
  } else if (normalizedGroup === 'commerce') {
    requiredLevel = 'commerce';
    availability = 'sometimes';
  } else if (normalizedGroup === 'media') {
    requiredLevel = 'optional';
    availability = 'sometimes';
  } else if (normalizedGroup === 'identity') {
    requiredLevel = ['brand', 'model', 'category'].includes(key) ? 'required' : 'expected';
    availability = 'expected';
  }
  return {
    group: normalizedGroup,
    field_key: key,
    display_name: titleCase(key),
    data_type: dataType,
    output_shape: outputShape,
    required_level: requiredLevel,
    availability,
    difficulty: 'easy',
    effort: isScore ? 4 : 3,
    evidence_required: true,
    unknown_reason_default: normalizedGroup === 'editorial'
      ? 'editorial_not_generated'
      : 'not_found_after_search',
    description: `Starter ${normalizedGroup} field`
  };
}

function starterFieldRows({ category, templateName }) {
  const preset = TEMPLATE_PRESETS[templateName] || TEMPLATE_PRESETS.electronics;
  const groups = {
    identity: preset.common_identity || [],
    physical: preset.common_physical || [],
    connectivity: preset.common_connectivity || [],
    performance: [],
    features: [],
    editorial: preset.common_editorial || [],
    commerce: preset.common_commerce || [],
    media: preset.common_media || []
  };
  const rows = [];
  for (const [group, fields] of Object.entries(groups)) {
    for (const fieldKey of fields) {
      rows.push(starterFieldDefinition({ group, fieldKey }));
    }
  }
  rows.push({
    group: 'performance',
    field_key: '',
    display_name: '',
    data_type: '',
    output_shape: '',
    required_level: '',
    availability: '',
    difficulty: '',
    effort: '',
    evidence_required: '',
    unknown_reason_default: '',
    description: `Add category-specific performance fields for '${category}'`
  });
  rows.push({
    group: 'features',
    field_key: '',
    display_name: '',
    data_type: '',
    output_shape: '',
    required_level: '',
    availability: '',
    difficulty: '',
    effort: '',
    evidence_required: '',
    unknown_reason_default: '',
    description: `Add category-specific feature fields for '${category}'`
  });
  return rows;
}

async function writeStarterFieldCatalogWorkbook({
  workbookPath,
  category,
  templateName
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Spec Factory';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('field_catalog');
  ws.columns = [
    { header: 'group', key: 'group', width: 18 },
    { header: 'field_key', key: 'field_key', width: 28 },
    { header: 'display_name', key: 'display_name', width: 28 },
    { header: 'data_type', key: 'data_type', width: 14 },
    { header: 'output_shape', key: 'output_shape', width: 14 },
    { header: 'required_level', key: 'required_level', width: 16 },
    { header: 'availability', key: 'availability', width: 16 },
    { header: 'difficulty', key: 'difficulty', width: 12 },
    { header: 'effort', key: 'effort', width: 10 },
    { header: 'evidence_required', key: 'evidence_required', width: 18 },
    { header: 'unknown_reason_default', key: 'unknown_reason_default', width: 28 },
    { header: 'description', key: 'description', width: 40 }
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:L1';
  for (const row of starterFieldRows({ category, templateName })) {
    ws.addRow(row);
  }

  const guide = workbook.addWorksheet('instructions');
  guide.addRow(['Spec Factory Field Catalog Starter']);
  guide.addRow([`Category: ${category}`]);
  guide.addRow([`Template: ${templateName}`]);
  guide.addRow(['Edit rows in "field_catalog". Do not rename header columns.']);
  guide.addRow(['Leave evidence_required=true for strict evidence-first operation.']);
  guide.getRow(1).font = { bold: true };

  await fs.mkdir(path.dirname(workbookPath), { recursive: true });
  await workbook.xlsx.writeFile(workbookPath);
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
  const starterWorkbookPath = path.join(sourceRoot, 'field_catalog.xlsx');
  if (!(await fileExists(starterWorkbookPath))) {
    await writeStarterFieldCatalogWorkbook({
      workbookPath: starterWorkbookPath,
      category: normalizedCategory,
      templateName
    });
    createdFiles.push(starterWorkbookPath);
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

function toSafeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCategoryList(values = []) {
  return [...new Set(toArray(values)
    .map((value) => normalizeFieldKey(value))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export async function discoverCompileCategories({
  config = {}
} = {}) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  let entries = [];
  try {
    entries = await fs.readdir(helperRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        helper_root: helperRoot,
        categories: []
      };
    }
    throw error;
  }

  const categories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const category = normalizeFieldKey(entry.name);
    if (!category) {
      continue;
    }
    const categoryRoot = path.join(helperRoot, category);
    const hasWorkbookMap = await fileExists(path.join(categoryRoot, '_control_plane', 'workbook_map.json'));
    const hasGeneratedRules = await fileExists(path.join(categoryRoot, '_generated', 'field_rules.json'));
    const sourceRoot = path.join(categoryRoot, '_source');
    const hasWorkbook = await fileExists(path.join(categoryRoot, `${category}Data.xlsm`))
      || await fileExists(path.join(categoryRoot, `${category}Data.xlsx`))
      || await fileExists(path.join(sourceRoot, 'field_catalog.xlsx'));
    if (hasWorkbookMap || hasGeneratedRules || hasWorkbook) {
      categories.push(category);
    }
  }

  categories.sort((a, b) => a.localeCompare(b));
  return {
    helper_root: helperRoot,
    categories
  };
}

export async function compileRulesAll({
  categories = [],
  config = {},
  dryRun = false,
  workbookPathByCategory = {},
  workbookMapByCategory = {},
  mapPathByCategory = {}
} = {}) {
  const discovered = await discoverCompileCategories({ config });
  const selectedCategories = normalizeCategoryList(
    categories.length > 0 ? categories : discovered.categories
  );
  if (selectedCategories.length === 0) {
    return {
      compiled: true,
      dry_run: dryRun,
      categories: [],
      count: 0,
      error_count: 0,
      warning_count: 0
    };
  }

  const results = [];
  for (const category of selectedCategories) {
    const startedAt = Date.now();
    const result = await compileRules({
      category,
      workbookPath: String(workbookPathByCategory?.[category] || '').trim(),
      workbookMap: workbookMapByCategory?.[category] || null,
      dryRun,
      config,
      mapPath: String(mapPathByCategory?.[category] || '').trim() || null
    });
    results.push({
      ...result,
      duration_ms: Math.max(0, Date.now() - startedAt)
    });
  }

  const compileFailures = results.filter((row) => row.compiled !== true);
  const warningCount = results.reduce((sum, row) => sum + toArray(row.warnings).length, 0);
  const changedCategories = results
    .filter((row) => row.dry_run === true && row.would_change === true)
    .map((row) => row.category);

  return {
    compiled: compileFailures.length === 0,
    dry_run: dryRun,
    helper_root: discovered.helper_root,
    categories: selectedCategories,
    count: selectedCategories.length,
    error_count: compileFailures.length,
    warning_count: warningCount,
    changed_categories: changedCategories,
    results
  };
}

function classifyRulesDiffFromReport(compileReport = {}) {
  const fieldDiff = isObject(compileReport?.diff?.fields) ? compileReport.diff.fields : {};
  const removedCount = toSafeInt(fieldDiff.removed_count, 0);
  const changedCount = toSafeInt(fieldDiff.changed_count, 0);
  const addedCount = toSafeInt(fieldDiff.added_count, 0);
  const severity = removedCount > 0
    ? 'breaking'
    : (changedCount > 0 ? 'potentially_breaking' : 'safe');
  const breaking = removedCount > 0;
  return {
    severity,
    breaking,
    summary: {
      added_fields: addedCount,
      changed_fields: changedCount,
      removed_fields: removedCount
    }
  };
}

export async function readCompileReport({
  category,
  config = {}
}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const reportPath = path.join(helperRoot, normalizedCategory, '_generated', '_compile_report.json');
  const report = await readJsonIfExists(reportPath);
  return {
    category: normalizedCategory,
    report_path: reportPath,
    exists: Boolean(report),
    report: isObject(report) ? report : {}
  };
}

export async function rulesDiff({
  category,
  config = {}
}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const [dryRun, currentReport] = await Promise.all([
    compileRules({
      category: normalizedCategory,
      dryRun: true,
      config
    }),
    readCompileReport({
      category: normalizedCategory,
      config
    })
  ]);
  const classification = classifyRulesDiffFromReport(currentReport.report || {});
  return {
    category: normalizedCategory,
    would_change: dryRun.would_change === true,
    changes: toArray(dryRun.changes),
    dry_run: dryRun,
    current_compile_report: currentReport,
    classification
  };
}

export async function watchCompileRules({
  category,
  config = {},
  workbookPath = '',
  workbookMap = null,
  mapPath = null,
  debounceMs = 500,
  watchSeconds = 0,
  maxEvents = 0,
  onEvent = null
}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const chokidar = (await import('chokidar')).default;
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoryRoot = path.join(helperRoot, normalizedCategory);
  const sourceRoot = path.join(categoryRoot, '_source');
  const controlRoot = path.join(categoryRoot, '_control_plane');
  const workbookCandidates = [
    path.join(categoryRoot, `${normalizedCategory}Data.xlsm`),
    path.join(categoryRoot, `${normalizedCategory}Data.xlsx`)
  ];
  const watchTargets = [];
  if (await fileExists(sourceRoot)) {
    watchTargets.push(sourceRoot);
  }
  if (await fileExists(controlRoot)) {
    watchTargets.push(controlRoot);
  }
  for (const candidate of workbookCandidates) {
    if (await fileExists(candidate)) {
      watchTargets.push(candidate);
    }
  }
  if (watchTargets.length === 0) {
    watchTargets.push(categoryRoot);
  }

  const effectiveDebounce = Math.max(50, toSafeInt(debounceMs, 500));
  const effectiveMaxEvents = Math.max(0, toSafeInt(maxEvents, 0));
  const effectiveWatchSeconds = Math.max(0, toSafeInt(watchSeconds, 0));

  const events = [];
  let compileCount = 0;
  let closed = false;
  let compileInFlight = false;
  let suppressUntil = 0;
  let pendingReason = '';
  let pendingTimer = null;
  let doneResolve = null;
  let doneReject = null;

  const donePromise = new Promise((resolve, reject) => {
    doneResolve = resolve;
    doneReject = reject;
  });

  const cleanupHandlers = [];
  async function emitEvent(row) {
    events.push(row);
    if (typeof onEvent === 'function') {
      await onEvent(row);
    }
  }

  async function shutdown(reason = 'stopped') {
    if (closed) {
      return;
    }
    closed = true;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    for (const [signal, handler] of cleanupHandlers) {
      process.off(signal, handler);
    }
    await watcher.close();
    doneResolve({
      category: normalizedCategory,
      watch_targets: watchTargets,
      reason,
      compile_count: compileCount,
      events
    });
  }

  async function runCompile(trigger = 'change') {
    if (closed || compileInFlight) {
      return;
    }
    compileInFlight = true;
    const startedAt = Date.now();
    try {
      const result = await compileRules({
        category: normalizedCategory,
        workbookPath,
        workbookMap,
        config,
        mapPath
      });
      compileCount += 1;
      suppressUntil = Date.now() + Math.max(300, effectiveDebounce);
      await emitEvent({
        trigger,
        category: normalizedCategory,
        compile_index: compileCount,
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        compiled: result.compiled === true,
        warnings: toArray(result.warnings),
        errors: toArray(result.errors)
      });
      if (effectiveMaxEvents > 0 && compileCount >= effectiveMaxEvents) {
        await shutdown('max_events_reached');
      }
    } catch (error) {
      await emitEvent({
        trigger,
        category: normalizedCategory,
        compile_index: compileCount + 1,
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        compiled: false,
        errors: [String(error?.message || error)]
      });
      await shutdown('compile_failed');
      doneReject(error);
      return;
    } finally {
      compileInFlight = false;
    }
  }

  function scheduleCompile(reason = '') {
    pendingReason = String(reason || 'change');
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      runCompile(pendingReason).catch((error) => {
        doneReject(error);
      });
    }, effectiveDebounce);
  }

  const watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    },
    ignored: [
      /[\\/]_generated[\\/]/,
      /[\\/]_control_plane[\\/]_versions[\\/]/
    ]
  });

  watcher.on('all', (eventName, changedPath) => {
    if (closed) {
      return;
    }
    const now = Date.now();
    if (now < suppressUntil) {
      return;
    }
    scheduleCompile(`${eventName}:${changedPath}`);
  });
  watcher.on('error', (error) => {
    if (closed) {
      return;
    }
    doneReject(error);
    shutdown('watcher_error').catch(() => {});
  });

  const sigIntHandler = () => {
    shutdown('signal_sigint').catch(() => {});
  };
  const sigTermHandler = () => {
    shutdown('signal_sigterm').catch(() => {});
  };
  process.on('SIGINT', sigIntHandler);
  process.on('SIGTERM', sigTermHandler);
  cleanupHandlers.push(['SIGINT', sigIntHandler], ['SIGTERM', sigTermHandler]);

  await runCompile('initial');
  if (!closed && effectiveWatchSeconds > 0) {
    setTimeout(() => {
      shutdown('watch_timeout').catch(() => {});
    }, effectiveWatchSeconds * 1000);
  }

  return donePromise;
}
