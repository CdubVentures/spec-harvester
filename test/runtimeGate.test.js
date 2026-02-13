import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../src/engine/runtimeGate.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createEngineFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-gate-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      weight: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'number',
          shape: 'scalar',
          unit: 'g',
          range: { min: 30, max: 200 }
        }
      },
      connection: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        enum_policy: 'closed',
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      },
      dpi: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'number',
          shape: 'scalar'
        }
      },
      coating: {
        required_level: 'optional',
        difficulty: 'medium',
        availability: 'sometimes',
        enum_policy: 'open',
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category: 'mouse',
    enums: {
      connection: {
        policy: 'closed',
        values: [
          { canonical: 'wired', aliases: ['usb wired'] },
          { canonical: 'wireless', aliases: ['2.4ghz'] }
        ]
      },
      coating: {
        policy: 'open',
        values: [
          { canonical: 'matte', aliases: ['matte finish'] }
        ]
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse',
    templates: {}
  });

  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category: 'mouse',
    rules: [
      {
        rule_id: 'dpi_plausibility',
        trigger_field: 'dpi',
        check: {
          type: 'range',
          min: 100,
          max: 30000
        }
      }
    ]
  });

  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.0.0',
    previous_version: '1.0.0',
    bump: 'patch',
    summary: { added_count: 0, removed_count: 0, changed_count: 0 },
    key_map: {},
    migrations: []
  });

  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'weight', group: 'physical' },
      { key: 'connection', group: 'connectivity' },
      { key: 'dpi', group: 'sensor' },
      { key: 'coating', group: 'physical' }
    ]
  });

  return {
    root,
    helperRoot
  };
}

test('applyRuntimeFieldRules normalizes values via engine contracts', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        weight: '3.5 oz',
        connection: 'usb wired',
        dpi: '26000'
      },
      provenance: {},
      fieldOrder: ['weight', 'connection', 'dpi']
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 99.22325);
    assert.equal(result.fields.connection, 'wired');
    assert.equal(result.failures.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules rejects closed enum values outside known set', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        connection: 'satellite'
      },
      provenance: {},
      fieldOrder: ['connection']
    });

    assert.equal(result.fields.connection, 'unk');
    assert.equal(
      result.failures.some((row) => row.field === 'connection' && row.reason_code === 'enum_value_not_allowed'),
      true
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules enforces cross-validation errors', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        dpi: 99000
      },
      provenance: {},
      fieldOrder: ['dpi']
    });

    assert.equal(result.fields.dpi, 'unk');
    assert.equal(
      result.failures.some((row) => row.field === 'dpi' && row.reason_code === 'cross_validation_failed'),
      true
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules can enforce strict evidence audit', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        connection: 'wired'
      },
      provenance: {
        connection: {
          evidence: [
            { url: 'https://example.com/specs' }
          ]
        }
      },
      fieldOrder: ['connection'],
      enforceEvidence: true,
      evidencePack: {
        snippets: []
      }
    });

    assert.equal(result.fields.connection, 'unk');
    assert.equal(
      result.failures.some((row) => row.field === 'connection' && row.reason_code === 'evidence_missing'),
      true
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules reports open-enum curation suggestions', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        coating: 'satin microtexture'
      },
      provenance: {},
      fieldOrder: ['coating']
    });

    assert.equal(result.fields.coating, 'satin microtexture');
    assert.equal(Array.isArray(result.curation_suggestions), true);
    assert.equal(result.curation_suggestions.length, 1);
    assert.equal(result.curation_suggestions[0].field_key, 'coating');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
