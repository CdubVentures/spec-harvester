import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createEngineFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase3-engine-'));
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
          range: {
            min: 30,
            max: 200
          }
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
      battery_hours: {
        required_level: 'expected',
        difficulty: 'medium',
        availability: 'sometimes',
        contract: {
          type: 'number',
          shape: 'scalar',
          range: { min: 1, max: 400 }
        }
      },
      sensor: {
        required_level: 'critical',
        difficulty: 'easy',
        availability: 'always',
        component_db_ref: 'sensor',
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
          {
            canonical: 'wired',
            aliases: ['usb wired']
          },
          {
            canonical: 'wireless',
            aliases: ['2.4ghz']
          },
          {
            canonical: 'bluetooth',
            aliases: ['bt']
          }
        ]
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse',
    templates: {
      weight: {
        patterns: [{ regex: '([\\d.]+)\\s*(g|oz)', group: 1 }]
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category: 'mouse',
    rules: [
      {
        rule_id: 'wireless_battery_required',
        trigger_field: 'connection',
        condition: "connection IN ['wireless','bluetooth']",
        requires_field: 'battery_hours',
        on_fail: 'set_unknown_with_reason'
      }
    ]
  });

  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.2.0',
    previous_version: '1.1.0',
    bump: 'minor',
    summary: {
      added_count: 1,
      removed_count: 0,
      changed_count: 0
    },
    key_map: {
      mouse_side_connector: 'connection'
    },
    migrations: [
      {
        type: 'rename',
        from: 'mouse_side_connector',
        to: 'connection',
        reason: 'generalize connector naming'
      }
    ]
  });

  await writeJson(path.join(generatedRoot, 'component_db', 'sensors.json'), {
    component_type: 'sensor',
    db_name: 'sensors',
    entries: {
      PAW3395: {
        canonical_name: 'PAW3395',
        aliases: ['pixart 3395'],
        properties: {
          max_dpi: 26000
        }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'weight', group: 'physical' },
      { key: 'connection', group: 'connectivity' },
      { key: 'battery_hours', group: 'connectivity' },
      { key: 'sensor', group: 'sensor' }
    ]
  });

  return {
    root,
    helperRoot
  };
}

