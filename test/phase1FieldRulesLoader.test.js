import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCrossValidationRules,
  getFieldRule,
  getKnownValues,
  getParseTemplate,
  loadFieldRules,
  lookupComponent
} from '../src/field-rules/loader.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('loadFieldRules returns assembled artifacts for downstream systems', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-loader-'));
  const helperRoot = path.join(root, 'helper_files');
  try {
    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    await writeJson(path.join(generatedRoot, 'field_rules.json'), {
      category: 'mouse',
      fields: {
        connection: {
          key: 'connection',
          contract: {
            type: 'string'
          }
        }
      }
    });
    await writeJson(path.join(generatedRoot, 'known_values.json'), {
      category: 'mouse',
      enums: {
        connection: {
          policy: 'closed',
          values: [{ canonical: 'wired', aliases: ['usb wired'] }]
        }
      }
    });
    await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
      category: 'mouse',
      templates: {
        connection: {
          patterns: [{ regex: '(wired|wireless)', group: 1 }]
        }
      }
    });
    await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
      category: 'mouse',
      rules: [{ rule_id: 'wireless_battery_required' }]
    });
    await writeJson(path.join(generatedRoot, 'component_db', 'sensors.json'), {
      component_type: 'sensor',
      db_name: 'sensors',
      category: 'mouse',
      entries: {
        PAW3395: {
          canonical_name: 'PAW3395',
          aliases: ['3395']
        }
      }
    });

    const loaded = await loadFieldRules('mouse', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(typeof loaded, 'object');
    assert.equal(typeof loaded.rules, 'object');
    assert.equal(typeof loaded.knownValues, 'object');
    assert.equal(typeof loaded.parseTemplates, 'object');
    assert.equal(Array.isArray(loaded.crossValidation), true);
    assert.equal(typeof loaded.componentDBs, 'object');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('loadFieldRules resolves test_ aliases to canonical _test_ contracts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-loader-test-alias-'));
  const helperRoot = path.join(root, 'helper_files');
  try {
    const generatedRoot = path.join(helperRoot, '_test_mouse', '_generated');
    await writeJson(path.join(generatedRoot, 'field_rules.json'), {
      category: '_test_mouse',
      fields: {
        sensor: {
          key: 'sensor',
          contract: { type: 'string' }
        }
      }
    });

    const loaded = await loadFieldRules('test_mouse', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(loaded.category, '_test_mouse');
    assert.equal(Boolean(loaded.rules?.fields?.sensor), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('getFieldRule/getKnownValues/getParseTemplate/getCrossValidationRules expose targeted selectors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-loader-selectors-'));
  const helperRoot = path.join(root, 'helper_files');
  try {
    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    await writeJson(path.join(generatedRoot, 'field_rules.json'), {
      category: 'mouse',
      fields: {
        connection: {
          key: 'connection',
          contract: {
            type: 'string'
          }
        }
      }
    });
    await writeJson(path.join(generatedRoot, 'known_values.json'), {
      category: 'mouse',
      fields: {
        connection: ['wired', 'wireless']
      }
    });
    await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
      category: 'mouse',
      templates: {
        connection: {
          patterns: [{ regex: '(wired|wireless)', group: 1 }]
        }
      }
    });
    await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
      category: 'mouse',
      rules: [{ rule_id: 'rule_a' }, { rule_id: 'rule_b' }]
    });
    await writeJson(path.join(generatedRoot, 'component_db', 'sensors.json'), {
      component_type: 'sensor',
      items: [{ name: 'PAW3395', aliases: ['3395'] }]
    });

    const fieldRule = await getFieldRule('mouse', 'connection', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(fieldRule?.key, 'connection');

    const knownValues = await getKnownValues('mouse', 'connection', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(knownValues?.policy, 'open');
    assert.deepEqual(knownValues?.values || [], ['wired', 'wireless']);

    const parseTemplate = await getParseTemplate('mouse', 'connection', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(Array.isArray(parseTemplate?.patterns), true);

    const rules = await getCrossValidationRules('mouse', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(rules.length, 2);
    assert.equal(rules[0].rule_id, 'rule_a');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('lookupComponent resolves by canonical and alias tokens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-loader-lookup-'));
  const helperRoot = path.join(root, 'helper_files');
  try {
    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    await writeJson(path.join(generatedRoot, 'field_rules.json'), {
      category: 'mouse',
      fields: {}
    });
    await writeJson(path.join(generatedRoot, 'known_values.json'), {
      category: 'mouse',
      enums: {}
    });
    await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
      category: 'mouse',
      templates: {}
    });
    await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
      category: 'mouse',
      rules: []
    });
    await writeJson(path.join(generatedRoot, 'component_db', 'sensors.json'), {
      component_type: 'sensor',
      db_name: 'sensors',
      entries: {
        PAW3395: {
          canonical_name: 'PAW3395',
          aliases: ['3395', 'pixart 3395'],
          brand: 'PixArt'
        }
      }
    });

    const byCanonical = await lookupComponent('mouse', 'sensor', 'PAW3395', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(byCanonical?.canonical_name, 'PAW3395');

    const byAlias = await lookupComponent('mouse', 'sensor', 'pixart 3395', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(byAlias?.canonical_name, 'PAW3395');

    const missing = await lookupComponent('mouse', 'sensor', 'not-a-sensor', {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(missing, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
