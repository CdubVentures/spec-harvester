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
