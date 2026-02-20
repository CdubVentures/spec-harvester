import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildIndexingSchemaPackets } from '../src/indexlab/indexingSchemaPackets.js';
import { validateIndexingSchemaPackets } from '../src/indexlab/indexingSchemaPacketsValidator.js';

function buildFixturePackets() {
  const nowIso = new Date().toISOString();
  return buildIndexingSchemaPackets({
    runId: 'run-schema-validation-001',
    category: 'mouse',
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    startMs: Date.now() - 1500,
    summary: {
      generated_at: nowIso,
      duration_ms: 1500,
      validated: true,
      completeness_required: 0.92,
      coverage_overall: 0.93
    },
    categoryConfig: {
      requiredFields: ['polling_rate'],
      criticalFieldSet: new Set(['polling_rate']),
      fieldOrder: ['polling_rate']
    },
    sourceResults: [
      {
        url: 'https://example.com/product-page',
        finalUrl: 'https://example.com/product-page',
        host: 'example.com',
        rootDomain: 'example.com',
        tier: 1,
        status: 200,
        ts: nowIso,
        approvedDomain: true,
        identity: {
          match: true,
          score: 0.97
        },
        identityCandidates: {
          brand: 'Logitech',
          model: 'G Pro X Superlight 2',
          variant: '',
          sku: '910-XXXX'
        },
        fieldCandidates: [
          {
            field: 'polling_rate',
            value: '8000',
            method: 'network_json',
            confidence: 0.98,
            evidenceRefs: ['ev_polling_01'],
            evidence: {
              snippet_id: 'snip_01',
              quote: 'Polling Rate 8000 Hz',
              snippet_hash: 'sha256:snippet_01',
              source_id: 'src_example'
            }
          }
        ]
      }
    ],
    normalized: {
      fields: {
        polling_rate: '8000'
      },
      identity: {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: '',
        sku: '910-XXXX'
      }
    },
    provenance: {
      polling_rate: {
        confidence: 0.95
      }
    },
    needSet: {
      needs: [{ field_key: 'polling_rate' }]
    },
    phase08Extraction: {
      summary: {
        batch_count: 1
      }
    }
  });
}

test('indexing schema packets: generated packets validate against v1 schemas', async () => {
  const packets = buildFixturePackets();
  const result = await validateIndexingSchemaPackets({
    sourceCollection: packets.sourceCollection,
    itemPacket: packets.itemPacket,
    runMetaPacket: packets.runMetaPacket,
    schemaRoot: path.resolve(process.cwd(), 'implementation', 'parrsing-managament')
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.error_count, 0);
});

test('indexing schema packets: invalid packet shape is rejected', async () => {
  const packets = buildFixturePackets();
  const brokenItem = {
    ...packets.itemPacket
  };
  delete brokenItem.run_scope;

  const result = await validateIndexingSchemaPackets({
    sourceCollection: packets.sourceCollection,
    itemPacket: brokenItem,
    runMetaPacket: packets.runMetaPacket,
    schemaRoot: path.resolve(process.cwd(), 'implementation', 'parrsing-managament')
  });
  assert.equal(result.valid, false);
  assert.ok(result.error_count > 0);
  assert.ok(result.errors.some((row) => String(row.packet_type) === 'item_packet'));
});
