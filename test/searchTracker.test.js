import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchTracker } from '../src/extract/searchTracker.js';

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

test('SearchTracker records and deduplicates queries, urls, frontier, and field yield', async () => {
  const storage = createStorage();
  const key = 'specs/outputs/_aggressive/mouse/mouse-1/search_tracker.json';
  const tracker = new SearchTracker({
    storage,
    key,
    category: 'mouse',
    productId: 'mouse-1'
  });

  await tracker.load();
  tracker.recordQueries(['razer viper v3 pro specs', 'RAZER   viper v3 pro   specs'], { source: 'discovery' });
  tracker.recordVisitedUrls(['https://example.com/spec', 'https://example.com/spec/'], { source: 'crawl' });
  tracker.addFrontier(['https://example.com/support', 'https://example.com/spec']);
  tracker.recordFieldYield([{ field: 'weight', url: 'https://example.com/spec' }]);

  assert.equal(tracker.shouldSkipQuery('razer viper v3 pro specs'), true);
  assert.equal(tracker.shouldSkipUrl('https://example.com/spec'), true);
  assert.equal(tracker.pendingFrontier().length, 1);

  const summary = await tracker.save();
  assert.equal(summary.query_count, 1);
  assert.equal(summary.visited_url_count, 1);
  assert.equal(summary.frontier_pending_count, 1);
  assert.equal(summary.field_yield_count, 1);
  assert.equal(storage.snapshot(key).queries.length, 1);
});

test('SearchTracker load hydrates existing state and pendingFrontier limit works', async () => {
  const key = 'specs/outputs/_aggressive/mouse/mouse-2/search_tracker.json';
  const storage = createStorage({
    [key]: {
      version: 1,
      category: 'mouse',
      product_id: 'mouse-2',
      queries: [{ query: 'x', count: 1 }],
      visited_urls: [{ url: 'https://a.com', count: 1 }],
      frontier: [
        { url: 'https://b.com', status: 'pending' },
        { url: 'https://c.com', status: 'pending' },
        { url: 'https://d.com', status: 'visited' }
      ],
      field_yield: {
        weight: { hits: 2 }
      }
    }
  });
  const tracker = new SearchTracker({
    storage,
    key,
    category: 'mouse',
    productId: 'mouse-2'
  });
  await tracker.load();
  assert.equal(tracker.shouldSkipQuery('x'), true);
  assert.equal(tracker.shouldSkipUrl('https://a.com/'), true);
  assert.equal(tracker.pendingFrontier({ limit: 1 }).length, 1);
  assert.equal(tracker.summary().field_yield_count, 1);
});
