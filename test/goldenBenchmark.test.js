import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runGoldenBenchmark } from '../src/benchmark/goldenBenchmark.js';

function makeStorage() {
  const map = new Map();
  return {
    async readJsonOrNull(key) {
      const raw = map.get(key);
      return raw ? JSON.parse(raw.toString('utf8')) : null;
    },
    async writeObject(key, body) {
      map.set(key, Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'));
    },
    resolveOutputKey(...parts) {
      return ['specs/outputs', ...parts].join('/');
    }
  };
}

test('runGoldenBenchmark compares expected fields from latest outputs', async () => {
  const storage = makeStorage();
  const latestBase = storage.resolveOutputKey('mouse', 'mouse-acme-m100', 'latest');

  await storage.writeObject(
    `${latestBase}/normalized.json`,
    JSON.stringify({
      productId: 'mouse-acme-m100',
      fields: {
        brand: 'Acme',
        model: 'M100',
        sensor: 'PixArt 3395'
      }
    })
  );
  await storage.writeObject(
    `${latestBase}/summary.json`,
    JSON.stringify({
      validated: true,
      confidence: 0.9
    })
  );

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-benchmark-'));
  const fixturePath = path.join(tempRoot, 'mouse.json');

  try {
    await fs.writeFile(
      fixturePath,
      JSON.stringify({
        category: 'mouse',
        cases: [
          {
            productId: 'mouse-acme-m100',
            expected: {
              fields: {
                brand: 'Acme',
                model: 'M100',
                sensor: 'PixArt 3395'
              }
            }
          }
        ]
      }, null, 2),
      'utf8'
    );

    const report = await runGoldenBenchmark({
      storage,
      category: 'mouse',
      fixturePath
    });

    assert.equal(report.case_count, 1);
    assert.equal(report.pass_case_count, 1);
    assert.equal(report.field_pass_rate, 1);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
