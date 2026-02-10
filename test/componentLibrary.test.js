import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  applyComponentLibraryPriors,
  loadComponentLibrary,
  updateComponentLibrary
} from '../src/components/library.js';

test('component library prior fills unknown fields from a high-confidence single match', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-components-prior-'));
  const storage = createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs'
  });

  try {
    await storage.writeObject(
      '_components/sensors.jsonl',
      Buffer.from(
        `${JSON.stringify({
          id: 'sensor:pixart-paw-3395',
          type: 'sensor',
          brand: 'PixArt',
          model: 'PAW3395',
          aliases: ['paw3395', 'pixart paw3395'],
          specs: {
            sensor_type: 'optical',
            ips: '650',
            acceleration: '50'
          },
          confidence: 0.95
        })}\n`,
        'utf8'
      )
    );

    const library = await loadComponentLibrary({ storage });
    const normalized = {
      fields: {
        sensor: 'PAW3395',
        sensor_brand: 'PixArt',
        sensor_type: 'unk',
        ips: 'unk',
        acceleration: 'unk'
      }
    };
    const provenance = {};
    const applied = applyComponentLibraryPriors({
      normalized,
      provenance,
      library,
      fieldOrder: ['sensor', 'sensor_brand', 'sensor_type', 'ips', 'acceleration']
    });

    assert.equal(applied.filled_fields.includes('sensor_type'), true);
    assert.equal(normalized.fields.sensor_type, 'optical');
    assert.equal(normalized.fields.ips, '650');
    assert.equal((provenance.sensor_type?.evidence || [])[0]?.method, 'component_db');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('updateComponentLibrary writes validated component rows', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-components-update-'));
  const storage = createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs'
  });

  try {
    const result = await updateComponentLibrary({
      storage,
      normalized: {
        fields: {
          sensor: 'PAW3395',
          sensor_brand: 'PixArt',
          sensor_type: 'optical',
          dpi: '26000',
          ips: '650',
          acceleration: '50',
          switch: 'Optical Switches',
          switch_brand: 'Razer'
        }
      },
      summary: {
        validated: true,
        confidence: 0.95
      },
      provenance: {
        sensor: {
          evidence: [{ url: 'https://example.com/specs' }]
        }
      }
    });

    assert.equal(result.updated, true);
    const sensors = await storage.readText('_components/sensors.jsonl');
    assert.equal(sensors.includes('PAW3395'), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
