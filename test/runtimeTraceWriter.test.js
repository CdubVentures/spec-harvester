import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeTraceWriter } from '../src/runtime/runtimeTraceWriter.js';

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    resolveOutputKey: (...parts) => parts.filter(Boolean).join('/'),
    async readJsonOrNull(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async readTextOrNull(key) {
      return data.has(key) ? String(data.get(key)) : null;
    },
    async writeObject(key, body) {
      data.set(key, Buffer.from(body).toString('utf8'));
    },
    async appendText(key, text) {
      const prev = data.get(key) || '';
      data.set(key, `${prev}${String(text || '')}`);
    },
    snapshot(key) {
      return data.get(key);
    },
    keys() {
      return [...data.keys()];
    }
  };
}

test('RuntimeTraceWriter writes trace files under run/product path', async () => {
  const storage = createStorage();
  const writer = new RuntimeTraceWriter({
    storage,
    runId: 'run-1',
    productId: 'mouse-1'
  });
  const out = await writer.writeJson({
    section: 'search',
    prefix: 'query',
    payload: { query: 'x' }
  });
  assert.equal(out.trace_path.includes('_runtime/traces/runs/run-1/mouse-1/search/query_'), true);
  assert.equal(Boolean(storage.snapshot(out.trace_path)), true);
});

test('RuntimeTraceWriter uses ring slots for bounded traces', async () => {
  const storage = createStorage();
  const writer = new RuntimeTraceWriter({
    storage,
    runId: 'run-2',
    productId: 'mouse-2'
  });
  const paths = [];
  for (let i = 0; i < 6; i += 1) {
    const row = await writer.writeJson({
      section: 'fetch',
      prefix: 'fetch',
      payload: { idx: i },
      ringSize: 3
    });
    paths.push(row.trace_path);
  }
  const unique = new Set(paths);
  assert.equal(unique.size, 3);
});

test('RuntimeTraceWriter appends field timeline rows', async () => {
  const storage = createStorage();
  const writer = new RuntimeTraceWriter({
    storage,
    runId: 'run-3',
    productId: 'mouse-3'
  });
  const out = await writer.appendJsonl({
    section: 'fields',
    filename: 'field_timeline.jsonl',
    row: { field: 'weight', value: '54' }
  });
  assert.equal(out.trace_path.endsWith('/fields/field_timeline.jsonl'), true);
  assert.equal(String(storage.snapshot(out.trace_path)).includes('"field":"weight"'), true);
});
