import test from 'node:test';
import assert from 'node:assert/strict';
import { SourcePlanner } from '../src/planner/sourcePlanner.js';

function makeCategoryConfig() {
  return {
    sourceHosts: [
      { host: 'manufacturer.com', tierName: 'manufacturer' },
      { host: 'lab.com', tierName: 'lab' },
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
    maxManufacturerUrlsPerProduct: 20,
    maxManufacturerPagesPerDomain: 8,
    manufacturerReserveUrls: 0,
    manufacturerDeepResearchEnabled: true,
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

test('source planner uses field reward memory to prefer stronger field paths', () => {
  const planner = new SourcePlanner(
    { seedUrls: [], preferredSources: {} },
    makeConfig({ fetchCandidateSources: false }),
    makeCategoryConfig(),
    {
      requiredFields: ['fields.sensor'],
      sourceIntel: {
        domains: {
          'db-a.com': {
            planner_score: 0.9,
            per_field_reward: {
              sensor: { score: -0.6 }
            },
            per_path: {
              '/product/m100': {
                path: '/product/m100',
                per_field_reward: {
                  sensor: { score: -0.8 }
                }
              }
            }
          },
          'db-b.com': {
            planner_score: 0.82,
            per_field_reward: {
              sensor: { score: 0.2 }
            },
            per_path: {
              '/specs/m100': {
                path: '/specs/m100',
                per_field_reward: {
                  sensor: { score: 0.95 }
                }
              }
            }
          }
        }
      }
    }
  );

  planner.enqueue('https://db-a.com/product/m100');
  planner.enqueue('https://db-b.com/specs/m100');

  const first = planner.next();
  const second = planner.next();

  assert.equal(first.host, 'db-b.com');
  assert.equal(second.host, 'db-a.com');
});

test('source planner prioritizes manufacturer queue ahead of same-tier lab pages', () => {
  const planner = new SourcePlanner(
    { seedUrls: [], preferredSources: {} },
    makeConfig({ fetchCandidateSources: false }),
    makeCategoryConfig()
  );

  planner.enqueue('https://lab.com/review/1');
  planner.enqueue('https://manufacturer.com/product/1');

  const first = planner.next();
  const second = planner.next();

  assert.equal(first.host, 'manufacturer.com');
  assert.equal(first.role, 'manufacturer');
  assert.equal(second.host, 'lab.com');
});

test('source planner preserves non-manufacturer capacity for manufacturer deep research', () => {
  const planner = new SourcePlanner(
    { seedUrls: [], preferredSources: {} },
    makeConfig({
      maxUrlsPerProduct: 4,
      manufacturerReserveUrls: 2,
      fetchCandidateSources: false
    }),
    makeCategoryConfig()
  );

  planner.enqueue('https://db-a.com/product/1');
  planner.enqueue('https://db-b.com/product/1');
  planner.enqueue('https://db-a.com/product/2');
  planner.enqueue('https://db-b.com/product/2');
  planner.enqueue('https://manufacturer.com/product/1');
  planner.enqueue('https://manufacturer.com/support/product-1');

  const hosts = [];
  while (planner.hasNext()) {
    hosts.push(planner.next().host);
  }

  assert.deepEqual(hosts, ['manufacturer.com', 'manufacturer.com', 'db-a.com', 'db-b.com']);
});

test('source planner de-duplicates manufacturer queue URLs', () => {
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Acme', model: 'M100' },
      productId: 'mouse-acme-m100'
    },
    makeConfig({ manufacturerDeepResearchEnabled: false, fetchCandidateSources: false }),
    makeCategoryConfig()
  );

  planner.enqueue('https://manufacturer.com/product/m100');
  planner.enqueue('https://manufacturer.com/product/m100');

  const urls = [];
  while (planner.hasNext()) {
    urls.push(planner.next().url);
  }

  assert.deepEqual(urls, ['https://manufacturer.com/product/m100']);
});

test('source planner accepts locale-prefixed manufacturer spec paths in manufacturer context', () => {
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Acme', model: 'M100' },
      productId: 'mouse-acme-m100'
    },
    makeConfig({ manufacturerDeepResearchEnabled: false, fetchCandidateSources: false }),
    makeCategoryConfig()
  );

  const parsed = new URL('https://manufacturer.com/en/m100/specs');
  assert.equal(planner.isRelevantDiscoveredUrl(parsed, { manufacturerContext: true }), true);
});

