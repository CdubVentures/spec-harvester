import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexingSchemaPackets } from '../src/indexlab/indexingSchemaPackets.js';

test('indexing schema packets classify pdf_table/pdf_kv into phase_06_text_pdf surfaces', () => {
  const nowIso = new Date().toISOString();
  const packets = buildIndexingSchemaPackets({
    runId: 'run-pdf-phase-001',
    category: 'mouse',
    productId: 'mouse-example-pdf-phase',
    startMs: Date.now() - 1000,
    summary: {
      generated_at: nowIso,
      duration_ms: 1000,
      validated: true,
      completeness_required: 0.9,
      coverage_overall: 0.9
    },
    categoryConfig: {
      requiredFields: ['weight'],
      criticalFieldSet: new Set(['weight']),
      fieldOrder: ['weight', 'polling_rate']
    },
    sourceResults: [
      {
        url: 'https://example.com/manual.pdf',
        finalUrl: 'https://example.com/manual.pdf',
        host: 'example.com',
        rootDomain: 'example.com',
        tier: 1,
        status: 200,
        ts: nowIso,
        approvedDomain: true,
        identity: {
          match: true,
          score: 0.94
        },
        identityCandidates: {
          brand: 'Example',
          model: 'Mouse PDF',
          variant: '',
          sku: ''
        },
        fieldCandidates: [
          {
            field: 'weight',
            value: '60',
            method: 'pdf_table',
            confidence: 0.95,
            keyPath: 'pdf.page[1].table[t1].row[1]',
            evidence: {
              snippet_id: 'sn_pdf_table_01',
              quote: 'Weight: 60 g',
              snippet_hash: 'sha256:pdf_table_weight',
              source_id: 'src_example_pdf'
            }
          },
          {
            field: 'polling_rate',
            value: '8000',
            method: 'pdf_kv',
            confidence: 0.93,
            keyPath: 'pdf.page[1].kv[1]',
            evidence: {
              snippet_id: 'sn_pdf_kv_01',
              quote: 'Polling Rate: 8000 Hz',
              snippet_hash: 'sha256:pdf_kv_polling',
              source_id: 'src_example_pdf'
            }
          }
        ]
      }
    ],
    normalized: {
      fields: {
        weight: '60',
        polling_rate: '8000'
      },
      identity: {
        brand: 'Example',
        model: 'Mouse PDF',
        variant: '',
        sku: ''
      }
    },
    provenance: {
      weight: { confidence: 0.93 },
      polling_rate: { confidence: 0.92 }
    },
    needSet: {
      needs: [{ field_key: 'weight' }, { field_key: 'polling_rate' }]
    },
    phase08Extraction: {
      summary: {
        batch_count: 1
      }
    }
  });

  const sourcePacket = packets?.sourceCollection?.packets?.[0];
  assert.equal(Boolean(sourcePacket), true);
  const weightAssertion = sourcePacket?.field_key_map?.weight?.contexts?.[0]?.assertions?.[0];
  const pollingAssertion = sourcePacket?.field_key_map?.polling_rate?.contexts?.[0]?.assertions?.[0];
  assert.equal(String(weightAssertion?.parser_phase || ''), 'phase_06_text_pdf');
  assert.equal(String(pollingAssertion?.parser_phase || ''), 'phase_06_text_pdf');

  const evidenceRows = Object.values(sourcePacket?.evidence_index || {});
  const hasPdfTableSurface = evidenceRows.some((row) => String(row?.source_surface || '') === 'pdf_table');
  const hasPdfKvSurface = evidenceRows.some((row) => String(row?.source_surface || '') === 'pdf_kv');
  assert.equal(hasPdfTableSurface, true);
  assert.equal(hasPdfKvSurface, true);
});
