import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  compileCategoryWorkbook,
  introspectWorkbook,
  saveWorkbookMap,
  validateWorkbookMap
} from '../src/ingest/categoryCompile.js';

function mouseWorkbookPath() {
  return path.resolve('helper_files', 'mouse', 'mouseData.xlsm');
}

function buildMouseWorkbookMap(workbookPath) {
  return {
    version: 1,
    workbook_path: workbookPath,
    sheet_roles: [
      { sheet: 'dataEntry', role: 'product_table' },
      { sheet: 'dataEntry', role: 'field_key_list' }
    ],
    key_list: {
      sheet: 'dataEntry',
      source: 'column_range',
      column: 'B',
      row_start: 9,
      row_end: 83
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
      expected_easy_fields: ['side_buttons'],
      expected_sometimes_fields: ['sensor'],
      deep_fields: ['release_date']
    },
    enum_lists: [],
    component_sheets: [],
    field_overrides: {}
  };
}

function assertSubsetDeep(expected, actual, pathLabel = 'root') {
  if (Array.isArray(expected)) {
    assert.equal(Array.isArray(actual), true, `${pathLabel} expected array`);
    assert.equal(actual.length, expected.length, `${pathLabel} length mismatch`);
    for (let index = 0; index < expected.length; index += 1) {
      assertSubsetDeep(expected[index], actual[index], `${pathLabel}[${index}]`);
    }
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.equal(Boolean(actual) && typeof actual === 'object', true, `${pathLabel} expected object`);
    for (const key of Object.keys(expected)) {
      assert.equal(Object.prototype.hasOwnProperty.call(actual, key), true, `${pathLabel}.${key} missing`);
      assertSubsetDeep(expected[key], actual[key], `${pathLabel}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, `${pathLabel} mismatch`);
}

test('validateWorkbookMap reports key_list errors', () => {
  const checked = validateWorkbookMap({
    version: 1,
    sheet_roles: [],
    key_list: {
      sheet: '',
      source: 'column_range'
    }
  });
  assert.equal(checked.valid, false);
  assert.equal(
    checked.errors.some((row) => String(row).includes('key_list')),
    true
  );
});

test('validateWorkbookMap accepts named_range key source', () => {
  const checked = validateWorkbookMap({
    version: 1,
    sheet_roles: [{ sheet: 'dataEntry', role: 'field_key_list' }],
    key_list: {
      sheet: 'dataEntry',
      source: 'named_range',
      named_range: 'MouseKeys'
    }
  }, {
    sheetNames: ['dataEntry']
  });
  assert.equal(checked.valid, true);
});

test('introspectWorkbook returns sheet metadata for mouse workbook fixture', async () => {
  const introspection = await introspectWorkbook({
    workbookPath: mouseWorkbookPath(),
    previewRows: 8,
    previewCols: 6
  });
  assert.equal(introspection.sheet_count > 0, true);
  assert.equal(Array.isArray(introspection.sheets), true);
  assert.equal(
    introspection.sheets.some((sheet) => String(sheet.name).toLowerCase() === 'dataentry'),
    true
  );
});

test('compileCategoryWorkbook writes deterministic generated artifacts', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-category-compile-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  await fs.mkdir(path.join(helperRoot, 'mouse'), { recursive: true });
  const workbookPath = mouseWorkbookPath();
  const workbookMap = buildMouseWorkbookMap(workbookPath);

  try {
    const saved = await saveWorkbookMap({
      category: 'mouse',
      workbookMap,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(Boolean(saved.file_path), true);

    const first = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(first.compiled, true);
    assert.equal(first.field_count > 20, true);

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    const controlRoot = path.join(helperRoot, 'mouse', '_control_plane');
    const suggestionsRoot = path.join(helperRoot, 'mouse', '_suggestions');
    const fieldRulesPath = path.join(generatedRoot, 'field_rules.json');
    const fieldRulesRuntimePath = path.join(generatedRoot, 'field_rules.runtime.json');
    const knownValuesPath = path.join(generatedRoot, 'known_values.json');
    const uiCatalogPath = path.join(generatedRoot, 'ui_field_catalog.json');
    const componentRoot = path.join(generatedRoot, 'component_db');
    assert.equal(await fs.stat(fieldRulesPath).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(fieldRulesRuntimePath).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(knownValuesPath).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(uiCatalogPath).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(controlRoot, 'field_rules.full.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(suggestionsRoot, 'enums.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(suggestionsRoot, 'components.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(suggestionsRoot, 'lexicon.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(suggestionsRoot, 'constraints.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(componentRoot, 'sensors.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(componentRoot, 'switches.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(componentRoot, 'encoders.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(componentRoot, 'materials.json')).then(() => true).catch(() => false), true);

    const firstFieldRulesRaw = await fs.readFile(fieldRulesPath, 'utf8');
    const firstFieldRulesRuntimeRaw = await fs.readFile(fieldRulesRuntimePath, 'utf8');
    const firstKnownValuesRaw = await fs.readFile(knownValuesPath, 'utf8');
    const firstUiCatalogRaw = await fs.readFile(uiCatalogPath, 'utf8');
    assert.equal(firstFieldRulesRuntimeRaw, firstFieldRulesRaw);
    const firstKnownValues = JSON.parse(firstKnownValuesRaw);
    assert.equal(typeof firstKnownValues.fields, 'object');
    assert.equal((first.compile_report?.counts?.component_types || 0) > 0, true);
    assert.equal((first.compile_report?.source_summary?.enum_lists || 0) > 0, true);
    assert.equal(first.compile_report?.artifacts?.field_rules_runtime?.identical_to_field_rules, true);
    assert.equal(typeof first.compile_report?.diff?.fields?.changed_count, 'number');

    const second = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(second.compiled, true);

    const secondFieldRulesRaw = await fs.readFile(fieldRulesPath, 'utf8');
    const secondFieldRulesRuntimeRaw = await fs.readFile(fieldRulesRuntimePath, 'utf8');
    const secondKnownValuesRaw = await fs.readFile(knownValuesPath, 'utf8');
    const secondUiCatalogRaw = await fs.readFile(uiCatalogPath, 'utf8');

    assert.equal(secondFieldRulesRaw, firstFieldRulesRaw);
    assert.equal(secondFieldRulesRuntimeRaw, firstFieldRulesRaw);
    assert.equal(secondKnownValuesRaw, firstKnownValuesRaw);
    assert.equal(secondUiCatalogRaw, firstUiCatalogRaw);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('compileCategoryWorkbook bootstraps generated artifacts from workbook + tooltip bank when field_rules.json is absent', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-category-compile-bootstrap-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  const categoryRoot = path.join(helperRoot, 'mouse');
  await fs.mkdir(categoryRoot, { recursive: true });
  const sourceWorkbookPath = mouseWorkbookPath();
  const localWorkbookPath = path.join(categoryRoot, 'mouseData.xlsm');
  await fs.copyFile(sourceWorkbookPath, localWorkbookPath);

  const sourceTooltipPath = path.resolve('helper_files', 'mouse', 'hbs_tooltipsMouse.js');
  try {
    await fs.access(sourceTooltipPath);
    await fs.copyFile(sourceTooltipPath, path.join(categoryRoot, 'hbs_tooltipsMouse.js'));
  } catch {
    // tooltip bank is optional; compile should still succeed.
  }

  const workbookMap = buildMouseWorkbookMap(localWorkbookPath);
  try {
    await saveWorkbookMap({
      category: 'mouse',
      workbookMap,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    const result = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath: localWorkbookPath,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(result.compiled, true);
    assert.equal((result.compile_report?.source_summary?.enum_lists || 0) > 0, true);
    assert.equal((result.compile_report?.source_summary?.component_sheets || 0) > 0, true);

    const generatedRoot = path.join(categoryRoot, '_generated');
    assert.equal(await fs.stat(path.join(generatedRoot, 'field_rules.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(generatedRoot, 'field_rules.runtime.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(generatedRoot, 'ui_field_catalog.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(generatedRoot, 'known_values.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(generatedRoot, '_compile_report.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(generatedRoot, 'component_db', 'sensors.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(generatedRoot, 'component_db', 'switches.json')).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(path.join(categoryRoot, '_control_plane', 'field_rules.full.json')).then(() => true).catch(() => false), true);

    const uiCatalog = JSON.parse(await fs.readFile(path.join(generatedRoot, 'ui_field_catalog.json'), 'utf8'));
    const rows = Array.isArray(uiCatalog.fields) ? uiCatalog.fields : [];
    assert.equal(rows.length >= 75, true);
    assert.equal(
      rows.some((row) => row && typeof row === 'object' && typeof row.label === 'string' && row.label.trim().length > 0),
      true
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('compileCategoryWorkbook hard-fails invalid override contract', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-category-compile-invalid-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  await fs.mkdir(path.join(helperRoot, 'mouse'), { recursive: true });
  const workbookPath = mouseWorkbookPath();
  const workbookMap = buildMouseWorkbookMap(workbookPath);
  workbookMap.field_overrides = {
    connection: {
      type: 'made_up_type'
    }
  };
  try {
    await saveWorkbookMap({
      category: 'mouse',
      workbookMap,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    const result = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(result.compiled, false);
    assert.equal(
      (result.errors || []).some((row) => String(row).includes('invalid type')),
      true
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('compileCategoryWorkbook honors selected_keys scope from workbook map', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-category-compile-selected-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  await fs.mkdir(path.join(helperRoot, 'mouse'), { recursive: true });
  const workbookPath = mouseWorkbookPath();
  const workbookMap = buildMouseWorkbookMap(workbookPath);
  workbookMap.selected_keys = ['connection', 'weight'];

  try {
    await saveWorkbookMap({
      category: 'mouse',
      workbookMap,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    const result = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(result.compiled, true);
    assert.equal(result.selected_key_count, 2);
    assert.equal(result.field_count, 2);

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    const fieldRules = JSON.parse(await fs.readFile(path.join(generatedRoot, 'field_rules.json'), 'utf8'));
    assert.deepEqual(Object.keys(fieldRules.fields).sort(), ['connection', 'weight']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('compileCategoryWorkbook applies workbook_map field_overrides for latency/force fields', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-category-compile-overrides-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  const categoryRoot = path.join(helperRoot, 'mouse');
  await fs.mkdir(categoryRoot, { recursive: true });
  const workbookPath = mouseWorkbookPath();
  const workbookMap = buildMouseWorkbookMap(workbookPath);
  const inlineOverrides = {
    click_latency: {
      priority: { required_level: 'expected', availability: 'sometimes', difficulty: 'hard', effort: 8 },
      contract: { type: 'number', shape: 'scalar', unit: 'ms', rounding: { decimals: 2, mode: 'nearest' }, value_form: 'single' },
      parse: { template: 'number_with_unit', unit: 'ms', unit_accepts: ['ms'], strict_unit_required: true },
      evidence: { required: true, min_evidence_refs: 1, tier_preference: ['tier2', 'tier1', 'tier3'], conflict_policy: 'resolve_by_tier_else_unknown' },
      selection_policy: { source_field: 'click_latency_list' }
    },
    click_latency_list: {
      priority: { required_level: 'optional', availability: 'sometimes', difficulty: 'hard', effort: 9 },
      contract: {
        type: 'object',
        shape: 'list',
        unit: 'ms',
        value_form: 'set',
        object_schema: {
          mode: { type: 'string' },
          ms: { type: 'number' },
          source_host: { type: 'string', required: false },
          method: { type: 'string', required: false }
        }
      },
      parse: { template: 'latency_list_modes_ms' },
      evidence: { required: true, min_evidence_refs: 1, tier_preference: ['tier2', 'tier1', 'tier3'], conflict_policy: 'preserve_all_candidates' }
    },
    sensor_latency_list: {
      priority: { required_level: 'optional', availability: 'sometimes', difficulty: 'hard', effort: 9 },
      contract: {
        type: 'object',
        shape: 'list',
        unit: 'ms',
        value_form: 'set',
        object_schema: {
          mode: { type: 'string' },
          ms: { type: 'number' },
          source_host: { type: 'string', required: false },
          method: { type: 'string', required: false }
        }
      },
      parse: { template: 'latency_list_modes_ms' }
    },
    click_force: {
      priority: { required_level: 'optional', availability: 'rare', difficulty: 'hard', effort: 6 },
      contract: { type: 'number', shape: 'scalar', unit: 'gf', rounding: { decimals: 0, mode: 'nearest' }, value_form: 'single' },
      parse: { template: 'number_with_unit', unit: 'gf', unit_accepts: ['gf', 'g'], strict_unit_required: true }
    }
  };
  workbookMap.field_overrides = inlineOverrides;

  try {
    await saveWorkbookMap({
      category: 'mouse',
      workbookMap,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    const result = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(result.compiled, true);

    const generatedRoot = path.join(categoryRoot, '_generated');
    const fieldRules = JSON.parse(await fs.readFile(path.join(generatedRoot, 'field_rules.json'), 'utf8'));
    for (const [fieldKey, expectedRule] of Object.entries(inlineOverrides)) {
      assert.equal(Object.prototype.hasOwnProperty.call(fieldRules.fields || {}, fieldKey), true, `generated field missing ${fieldKey}`);
      assertSubsetDeep(expectedRule, fieldRules.fields[fieldKey], `field_rules.fields.${fieldKey}`);
    }

    const clickLatency = fieldRules.fields?.click_latency || {};
    const clickLatencyList = fieldRules.fields?.click_latency_list || {};
    const sensorLatencyList = fieldRules.fields?.sensor_latency_list || {};
    const clickForce = fieldRules.fields?.click_force || {};
    assert.equal(clickLatency?.contract?.shape || clickLatency?.shape, 'scalar');
    assert.equal(clickLatencyList?.contract?.shape || clickLatencyList?.shape, 'list');
    assert.equal(clickLatencyList?.parse?.template || clickLatencyList?.parse_template, 'latency_list_modes_ms');
    assert.equal(sensorLatencyList?.parse?.template || sensorLatencyList?.parse_template, 'latency_list_modes_ms');
    assert.equal(clickForce?.contract?.unit || clickForce?.unit, 'gf');
    assert.equal(clickLatency?.selection_policy?.source_field, 'click_latency_list');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('FRC-05-B — buildStudioFieldRule emits constraints for component property fields', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-frc05b-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  await fs.mkdir(path.join(helperRoot, 'mouse'), { recursive: true });
  const workbookPath = mouseWorkbookPath();
  const workbookMap = buildMouseWorkbookMap(workbookPath);
  workbookMap.component_sources = [
    {
      type: 'sensor',
      sheet: 'sensors',
      auto_derive_aliases: true,
      header_row: 1,
      first_data_row: 2,
      stop_after_blank_primary: 10,
      roles: {
        primary_identifier: 'C',
        maker: 'B',
        aliases: [],
        links: ['J'],
        properties: [
          {
            column: 'F',
            field_key: 'dpi',
            type: 'number',
            unit: 'dpi',
            variance_policy: 'upper_bound',
            constraints: []
          },
          {
            column: 'I',
            field_key: 'sensor_date',
            type: 'string',
            unit: '',
            variance_policy: 'authoritative',
            constraints: ['sensor_date <= release_date']
          }
        ]
      }
    }
  ];

  try {
    await saveWorkbookMap({
      category: 'mouse',
      workbookMap,
      config: { helperFilesRoot: helperRoot }
    });
    const result = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath,
      config: { helperFilesRoot: helperRoot }
    });
    assert.equal(result.compiled, true);

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    const fieldRules = JSON.parse(await fs.readFile(path.join(generatedRoot, 'field_rules.json'), 'utf8'));

    const sensorDate = fieldRules.fields?.sensor_date;
    assert.ok(sensorDate, 'sensor_date field should exist in compiled output');
    assert.ok(Array.isArray(sensorDate.constraints),
      'sensor_date.constraints should be an array (buildStudioFieldRule must emit constraints)');
    assert.deepStrictEqual(sensorDate.constraints, ['sensor_date <= release_date'],
      'sensor_date constraints should carry through from workbook_map component_sources');

    const dpi = fieldRules.fields?.dpi;
    assert.ok(dpi, 'dpi field should exist');
    assert.ok(Array.isArray(dpi.constraints),
      'dpi.constraints should be an empty array');
    assert.deepStrictEqual(dpi.constraints, []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('FRC-05-C — buildStudioFieldRule auto-derives property_keys from component_sources', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-frc05c-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  await fs.mkdir(path.join(helperRoot, 'mouse'), { recursive: true });
  const workbookPath = mouseWorkbookPath();
  const workbookMap = buildMouseWorkbookMap(workbookPath);
  workbookMap.component_sources = [
    {
      type: 'sensor',
      sheet: 'sensors',
      auto_derive_aliases: true,
      header_row: 1,
      first_data_row: 2,
      stop_after_blank_primary: 10,
      roles: {
        primary_identifier: 'C',
        maker: 'B',
        aliases: [],
        links: ['J'],
        properties: [
          {
            column: 'F',
            field_key: 'dpi',
            type: 'number',
            unit: 'dpi',
            variance_policy: 'upper_bound',
            constraints: []
          },
          {
            column: 'I',
            field_key: 'sensor_date',
            type: 'string',
            unit: '',
            variance_policy: 'authoritative',
            constraints: ['sensor_date <= release_date']
          }
        ]
      }
    }
  ];

  try {
    await saveWorkbookMap({
      category: 'mouse',
      workbookMap,
      config: { helperFilesRoot: helperRoot }
    });
    const result = await compileCategoryWorkbook({
      category: 'mouse',
      workbookPath,
      config: { helperFilesRoot: helperRoot }
    });
    assert.equal(result.compiled, true);

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    const fieldRules = JSON.parse(await fs.readFile(path.join(generatedRoot, 'field_rules.json'), 'utf8'));

    const sensor = fieldRules.fields?.sensor;
    assert.ok(sensor, 'sensor field should exist in compiled output');
    assert.ok(sensor.component, 'sensor field should have a component block');
    assert.ok(sensor.component.match, 'sensor component should have a match block');
    assert.ok(Array.isArray(sensor.component.match.property_keys),
      'property_keys should be an array');
    assert.ok(sensor.component.match.property_keys.length > 0,
      'property_keys should be auto-derived from component_sources (not empty)');
    assert.deepStrictEqual(
      sensor.component.match.property_keys,
      ['dpi', 'sensor_date'],
      'property_keys should be derived from component_sources[sensor].roles.properties[].field_key'
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('FRC-05-D — compiler coerces string property variance_policy to authoritative', () => {
  const rawMap = {
    component_sources: [
      {
        type: 'sensor',
        sheet: 'sensors',
        header_row: 1,
        first_data_row: 2,
        roles: {
          primary_identifier: 'C',
          maker: 'B',
          aliases: [],
          links: ['J'],
          properties: [
            { column: 'F', field_key: 'dpi', type: 'number', variance_policy: 'upper_bound' },
            { column: 'G', field_key: 'sensor_type', type: 'string', variance_policy: 'upper_bound' },
            { column: 'I', field_key: 'sensor_date', type: 'string', variance_policy: 'range' },
            { column: 'H', field_key: 'detent_type', variance_policy: 'lower_bound' },
          ]
        }
      }
    ]
  };

  const result = validateWorkbookMap(rawMap);

  const warnings = result.warnings || [];
  const coercionWarnings = warnings.filter(w => w.includes('variance_policy') && w.includes('authoritative'));
  assert.ok(coercionWarnings.length >= 3,
    `should have at least 3 coercion warnings for string properties, got ${coercionWarnings.length}: ${JSON.stringify(coercionWarnings)}`);
  assert.ok(coercionWarnings.find(w => w.includes('sensor_type')),
    'should warn about sensor_type string property with upper_bound');
  assert.ok(coercionWarnings.find(w => w.includes('sensor_date')),
    'should warn about sensor_date string property with range');
  assert.ok(coercionWarnings.find(w => w.includes('detent_type')),
    'should warn about detent_type (default string) with lower_bound');

  const normalizedSensor = result.normalized.component_sources[0];
  const props = normalizedSensor.roles.properties;
  const dpiProp = props.find(p => p.field_key === 'dpi');
  const sensorTypeProp = props.find(p => p.field_key === 'sensor_type');
  const sensorDateProp = props.find(p => p.field_key === 'sensor_date');
  const detentTypeProp = props.find(p => p.field_key === 'detent_type');

  assert.equal(dpiProp.variance_policy, 'upper_bound',
    'numeric property should keep upper_bound');
  assert.equal(sensorTypeProp.variance_policy, 'authoritative',
    'string property with upper_bound should be coerced to authoritative');
  assert.equal(sensorDateProp.variance_policy, 'authoritative',
    'string property with range should be coerced to authoritative');
  assert.equal(detentTypeProp.variance_policy, 'authoritative',
    'default string property with lower_bound should be coerced to authoritative');
});
