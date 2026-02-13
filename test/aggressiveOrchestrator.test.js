import test from 'node:test';
import assert from 'node:assert/strict';
import { AggressiveOrchestrator } from '../src/extract/aggressiveOrchestrator.js';

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    resolveOutputKey: (...parts) => parts.filter(Boolean).join('/'),
    async readJsonOrNull(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async writeObject(key, body) {
      data.set(key, JSON.parse(Buffer.from(body).toString('utf8')));
    },
    snapshot(key) {
      return data.get(key);
    }
  };
}

function baseRecord() {
  return {
    normalized: {
      fields: {
        weight: '60',
        dpi: 'unk'
      }
    },
    provenance: {
      weight: {
        value: '60',
        confidence: 0.9,
        meets_pass_target: true,
        evidence: [{
          snippet_id: 's1',
          quote: 'Weight: 60 g',
          url: 'https://example.com/spec'
        }]
      },
      dpi: {
        value: 'unk',
        confidence: 0.2,
        meets_pass_target: false,
        evidence: []
      }
    }
  };
}

test('AggressiveOrchestrator returns disabled when mode is not aggressive', async () => {
  const storage = createStorage();
  const orchestrator = new AggressiveOrchestrator({
    storage,
    config: {
      aggressiveModeEnabled: false
    }
  });
  const record = baseRecord();
  const result = await orchestrator.run({
    category: 'mouse',
    productId: 'mouse-1',
    normalized: record.normalized,
    provenance: record.provenance,
    fieldOrder: ['weight', 'dpi'],
    roundContext: { mode: 'balanced' }
  });
  assert.equal(result.enabled, false);
  assert.equal(result.stage, 'disabled');
});

test('AggressiveOrchestrator applies accepted audit candidates and persists search tracker', async () => {
  const storage = createStorage();
  let auditCall = 0;
  const orchestrator = new AggressiveOrchestrator({
    storage,
    config: {
      aggressiveModeEnabled: true,
      aggressiveMaxSearchQueries: 3,
      cortexMaxDeepFieldsPerProduct: 2
    },
    evidenceAuditor: {
      auditCandidates() {
        auditCall += 1;
        if (auditCall === 1) {
          return {
            audits: [
              { field: 'weight', status: 'ACCEPT' },
              { field: 'dpi', status: 'REJECT', reasons: ['no_candidates'] }
            ],
            accepted_by_field: {
              weight: [{
                value: '60',
                confidence: 0.9,
                snippetId: 's1',
                quote: '60'
              }]
            },
            rejected_fields: 1
          };
        }
        return {
          audits: [
            { field: 'weight', status: 'ACCEPT' },
            { field: 'dpi', status: 'ACCEPT' }
          ],
          accepted_by_field: {
            weight: [{
              value: '60',
              confidence: 0.9,
              snippetId: 's1',
              quote: '60'
            }],
            dpi: [{
              value: '26000',
              confidence: 0.8,
              snippetId: 's2',
              quote: '26000'
            }]
          },
          rejected_fields: 0
        };
      }
    },
    domExtractor: {
      async extractFromDom() {
        return {
          fieldCandidates: [{
            field: 'dpi',
            value: '26000',
            confidence: 0.7,
            snippetId: 's2',
            evidenceRefs: ['s2'],
            quote: '26000'
          }]
        };
      }
    },
    reasoningResolver: {
      async resolve() {
        return {
          resolved_by_field: {}
        };
      }
    },
    cortexClient: {
      async runPass() {
        return {
          plan: { deep_task_count: 0 }
        };
      }
    }
  });
  const record = baseRecord();
  const result = await orchestrator.run({
    category: 'mouse',
    productId: 'mouse-2',
    identity: { brand: 'Razer', productId: 'mouse-2' },
    normalized: record.normalized,
    provenance: record.provenance,
    evidencePack: {
      snippets: [{ id: 's1', normalized_text: 'Weight: 60 g' }],
      references: [{ id: 's1', url: 'https://example.com/spec' }]
    },
    fieldOrder: ['weight', 'dpi'],
    criticalFieldSet: new Set(['dpi']),
    fieldsBelowPassTarget: ['dpi'],
    criticalFieldsBelowPassTarget: ['dpi'],
    discoveryResult: {
      search_attempts: [{ query: 'mouse dpi specs' }],
      candidate_queries: ['mouse dpi chart']
    },
    sourceResults: [{
      finalUrl: 'https://example.com/spec'
    }],
    roundContext: { mode: 'aggressive' }
  });

  assert.equal(result.enabled, true);
  assert.equal(result.escalation.deep_triggered, false);
  assert.equal(record.normalized.fields.dpi, '26000');
  assert.equal(result.search_tracker.query_count, 1);
  assert.equal(result.search_tracker.visited_url_count, 1);
  assert.equal(auditCall, 3);
  const trackerKey = '_aggressive/mouse/mouse-2/search_tracker.json';
  assert.equal(Boolean(storage.snapshot(trackerKey)), true);
});

test('AggressiveOrchestrator deep escalation honors max deep field cap', async () => {
  const storage = createStorage();
  let deepTasks = 0;
  const orchestrator = new AggressiveOrchestrator({
    storage,
    config: {
      aggressiveModeEnabled: true,
      cortexMaxDeepFieldsPerProduct: 1
    },
    evidenceAuditor: {
      auditCandidates({ candidatesByField }) {
        const audits = Object.keys(candidatesByField || {}).map((field) => ({
          field,
          status: field === 'weight' ? 'ACCEPT' : 'REJECT',
          reasons: field === 'weight' ? [] : ['missing_evidence_refs']
        }));
        return {
          audits,
          accepted_by_field: {
            weight: [{
              value: '60',
              confidence: 0.8,
              snippetId: 's1',
              quote: '60'
            }]
          },
          rejected_fields: audits.filter((row) => row.status === 'REJECT').length
        };
      }
    },
    domExtractor: {
      async extractFromDom() {
        return { fieldCandidates: [] };
      }
    },
    reasoningResolver: {
      async resolve() {
        return { resolved_by_field: {} };
      }
    },
    cortexClient: {
      async runPass({ tasks }) {
        deepTasks = tasks.length;
        return {
          plan: { deep_task_count: tasks.length }
        };
      }
    }
  });
  const record = {
    normalized: {
      fields: {
        weight: '60',
        dpi: 'unk',
        sensor: 'unk'
      }
    },
    provenance: {
      weight: {
        value: '60',
        confidence: 0.8,
        meets_pass_target: true,
        evidence: [{ snippet_id: 's1', quote: 'Weight: 60 g' }]
      },
      dpi: { value: 'unk', confidence: 0.2, meets_pass_target: false, evidence: [] },
      sensor: { value: 'unk', confidence: 0.2, meets_pass_target: false, evidence: [] }
    }
  };
  const result = await orchestrator.run({
    category: 'mouse',
    productId: 'mouse-3',
    identity: { brand: 'Razer', productId: 'mouse-3' },
    normalized: record.normalized,
    provenance: record.provenance,
    fieldOrder: ['weight', 'dpi', 'sensor'],
    criticalFieldSet: new Set(['dpi', 'sensor']),
    fieldsBelowPassTarget: ['dpi', 'sensor'],
    criticalFieldsBelowPassTarget: ['dpi', 'sensor'],
    roundContext: { mode: 'aggressive' }
  });

  assert.equal(result.escalation.deep_triggered, true);
  assert.equal(result.escalation.deep_task_cap, 1);
  assert.equal(result.escalation.deep_task_count, 1);
  assert.equal(deepTasks, 1);
});
