import test from 'node:test';
import assert from 'node:assert/strict';
import { SourcePlanner } from '../src/planner/sourcePlanner.js';

function makeCategoryConfig() {
  return {
    sourceHosts: [
      { host: 'manufacturer.com', tierName: 'manufacturer' },
      { host: 'db-a.com', tierName: 'database' },
      { host: 'db-b.com', tierName: 'database' }
    ],
    denylist: []
  };
}

function makeConfig(overrides = {}) {
  return {
    maxUrlsPerProduct: 20,
    maxCandidateUrls: 50,
    maxPagesPerDomain: 2,
    fetchCandidateSources: false,
    ...overrides
  };
}

test('source planner does not enqueue candidate domains when candidate crawl is disabled', () => {
  const planner = new SourcePlanner(
    { seedUrls: [], preferredSources: {} },
    makeConfig({ fetchCandidateSources: false }),
    makeCategoryConfig()
  );

  planner.enqueue('https://manufacturer.com/p/one');
  planner.enqueue('https://unknown.example/specs');

  const first = planner.next();
  assert.equal(first.host, 'manufacturer.com');
  assert.equal(first.candidateSource, false);
  assert.equal(planner.hasNext(), false);
});

test('source planner keeps candidates last and uses source-intel score inside a tier', () => {
  const planner = new SourcePlanner(
    { seedUrls: [], preferredSources: {} },
    makeConfig({ fetchCandidateSources: true }),
    makeCategoryConfig(),
    {
      requiredFields: ['fields.sensor', 'fields.polling_rate'],
      sourceIntel: {
        domains: {
          'db-a.com': {
            planner_score: 0.6,
            per_field_helpfulness: { sensor: 100 }
          },
          'db-b.com': {
            planner_score: 0.95,
            per_field_helpfulness: { sensor: 10 }
          }
        }
      }
    }
  );

  planner.enqueue('https://db-a.com/product/1');
  planner.enqueue('https://db-b.com/product/1');
  planner.enqueue('https://random-candidate.com/p/1');

  const first = planner.next();
  const second = planner.next();
  const third = planner.next();

  assert.equal(first.host, 'db-b.com');
  assert.equal(first.tier, 2);
  assert.equal(second.host, 'db-a.com');
  assert.equal(second.tier, 2);
  assert.equal(third.host, 'random-candidate.com');
  assert.equal(third.tier, 4);
  assert.equal(third.candidateSource, true);
});
