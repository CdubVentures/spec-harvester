import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicParser } from '../src/extract/deterministicParser.js';

function buildEngineStub() {
  return {
    getAllParseTemplates() {
      return {
        weight: {
          patterns: [
            {
              regex: 'weight\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*g',
              group: 1
            }
          ],
          context_keywords: ['weight', 'grams']
        },
        dpi: {
          patterns: [],
          context_keywords: ['dpi']
        },
        sensor: {
          patterns: [],
          context_keywords: ['sensor'],
          json_ld_path: 'additionalProperty.sensor'
        }
      };
    },
    normalizeCandidate(field, value) {
      const token = String(value || '').trim();
      if (!token) {
        return { ok: false, reason_code: 'empty_value' };
      }
      return { ok: true, normalized: token };
    }
  };
}

test('DeterministicParser extracts regex/spec-table/json-ld candidates with snippet citations', () => {
  const parser = new DeterministicParser(buildEngineStub());
  const pack = {
    references: [{ id: 's1' }, { id: 't1' }, { id: 'j1' }],
    snippets: [
      {
        id: 's1',
        type: 'text',
        text: 'Official specs list weight: 59 g for this mouse.',
        normalized_text: 'Official specs list weight: 59 g for this mouse.',
        source_id: 'mfg',
        snippet_hash: 'sha256:s1',
        url: 'https://example.com/spec'
      },
      {
        id: 't1',
        type: 'table',
        text: 'DPI: 32000',
        normalized_text: 'DPI: 32000',
        source_id: 'mfg',
        snippet_hash: 'sha256:t1',
        url: 'https://example.com/spec'
      },
      {
        id: 'j1',
        type: 'json_ld_product',
        text: '{"@type":"Product","additionalProperty":{"sensor":"PAW3395"}}',
        normalized_text: '{"@type":"Product","additionalProperty":{"sensor":"PAW3395"}}',
        source_id: 'mfg',
        snippet_hash: 'sha256:j1',
        url: 'https://example.com/spec'
      }
    ]
  };

  const rows = parser.extractFromEvidencePack(pack, {
    targetFields: ['weight', 'dpi', 'sensor']
  });

  const byField = Object.fromEntries(rows.map((row) => [row.field, row]));
  assert.equal(byField.weight.value, '59');
  assert.equal(byField.weight.method, 'parse_template');
  assert.deepEqual(byField.weight.evidenceRefs, ['s1']);

  assert.equal(byField.dpi.value, '32000');
  assert.equal(byField.dpi.method, 'spec_table_match');
  assert.deepEqual(byField.dpi.evidenceRefs, ['t1']);

  assert.equal(byField.sensor.value, 'PAW3395');
  assert.equal(byField.sensor.method, 'json_ld');
  assert.deepEqual(byField.sensor.evidenceRefs, ['j1']);
});

test('DeterministicParser reads microdata/rdfa/opengraph snippet types via template path lookup', () => {
  const parser = new DeterministicParser({
    getAllParseTemplates() {
      return {
        weight: {
          patterns: [],
          context_keywords: ['weight'],
          json_path: 'specs.weight'
        },
        dpi: {
          patterns: [],
          context_keywords: ['dpi'],
          json_path: 'specs.dpi'
        }
      };
    },
    normalizeCandidate(_field, value) {
      const token = String(value || '').trim();
      return token ? { ok: true, normalized: token } : { ok: false, reason_code: 'empty' };
    }
  });

  const pack = {
    snippets: [
      {
        id: 'm1',
        type: 'microdata_product',
        text: '{"specs":{"weight":"60 g","dpi":"26000"}}'
      },
      {
        id: 'r1',
        type: 'rdfa_product',
        text: '{"specs":{"weight":"59 g"}}'
      },
      {
        id: 'o1',
        type: 'opengraph_product',
        text: '{"specs":{"dpi":"24000"}}'
      }
    ]
  };

  const rows = parser.extractFromEvidencePack(pack, {
    targetFields: ['weight', 'dpi']
  });
  const hasMicrodataWeight = rows.some((row) => row.field === 'weight' && row.method === 'microdata' && row.evidenceRefs?.[0] === 'm1');
  const hasRdfaWeight = rows.some((row) => row.field === 'weight' && row.method === 'rdfa' && row.evidenceRefs?.[0] === 'r1');
  const hasOpengraphDpi = rows.some((row) => row.field === 'dpi' && row.method === 'opengraph' && row.evidenceRefs?.[0] === 'o1');

  assert.equal(hasMicrodataWeight, true);
  assert.equal(hasRdfaWeight, true);
  assert.equal(hasOpengraphDpi, true);
});
