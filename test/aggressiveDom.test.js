import test from 'node:test';
import assert from 'node:assert/strict';
import { AggressiveDomExtractor } from '../src/extract/aggressiveDom.js';

test('AggressiveDomExtractor extracts basic field candidates from HTML text', async () => {
  const extractor = new AggressiveDomExtractor({
    config: {
      cortexModelDom: 'gpt-5-low'
    }
  });
  const result = await extractor.extractFromDom(
    '<html><body><div>weight: 59 g</div><div>dpi: 26000</div></body></html>',
    ['weight', 'dpi', 'sensor'],
    { productId: 'mouse-1' },
    { source_id: 'manufacturer' }
  );

  assert.equal(result.model, 'gpt-5-low');
  assert.equal(result.force_deep, false);
  assert.equal(result.fieldCandidates.some((row) => row.field === 'weight'), true);
  assert.equal(result.fieldCandidates.some((row) => row.field === 'dpi'), true);
});

test('AggressiveDomExtractor uses deep model when forceDeep is true', async () => {
  const extractor = new AggressiveDomExtractor({
    config: {
      cortexModelDom: 'gpt-5-low',
      cortexModelReasoningDeep: 'gpt-5-high'
    }
  });
  const result = await extractor.extractFromDom(
    '<div>weight: 58 g</div>',
    ['weight'],
    { productId: 'mouse-2' },
    { source_id: 'manufacturer' },
    { forceDeep: true }
  );
  assert.equal(result.model, 'gpt-5-high');
  assert.equal(result.force_deep, true);
});

test('AggressiveDomExtractor merges sidecar JSON candidates when available', async () => {
  const extractor = new AggressiveDomExtractor({
    cortexClient: {
      async runPass() {
        return {
          mode: 'sidecar',
          fallback_to_non_sidecar: false,
          plan: { deep_task_count: 0 },
          results: [{
            response: {
              choices: [{
                message: {
                  content: JSON.stringify({
                    fieldCandidates: [{
                      field: 'weight',
                      value: '57 g',
                      confidence: 0.73,
                      quote: '57 g'
                    }]
                  })
                }
              }]
            }
          }]
        };
      }
    },
    config: {
      cortexModelDom: 'gpt-5-low'
    }
  });

  const result = await extractor.extractFromDom(
    '<div>weight: 58 g</div>',
    ['weight'],
    { productId: 'mouse-3' },
    { source_id: 'manufacturer' }
  );

  assert.equal(result.sidecar.mode, 'sidecar');
  assert.equal(
    result.fieldCandidates.some((row) => row.method === 'aggressive_dom_sidecar' && row.value === '57 g'),
    true
  );
});
