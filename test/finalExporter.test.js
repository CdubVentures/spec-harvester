import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import { writeFinalOutputs } from '../src/exporter/finalExporter.js';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';

function makeStorage(tempRoot) {
  return createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs'
  });
}

function baseNormalized() {
  return {
    identity: {
      brand: 'Logitech',
      model: 'G Pro X Superlight 2',
      variant: ''
    },
    fields: {
      brand: 'Logitech',
      model: 'G Pro X Superlight 2',
      sensor: 'PAW3395',
      dpi: '32000'
    }
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createEngineFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'final-export-engine-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      connection: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        enum_policy: 'closed',
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
      }
    }
  });
  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse',
    templates: {}
  });
  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category: 'mouse',
    rules: []
  });
  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.0.0',
    previous_version: '1.0.0',
    bump: 'patch',
    summary: { added_count: 0, removed_count: 0, changed_count: 0 },
    key_map: {
      mouse_side_connector: 'connection'
    },
    migrations: [
      {
        type: 'rename',
        from: 'mouse_side_connector',
        to: 'connection'
      }
    ]
  });
  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [{ key: 'connection', group: 'connectivity' }]
  });

  return {
    root,
    helperRoot
  };
}

test('writeFinalOutputs promotes only when summary improves and always appends history', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-final-export-'));
  const storage = makeStorage(tempRoot);

  try {
    const normalized = baseNormalized();
    const provenance = {
      dpi: {
        value: '32000',
        confidence: 0.9,
        evidence: [{ tier: 1, tierName: 'manufacturer', method: 'dom', url: 'https://logitechg.com/specs' }]
      }
    };
    const trafficLight = {
      by_field: {
        dpi: {
          color: 'green'
        }
      },
      counts: {
        green: 1,
        yellow: 0,
        red: 0
      }
    };

    const first = await writeFinalOutputs({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-1',
      normalized,
      provenance,
      trafficLight,
      summary: {
        validated: false,
        confidence: 0.4,
        completeness_required: 0.3,
        coverage_overall: 0.2,
        constraint_analysis: { contradiction_count: 3 },
        missing_required_fields: ['weight']
      },
      sourceResults: []
    });
    assert.equal(first.promoted, true);

    const second = await writeFinalOutputs({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-2',
      normalized,
      provenance,
      trafficLight,
      summary: {
        validated: true,
        confidence: 0.88,
        completeness_required: 0.8,
        coverage_overall: 0.7,
        constraint_analysis: { contradiction_count: 1 },
        missing_required_fields: []
      },
      sourceResults: []
    });
    assert.equal(second.promoted, true);

    const third = await writeFinalOutputs({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-3',
      normalized: {
        ...normalized,
        fields: {
          ...normalized.fields,
          dpi: '12000'
        }
      },
      provenance,
      trafficLight,
      summary: {
        validated: false,
        confidence: 0.2,
        completeness_required: 0.2,
        coverage_overall: 0.1,
        constraint_analysis: { contradiction_count: 5 },
        missing_required_fields: ['weight', 'polling_rate']
      },
      sourceResults: []
    });
    assert.equal(third.promoted, false);

    const finalSpec = await storage.readJson('final/mouse/logitech/g-pro-x-superlight-2/spec.json');
    assert.equal(finalSpec.dpi, '32000');
    const history = await storage.readText('final/mouse/logitech/g-pro-x-superlight-2/history/runs.jsonl');
    assert.equal(history.split(/\r?\n/).filter(Boolean).length, 3);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('writeFinalOutputs applies runtime engine migrations and enum normalization before publish', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-final-export-runtime-'));
  const storage = makeStorage(tempRoot);
  const fixture = await createEngineFixtureRoot();

  try {
    const runtimeEngine = await FieldRulesEngine.create('mouse', {
      config: {
        helperFilesRoot: fixture.helperRoot
      }
    });
    const result = await writeFinalOutputs({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-runtime',
      normalized: {
        identity: {
          brand: 'Logitech',
          model: 'G Pro X Superlight 2',
          variant: ''
        },
        fields: {
          mouse_side_connector: 'usb wired'
        }
      },
      provenance: {},
      trafficLight: {},
      summary: {
        validated: true,
        confidence: 0.9,
        completeness_required: 0.9,
        coverage_overall: 0.9,
        constraint_analysis: { contradiction_count: 0 },
        missing_required_fields: []
      },
      sourceResults: [],
      runtimeEngine,
      runtimeFieldOrder: ['connection']
    });

    assert.equal(result.runtime_gate.applied, true);
    const finalSpec = await storage.readJson('final/mouse/logitech/g-pro-x-superlight-2/spec.json');
    assert.equal(finalSpec.connection, 'wired');
    assert.equal(Object.prototype.hasOwnProperty.call(finalSpec, 'mouse_side_connector'), false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('writeFinalOutputs does not promote when summary is explicitly unpublishable', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-final-export-unpublishable-'));
  const storage = makeStorage(tempRoot);

  try {
    const normalized = baseNormalized();
    const provenance = {};
    const trafficLight = {};

    const blocked = await writeFinalOutputs({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-blocked',
      normalized,
      provenance,
      trafficLight,
      summary: {
        validated: false,
        confidence: 0.97,
        completeness_required: 0.99,
        coverage_overall: 0.99,
        publishable: false,
        publish_blockers: ['MODEL_AMBIGUITY_ALERT'],
        constraint_analysis: { contradiction_count: 0 },
        missing_required_fields: []
      },
      sourceResults: []
    });
    assert.equal(blocked.promoted, false);
    assert.equal(
      await storage.objectExists('final/mouse/logitech/g-pro-x-superlight-2/spec.json'),
      false
    );

    const promoted = await writeFinalOutputs({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-promoted',
      normalized,
      provenance,
      trafficLight,
      summary: {
        validated: true,
        confidence: 0.97,
        completeness_required: 0.99,
        coverage_overall: 0.99,
        publishable: true,
        publish_blockers: [],
        constraint_analysis: { contradiction_count: 0 },
        missing_required_fields: []
      },
      sourceResults: []
    });
    assert.equal(promoted.promoted, true);
    assert.equal(
      await storage.objectExists('final/mouse/logitech/g-pro-x-superlight-2/spec.json'),
      true
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
