import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Phase 03 — Golden Corpus Structure Validation
// Ensures golden reference files are well-formed and can be loaded.
// ---------------------------------------------------------------------------

const GOLDEN_DIR = path.resolve('test/golden/mouse');

async function loadGoldenFiles() {
  const files = await fs.readdir(GOLDEN_DIR);
  const golden = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(GOLDEN_DIR, file), 'utf8');
    golden.push({ file, data: JSON.parse(raw) });
  }
  return golden;
}

test('P03 golden: at least 30 golden reference files exist', async () => {
  const golden = await loadGoldenFiles();
  assert.ok(golden.length >= 30, `Expected at least 30 golden files, got ${golden.length}`);
});

test('P03 golden: each file has required structure', async () => {
  const golden = await loadGoldenFiles();
  for (const { file, data } of golden) {
    assert.ok(data.product_id, `${file}: missing product_id`);
    assert.ok(data.category, `${file}: missing category`);
    assert.ok(data.expected_fields, `${file}: missing expected_fields`);
    assert.ok(typeof data.expected_fields === 'object', `${file}: expected_fields must be object`);
    assert.ok(Object.keys(data.expected_fields).length >= 4, `${file}: too few expected fields`);
  }
});

test('P03 golden: each file has required_evidence_fields', async () => {
  const golden = await loadGoldenFiles();
  for (const { file, data } of golden) {
    assert.ok(Array.isArray(data.required_evidence_fields), `${file}: required_evidence_fields must be array`);
    assert.ok(data.required_evidence_fields.length >= 2, `${file}: need at least 2 required evidence fields`);
    for (const field of data.required_evidence_fields) {
      assert.ok(
        data.expected_fields[field] !== undefined,
        `${file}: required_evidence_field "${field}" not in expected_fields`
      );
    }
  }
});

test('P03 golden: all product_ids are unique', async () => {
  const golden = await loadGoldenFiles();
  const ids = golden.map((g) => g.data.product_id);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate product_ids in golden corpus');
});

test('P03 golden: weight field present in all mouse products', async () => {
  const golden = await loadGoldenFiles();
  for (const { file, data } of golden) {
    if (data.category === 'mouse') {
      assert.ok(data.expected_fields.weight, `${file}: mouse product missing weight`);
    }
  }
});