async function createAdvancedEngineFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase3-engine-advanced-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      sensor: {
        required_level: 'critical',
        difficulty: 'easy',
        availability: 'always',
        component_db_ref: 'sensor',
        contract: { type: 'component_ref', shape: 'scalar' }
      },
      dpi: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'number', shape: 'scalar', range: { min: 100, max: 50000 } }
      },
      spec_url: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'sometimes',
        contract: { type: 'url', shape: 'scalar' }
      },
      coating: {
        required_level: 'optional',
        difficulty: 'medium',
        availability: 'sometimes',
        enum_policy: 'open',
        contract: { type: 'string', shape: 'scalar' }
      },
      lngth: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'number', shape: 'scalar', unit: 'mm' }
      },
      width: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'number', shape: 'scalar', unit: 'mm' }
      },
      height: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'number', shape: 'scalar', unit: 'mm' }
      },
      connection: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'string', shape: 'scalar' }
      },
      battery_hours: {
        required_level: 'expected',
        difficulty: 'medium',
        availability: 'sometimes',
        contract: { type: 'number', shape: 'scalar', range: { min: 1, max: 400 } }
      },
      polling_rates: {
        required_level: 'optional',
        difficulty: 'easy',
        availability: 'sometimes',
        contract: {
          type: 'integer',
          shape: 'list',
          normalization_fn: 'parse_polling_list'
        }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category: 'mouse',
    enums: {
      coating: {
        policy: 'open',
        values: [
          { canonical: 'matte', aliases: ['matte finish'] },
          { canonical: 'glossy', aliases: ['gloss'] }
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
        rule_id: 'sensor_dpi_limit',
        trigger_field: 'dpi',
        check: {
          type: 'component_db_lookup',
          db: 'sensor',
          lookup_field: 'sensor',
          compare_field: 'max_dpi',
          tolerance_percent: 0
        }
      },
      {
        rule_id: 'dimensions_triplet',
        trigger_field: 'lngth',
        check: {
          type: 'group_completeness',
          minimum_present: 3
        },
        related_fields: ['lngth', 'width', 'height']
      },
      {
        rule_id: 'wired_has_no_battery',
        trigger_field: 'connection',
        condition: "connection IN ['wired']",
        check: {
          type: 'mutual_exclusion'
        },
        related_fields: ['battery_hours']
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

  await writeJson(path.join(generatedRoot, 'component_db', 'sensors.json'), {
    component_type: 'sensor',
    db_name: 'sensors',
    entries: {
      PAW3395: {
        canonical_name: 'PAW3395',
        aliases: ['pixart 3395'],
        properties: {
          max_dpi: 26000
        }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'sensor', group: 'sensor' },
      { key: 'dpi', group: 'sensor' },
      { key: 'spec_url', group: 'identity' },
      { key: 'coating', group: 'physical' }
    ]
  });

  return {
    root,
    helperRoot
  };
}

test('FieldRulesEngine.create loads artifacts and exposes metadata selectors', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: {
        helperFilesRoot: fixture.helperRoot
      }
    });
    const keys = engine.getAllFieldKeys();
    assert.deepEqual(keys.sort(), ['battery_hours', 'connection', 'sensor', 'weight']);
    assert.equal(engine.getRequiredFields().length >= 2, true);
    assert.equal(engine.getCriticalFields().length, 1);
    assert.equal(engine.getFieldsByGroup('connectivity').length, 2);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('normalizeCandidate converts units and enforces range', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const ok = engine.normalizeCandidate('weight', '3.5 oz');
    assert.equal(ok.ok, true);
    assert.equal(Math.round(ok.normalized), 99);

    const outOfRange = engine.normalizeCandidate('weight', '500 g');
    assert.equal(outOfRange.ok, false);
    assert.equal(outOfRange.reason_code, 'out_of_range');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('enforceEnumPolicy supports alias resolution and closed-policy rejection', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const aliased = engine.enforceEnumPolicy('connection', 'usb wired');
    assert.equal(aliased.ok, true);
    assert.equal(aliased.canonical_value, 'wired');
    assert.equal(aliased.was_aliased, true);

    const rejected = engine.enforceEnumPolicy('connection', 'satellite');
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason_code, 'enum_value_not_allowed');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('auditEvidence enforces url/snippet/quote and snippet text match', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const missing = engine.auditEvidence('weight', 54, {
      url: 'https://example.com/specs'
    });
    assert.equal(missing.ok, false);

    const mismatch = engine.auditEvidence(
      'weight',
      54,
      {
        url: 'https://example.com/specs',
        snippet_id: 's1',
        quote: '54 grams'
      },
      {
        evidencePack: {
          snippets: {
            s1: {
              text: 'The mouse weighs 58 grams.'
            }
          }
        }
      }
    );
    assert.equal(mismatch.ok, false);

    const ok = engine.auditEvidence(
      'weight',
      54,
      {
        url: 'https://example.com/specs',
        snippet_id: 's1',
        quote: '54 grams'
      },
      {
        evidencePack: {
          snippets: {
            s1: {
              text: 'Official specs list weight as 54 grams.'
            }
          }
        }
      }
    );
    assert.equal(ok.ok, true);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyKeyMigrations rewrites legacy keys and normalizeFullRecord produces unknowns', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const migrated = engine.applyKeyMigrations({
      mouse_side_connector: 'wired'
    });
    assert.equal(migrated.connection, 'wired');
    assert.equal(migrated.mouse_side_connector, undefined);

    const normalized = engine.normalizeFullRecord(
      {
        mouse_side_connector: 'wireless',
        weight: '54 g'
      },
      {
        provenanceByField: {
          weight: {
            url: 'https://example.com/specs',
            snippet_id: 's1',
            quote: '54 g'
          },
          connection: {
            url: 'https://example.com/specs',
            snippet_id: 's2',
            quote: 'wireless'
          }
        },
        evidencePack: {
          snippets: {
            s1: { text: 'Weight: 54 g' },
            s2: { text: 'Connection mode is wireless.' }
          }
        }
      }
    );
    assert.equal(normalized.normalized.weight, 54);
    assert.equal(normalized.normalized.connection, 'wireless');
    assert.equal(normalized.normalized.battery_hours?.value, 'unk');
    assert.equal(normalized.unknowns.some((row) => row.field_key === 'battery_hours'), true);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('normalizeCandidate validates url fields and resolves component_ref aliases', async () => {
  const fixture = await createAdvancedEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });

    const okUrl = engine.normalizeCandidate('spec_url', 'https://example.com/specs');
    assert.equal(okUrl.ok, true);
    assert.equal(okUrl.normalized, 'https://example.com/specs');

    const badUrl = engine.normalizeCandidate('spec_url', 'not a url');
    assert.equal(badUrl.ok, false);
    assert.equal(badUrl.reason_code, 'url_required');

    const sensor = engine.normalizeCandidate('sensor', 'pixart 3395');
    assert.equal(sensor.ok, true);
    assert.equal(sensor.normalized, 'PAW3395');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('normalizeCandidate reports curation signal for open enums', async () => {
  const fixture = await createAdvancedEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const curationQueue = [];
    const row = engine.normalizeCandidate('coating', 'satin microtexture', { curationQueue });
    assert.equal(row.ok, true);
    assert.equal(row.normalized, 'satin microtexture');
    assert.equal(curationQueue.length, 1);
    assert.equal(curationQueue[0].field_key, 'coating');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('crossValidate supports component lookup, group completeness, and mutual exclusion checks', async () => {
  const fixture = await createAdvancedEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });

    const componentViolation = engine.crossValidate('dpi', 30000, {
      sensor: 'PAW3395',
      dpi: 30000
    });
    assert.equal(componentViolation.ok, false);
    assert.equal(componentViolation.violations.some((row) => row.rule === 'sensor_dpi_limit'), true);

    const groupWarning = engine.crossValidate('lngth', 120, {
      lngth: 120,
      width: 65,
      height: 'unk'
    });
    assert.equal(groupWarning.ok, false);
    assert.equal(groupWarning.violations.some((row) => row.rule === 'dimensions_triplet'), true);

    const exclusion = engine.crossValidate('connection', 'wired', {
      connection: 'wired',
      battery_hours: 120
    });
    assert.equal(exclusion.ok, false);
    assert.equal(exclusion.violations.some((row) => row.rule === 'wired_has_no_battery'), true);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('auditEvidence strict mode validates source_id/snippet_hash/quote_span/retrieved_at/extraction_method', async () => {
  const fixture = await createAdvancedEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const bad = engine.auditEvidence(
      'sensor',
      'PAW3395',
      {
        url: 'https://example.com/specs',
        snippet_id: 's1',
        quote: 'PAW3395'
      },
      {
        strictEvidence: true,
        evidencePack: {
          snippets: {
            s1: {
              text: 'Sensor is PAW3395.',
              snippet_hash: 'sha256:good'
            }
          }
        }
      }
    );
    assert.equal(bad.ok, false);

    const ok = engine.auditEvidence(
      'sensor',
      'PAW3395',
      {
        url: 'https://example.com/specs',
        source_id: 'example_com',
        snippet_id: 's1',
        snippet_hash: 'sha256:good',
        quote: 'PAW3395',
        quote_span: [10, 17],
        retrieved_at: '2026-02-12T10:30:00Z',
        extraction_method: 'spec_table_match'
      },
      {
        strictEvidence: true,
        evidencePack: {
          snippets: {
            s1: {
              text: 'Sensor is PAW3395.',
              snippet_hash: 'sha256:good'
            }
          }
        }
      }
    );
    assert.equal(ok.ok, true);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('normalizeCandidate applies normalization_fn for polling list fields', async () => {
  const fixture = await createAdvancedEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const row = engine.normalizeCandidate('polling_rates', '1000, 4000, 2000,1000');
    assert.equal(row.ok, true);
    assert.deepEqual(row.normalized, [4000, 2000, 1000]);
    assert.equal(row.applied_rules.includes('fn:parse_polling_list'), true);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('normalizeFullRecord is deterministic across repeated runs', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const input = {
      mouse_side_connector: 'wireless',
      weight: '3.5 oz'
    };
    const context = {
      provenanceByField: {
        weight: {
          url: 'https://example.com/specs',
          snippet_id: 's1',
          quote: '3.5 oz'
        },
        connection: {
          url: 'https://example.com/specs',
          snippet_id: 's2',
          quote: 'wireless'
        }
      },
      evidencePack: {
        snippets: {
          s1: { text: 'Weight is listed as 3.5 oz.' },
          s2: { text: 'Connection mode is wireless.' }
        }
      }
    };
    const first = engine.normalizeFullRecord(input, context);
    const second = engine.normalizeFullRecord(input, context);
    assert.deepEqual(second, first);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
