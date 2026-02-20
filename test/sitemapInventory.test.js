import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSitemapXml,
  buildSitemapInventory,
  filterProductUrls
} from '../src/intel/sitemapInventory.js';

// ---------------------------------------------------------------------------
// IP04-4D — Sitemap Inventory Tests
// ---------------------------------------------------------------------------

const SAMPLE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/products/mouse-a</loc><lastmod>2026-01-15</lastmod></url>
  <url><loc>https://example.com/products/mouse-b</loc><lastmod>2026-01-20</lastmod></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/products/keyboard-c</loc><lastmod>2026-02-01</lastmod></url>
</urlset>`;

const SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-products.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
</sitemapindex>`;

test('sitemap: parses urlset and extracts URLs', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  assert.equal(urls.length, 4);
  assert.equal(urls[0].loc, 'https://example.com/products/mouse-a');
});

test('sitemap: extracts lastmod when present', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  assert.equal(urls[0].lastmod, '2026-01-15');
  assert.equal(urls[2].lastmod, null); // /about has no lastmod
});

test('sitemap: detects sitemap index and returns child sitemaps', () => {
  const result = parseSitemapXml(SITEMAP_INDEX);
  assert.ok(result.length === 2);
  assert.ok(result[0].loc.includes('sitemap-products.xml'));
  assert.ok(result[0].isSitemapIndex);
});

test('sitemap: handles empty or invalid XML', () => {
  assert.deepEqual(parseSitemapXml(''), []);
  assert.deepEqual(parseSitemapXml('not xml at all'), []);
  assert.deepEqual(parseSitemapXml(null), []);
});

test('inventory: builds domain inventory from parsed URLs', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  const inventory = buildSitemapInventory({ domain: 'example.com', urls });
  assert.equal(inventory.domain, 'example.com');
  assert.equal(inventory.total_urls, 4);
  assert.ok(inventory.urls.length === 4);
});

test('inventory: tracks path patterns', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  const inventory = buildSitemapInventory({ domain: 'example.com', urls });
  assert.ok(inventory.path_patterns.some((p) => p.pattern === '/products/'));
  assert.ok(inventory.path_patterns.find((p) => p.pattern === '/products/').count >= 3);
});

test('filter: filters URLs matching product path patterns', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  const filtered = filterProductUrls({
    urls,
    pathPatterns: ['/products/']
  });
  assert.equal(filtered.length, 3);
  assert.ok(filtered.every((u) => u.loc.includes('/products/')));
});

test('filter: returns all when no patterns specified', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  const filtered = filterProductUrls({ urls, pathPatterns: [] });
  assert.equal(filtered.length, 4);
});

test('filter: keyword filter matches URL paths', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  const filtered = filterProductUrls({
    urls,
    keywords: ['mouse']
  });
  assert.equal(filtered.length, 2);
});

test('inventory: sortByLastmod sorts newest first', () => {
  const urls = parseSitemapXml(SAMPLE_SITEMAP);
  const inventory = buildSitemapInventory({ domain: 'example.com', urls });
  const sorted = inventory.urls.filter((u) => u.lastmod).sort((a, b) =>
    b.lastmod.localeCompare(a.lastmod)
  );
  assert.equal(sorted[0].lastmod, '2026-02-01');
});
