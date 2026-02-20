import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExtractionContextMatrix,
  buildPrimeSourcesFromEvidencePack,
  buildPrimeSourcesFromProvenance
} from '../src/llm/extractionContext.js';

test('buildExtractionContextMatrix includes policy, parse intent, and prime snippets', () => {
  const categoryConfig = {
    category: 'mouse',
    fieldRules: {
      fields: {
        polling_rate: {
          difficulty: 'hard',
          required_level: 'critical',
          parse: { template: 'list_of_numbers_with_unit' },
          evidence: {
            required: true,
            min_evidence_refs: 2,
            tier_preference: ['tier1', 'tier2', 'tier3'],
            distinct_sources_required: true
          },
          contract: {
            type: 'number',
            shape: 'list',
            unit: 'Hz',
            unknown_token: 'unk',
            unknown_reason_required: true
          }
        }
      },
      parse_templates: {
        list_of_numbers_with_unit: {
          description: 'Parse list of numbers with units.',
          tests: [
            { raw: '125/500/1000 Hz', expected: [125, 500, 1000] }
          ]
        }
      }
    },
    uiFieldCatalog: {
      fields: [
        { field_key: 'polling_rate', label: 'Polling Rate', tooltip_md: 'Polling options in Hz.' }
      ]
    }
  };

  const matrix = buildExtractionContextMatrix({
    category: 'mouse',
    categoryConfig,
    fields: ['polling_rate'],
    evidencePack: {
      references: [
        { id: 'w01', source_id: 'techpowerup_com', url: 'https://example.com/review' }
      ],
      snippets: [
        {
          id: 'w01',
          type: 'window',
          field_hints: ['polling_rate'],
          normalized_text: 'Polling Rate: 125/250/500/1000/2000/4000/8000 Hz'
        }
      ]
    }
  });

  assert.equal(matrix.field_count, 1);
  assert.equal(matrix.fields.polling_rate.required_level, 'critical');
  assert.equal(matrix.fields.polling_rate.parse_template_intent.template_id, 'list_of_numbers_with_unit');
  assert.equal(Number(matrix.fields.polling_rate.evidence_policy.min_evidence_refs || 0), 2);
  assert.equal(Boolean(matrix.fields.polling_rate.evidence_policy.distinct_sources_required), true);
  assert.equal(Array.isArray(matrix.prime_sources.rows), true);
  assert.equal(matrix.prime_sources.rows.length, 1);
  assert.equal(matrix.prime_sources.rows[0].snippet_id, 'w01');
});

test('buildPrimeSourcesFromProvenance returns ordered rows by tier', () => {
  const rows = buildPrimeSourcesFromProvenance({
    uncertainFields: ['polling_rate'],
    provenance: {
      polling_rate: {
        evidence: [
          {
            url: 'https://tier2.example/spec',
            tier: 2,
            tierName: 'lab',
            method: 'llm_extract',
            keyPath: 'llm.polling_rate',
            snippet_id: 't02',
            quote: 'Polling Rate: 8000 Hz'
          },
          {
            url: 'https://tier1.example/spec',
            tier: 1,
            tierName: 'manufacturer',
            method: 'network_json',
            keyPath: 'json.polling_rate',
            snippet_id: 't01',
            quote: 'Polling Rate options: 125/250/500/1000/8000 Hz'
          }
        ]
      }
    }
  });

  assert.equal(Array.isArray(rows.rows), true);
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0].snippet_id, 't01');
  assert.equal(rows.rows[1].snippet_id, 't02');
});

test('buildPrimeSourcesFromEvidencePack respects field matching hints', () => {
  const rows = buildPrimeSourcesFromEvidencePack({
    fields: ['weight', 'dpi'],
    evidencePack: {
      references: [
        { id: 's01', url: 'https://example.com/spec' },
        { id: 's02', url: 'https://example.com/spec' }
      ],
      snippets: [
        { id: 's01', field_hints: ['weight'], normalized_text: 'Weight: 39 g' },
        { id: 's02', field_hints: ['dpi'], normalized_text: 'Maximum DPI: 26000' }
      ]
    }
  });

  assert.equal(rows.by_field.weight.length, 1);
  assert.equal(rows.by_field.weight[0].snippet_id, 's01');
  assert.equal(rows.by_field.dpi.length, 1);
  assert.equal(rows.by_field.dpi[0].snippet_id, 's02');
});