test('source planner discovers manufacturer URLs from sitemap XML', () => {
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Acme', model: 'M100' },
      productId: 'mouse-acme-m100'
    },
    makeConfig({ manufacturerDeepResearchEnabled: false, fetchCandidateSources: false }),
    makeCategoryConfig()
  );

  const discovered = planner.discoverFromSitemap(
    'https://manufacturer.com/sitemap.xml',
    [
      '<urlset>',
      '<url><loc>https://manufacturer.com/en/m100/specs</loc></url>',
      '<url><loc>https://manufacturer.com/support/m100</loc></url>',
      '<url><loc>https://manufacturer.com/sitemap-products.xml</loc></url>',
      '<url><loc>https://unapproved.com/product/m100</loc></url>',
      '</urlset>'
    ].join('')
  );

  assert.equal(discovered >= 3, true);
  assert.equal(planner.getStats().sitemap_urls_discovered >= 3, true);
});

test('source planner discovers sitemap pointers from robots.txt', () => {
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Acme', model: 'M100' },
      productId: 'mouse-acme-m100'
    },
    makeConfig({ manufacturerDeepResearchEnabled: false, fetchCandidateSources: false }),
    makeCategoryConfig()
  );

  const discovered = planner.discoverFromRobots(
    'https://manufacturer.com/robots.txt',
    [
      'User-agent: *',
      'Disallow: /cart',
      'Sitemap: https://manufacturer.com/sitemap.xml',
      'Sitemap: https://manufacturer.com/sitemap-support.xml'
    ].join('\n')
  );

  assert.equal(discovered, 2);
  assert.equal(planner.getStats().robots_sitemaps_discovered, 2);
});

test('source planner manufacturer deep seeds are brand-targeted', () => {
  const categoryConfig = {
    sourceHosts: [
      { host: 'razer.com', tierName: 'manufacturer' },
      { host: 'logitechg.com', tierName: 'manufacturer' }
    ],
    denylist: []
  };
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Logitech', model: 'G Pro X Superlight 2' },
      productId: 'mouse-logitech-g-pro-x-superlight-2'
    },
    makeConfig({ fetchCandidateSources: false }),
    categoryConfig
  );

  const stats = planner.getStats();
  assert.deepEqual(stats.brand_manufacturer_hosts, ['logitechg.com']);
});

test('source planner does not bypass brand manufacturer filtering for seeded discovery URLs', () => {
  const categoryConfig = {
    sourceHosts: [
      { host: 'razer.com', tierName: 'manufacturer' },
      { host: 'logitechg.com', tierName: 'manufacturer' }
    ],
    denylist: []
  };
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Logitech', model: 'G Pro X Superlight 2' },
      productId: 'mouse-logitech-g-pro-x-superlight-2'
    },
    makeConfig({ manufacturerDeepResearchEnabled: false, fetchCandidateSources: false }),
    categoryConfig
  );

  planner.seed(['https://razer.com/specs/g-pro-x-superlight-2']);
  const stats = planner.getStats();
  assert.equal(stats.manufacturer_queue_count, 0);
  assert.equal(stats.brand_manufacturer_hosts.includes('logitechg.com'), true);
});

test('source planner can block a mismatched manufacturer host and remove queued URLs', () => {
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Acme', model: 'M100' },
      productId: 'mouse-acme-m100'
    },
    makeConfig({ manufacturerDeepResearchEnabled: false, fetchCandidateSources: false }),
    makeCategoryConfig()
  );

  planner.enqueue('https://manufacturer.com/product/m100');
  planner.enqueue('https://manufacturer.com/support/m100');
  const removed = planner.blockHost('manufacturer.com', 'brand_mismatch');

  assert.equal(removed >= 2, true);
  assert.equal(planner.hasNext(), false);
  assert.equal(planner.getStats().blocked_host_count, 1);
});

test('source planner avoids manufacturer category hubs without model signal in broad mode', () => {
  const planner = new SourcePlanner(
    {
      seedUrls: [],
      preferredSources: {},
      identityLock: { brand: 'Logitech', model: 'G Pro X Superlight 2' },
      productId: 'mouse-logitech-g-pro-x-superlight-2'
    },
    makeConfig({
      manufacturerDeepResearchEnabled: false,
      fetchCandidateSources: false,
      manufacturerBroadDiscovery: true
    }),
    makeCategoryConfig()
  );

  const categoryHub = new URL('https://manufacturer.com/en-us/shop/c/gaming-mice');
  const productLike = new URL('https://manufacturer.com/en-us/products/gaming-mice/pro-x-superlight-2.html');
  assert.equal(planner.isRelevantDiscoveredUrl(categoryHub, { manufacturerContext: true }), false);
  assert.equal(planner.isRelevantDiscoveredUrl(productLike, { manufacturerContext: true }), true);
});
