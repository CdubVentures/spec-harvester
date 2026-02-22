import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDiscoveryOnlySourceUrl,
  isRobotsTxtUrl,
  isSitemapUrl,
  hasSitemapXmlSignals,
  isLikelyIndexableEndpointUrl,
  isSafeManufacturerFollowupUrl,
  isHelperSyntheticUrl,
  isHelperSyntheticSource
} from '../src/pipeline/helpers/urlHelpers.js';

test('isDiscoveryOnlySourceUrl detects robots.txt', () => {
  assert.ok(isDiscoveryOnlySourceUrl('https://example.com/robots.txt'));
});

test('isDiscoveryOnlySourceUrl detects sitemap', () => {
  assert.ok(isDiscoveryOnlySourceUrl('https://example.com/sitemap.xml'));
});

test('isDiscoveryOnlySourceUrl detects search', () => {
  assert.ok(isDiscoveryOnlySourceUrl('https://example.com/search'));
});

test('isDiscoveryOnlySourceUrl returns false for product page', () => {
  assert.ok(!isDiscoveryOnlySourceUrl('https://example.com/products/mouse-123'));
});

test('isDiscoveryOnlySourceUrl returns false for invalid url', () => {
  assert.ok(!isDiscoveryOnlySourceUrl('not-a-url'));
});

test('isRobotsTxtUrl detects robots.txt', () => {
  assert.ok(isRobotsTxtUrl('https://example.com/robots.txt'));
  assert.ok(!isRobotsTxtUrl('https://example.com/products'));
});

test('isSitemapUrl detects sitemap URLs', () => {
  assert.ok(isSitemapUrl('https://example.com/sitemap.xml'));
  assert.ok(isSitemapUrl('https://example.com/product-sitemap.xml'));
  assert.ok(!isSitemapUrl('https://example.com/products'));
});

test('hasSitemapXmlSignals detects XML markers', () => {
  assert.ok(hasSitemapXmlSignals('<urlset><url><loc>test</loc></url></urlset>'));
  assert.ok(hasSitemapXmlSignals('<sitemapindex>'));
  assert.ok(!hasSitemapXmlSignals('<html><body>content</body></html>'));
});

test('isLikelyIndexableEndpointUrl rejects .json and /api/', () => {
  assert.ok(!isLikelyIndexableEndpointUrl('https://example.com/api/v1/data'));
  assert.ok(!isLikelyIndexableEndpointUrl('https://example.com/data.json'));
  assert.ok(!isLikelyIndexableEndpointUrl('https://example.com/graphql'));
  assert.ok(isLikelyIndexableEndpointUrl('https://example.com/products/mouse'));
});

test('isSafeManufacturerFollowupUrl checks domain and path signals', () => {
  const source = { rootDomain: 'razer.com' };
  assert.ok(isSafeManufacturerFollowupUrl(source, 'https://www.razer.com/support/mouse'));
  assert.ok(isSafeManufacturerFollowupUrl(source, 'https://razer.com/products/viper'));
  assert.ok(!isSafeManufacturerFollowupUrl(source, 'https://other.com/products/viper'));
  assert.ok(!isSafeManufacturerFollowupUrl(source, 'https://razer.com/blog/news'));
});

test('isHelperSyntheticUrl detects helper_files:// prefix', () => {
  assert.ok(isHelperSyntheticUrl('helper_files://mouse/known_values.json'));
  assert.ok(!isHelperSyntheticUrl('https://example.com'));
  assert.ok(!isHelperSyntheticUrl(''));
});

test('isHelperSyntheticSource detects helper source objects', () => {
  assert.ok(isHelperSyntheticSource({ helperSource: true, url: 'https://a.com' }));
  assert.ok(isHelperSyntheticSource({ url: 'helper_files://test' }));
  assert.ok(isHelperSyntheticSource({ finalUrl: 'helper_files://test' }));
  assert.ok(!isHelperSyntheticSource({ url: 'https://a.com' }));
  assert.ok(!isHelperSyntheticSource(null));
});
