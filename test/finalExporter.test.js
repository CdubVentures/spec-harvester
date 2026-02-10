import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import { writeFinalOutputs } from '../src/exporter/finalExporter.js';

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
