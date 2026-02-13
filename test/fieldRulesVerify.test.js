import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyGeneratedFieldRules } from '../src/ingest/fieldRulesVerify.js';

test('verifyGeneratedFieldRules passes when generated file matches golden fixture bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-field-rules-verify-'));
  const helperRoot = path.join(root, 'helper_files');
  const category = 'mouse';
  const generatedPath = path.join(helperRoot, category, '_generated', 'field_rules.json');
  const fixturePath = path.join(root, 'test-fixture.json');
  const payload = {
    version: 1,
    category,
    fields: {
      connection: {
        key: 'connection'
      }
    }
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    await fs.mkdir(path.dirname(generatedPath), { recursive: true });
    await fs.writeFile(generatedPath, body, 'utf8');
    await fs.writeFile(fixturePath, body, 'utf8');

    const result = await verifyGeneratedFieldRules({
      category,
      config: {
        helperFilesRoot: helperRoot
      },
      fixturePath
    });
    assert.equal(result.verified, true);
    assert.equal(Boolean(result.generated_sha256), true);
    assert.equal(Boolean(result.fixture_sha256), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('verifyGeneratedFieldRules passes semantic comparison when only volatile keys differ', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-field-rules-verify-semantic-'));
  const helperRoot = path.join(root, 'helper_files');
  const category = 'mouse';
  const generatedPath = path.join(helperRoot, category, '_generated', 'field_rules.json');
  const fixturePath = path.join(root, 'test-fixture.json');
  const fixturePayload = {
    version: 1,
    category,
    generated_at: '2026-01-01T00:00:00.000Z',
    fields: {
      connection: {
        key: 'connection',
        contract: {
          type: 'string'
        }
      }
    }
  };
  const generatedPayload = {
    ...fixturePayload,
    generated_at: '2026-02-01T00:00:00.000Z'
  };
  try {
    await fs.mkdir(path.dirname(generatedPath), { recursive: true });
    await fs.writeFile(generatedPath, `${JSON.stringify(generatedPayload, null, 2)}\n`, 'utf8');
    await fs.writeFile(fixturePath, `${JSON.stringify(fixturePayload, null, 2)}\n`, 'utf8');

    const result = await verifyGeneratedFieldRules({
      category,
      config: {
        helperFilesRoot: helperRoot
      },
      fixturePath
    });
    assert.equal(result.verified, true);
    assert.equal(result.byte_equal, false);
    assert.equal(result.semantic_equal, true);
    assert.equal(result.verify_mode, 'semantic');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('verifyGeneratedFieldRules fails when semantic field keys differ', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-field-rules-verify-mismatch-'));
  const helperRoot = path.join(root, 'helper_files');
  const category = 'mouse';
  const generatedPath = path.join(helperRoot, category, '_generated', 'field_rules.json');
  const fixturePath = path.join(root, 'test-fixture.json');
  const fixturePayload = {
    version: 1,
    category,
    fields: {
      connection: {
        key: 'connection'
      }
    }
  };
  const generatedPayload = {
    version: 1,
    category,
    fields: {
      connectivity: {
        key: 'connectivity'
      }
    }
  };
  try {
    await fs.mkdir(path.dirname(generatedPath), { recursive: true });
    await fs.writeFile(generatedPath, `${JSON.stringify(generatedPayload, null, 2)}\n`, 'utf8');
    await fs.writeFile(fixturePath, `${JSON.stringify(fixturePayload, null, 2)}\n`, 'utf8');

    const result = await verifyGeneratedFieldRules({
      category,
      config: {
        helperFilesRoot: helperRoot
      },
      fixturePath
    });
    assert.equal(result.verified, false);
    assert.equal(result.semantic_equal, false);
    assert.equal(result.diff?.parseable_json, true);
    assert.equal(result.diff?.missing_fields_count, 1);
    assert.equal(result.diff?.extra_fields_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
