import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('config: parses article extractor env flags', () => {
  const prevEnabled = process.env.ARTICLE_EXTRACTOR_V2;
  const prevMinChars = process.env.ARTICLE_EXTRACTOR_MIN_CHARS;
  const prevMinScore = process.env.ARTICLE_EXTRACTOR_MIN_SCORE;
  const prevMaxChars = process.env.ARTICLE_EXTRACTOR_MAX_CHARS;
  const prevDomainPolicy = process.env.ARTICLE_EXTRACTOR_DOMAIN_POLICY_MAP_JSON;
  const prevHtmlTableV2 = process.env.HTML_TABLE_EXTRACTOR_V2;
  const prevStructuredEnabled = process.env.STRUCTURED_METADATA_EXTRUCT_ENABLED;
  const prevStructuredUrl = process.env.STRUCTURED_METADATA_EXTRUCT_URL;
  const prevStructuredTimeout = process.env.STRUCTURED_METADATA_EXTRUCT_TIMEOUT_MS;
  const prevPdfRouterEnabled = process.env.PDF_BACKEND_ROUTER_ENABLED;
  const prevPdfPreferredBackend = process.env.PDF_PREFERRED_BACKEND;
  const prevPdfRouterTimeout = process.env.PDF_BACKEND_ROUTER_TIMEOUT_MS;
  const prevPdfRouterMaxPages = process.env.PDF_BACKEND_ROUTER_MAX_PAGES;
  const prevPdfRouterMaxPairs = process.env.PDF_BACKEND_ROUTER_MAX_PAIRS;
  const prevPdfRouterPreviewChars = process.env.PDF_BACKEND_ROUTER_MAX_TEXT_PREVIEW_CHARS;
  try {
    process.env.ARTICLE_EXTRACTOR_V2 = 'false';
    process.env.ARTICLE_EXTRACTOR_MIN_CHARS = '900';
    process.env.ARTICLE_EXTRACTOR_MIN_SCORE = '60';
    process.env.ARTICLE_EXTRACTOR_MAX_CHARS = '18000';
    process.env.ARTICLE_EXTRACTOR_DOMAIN_POLICY_MAP_JSON = JSON.stringify({
      'rtings.com': {
        mode: 'prefer_readability',
        minChars: 450
      }
    });
    process.env.HTML_TABLE_EXTRACTOR_V2 = 'false';
    process.env.STRUCTURED_METADATA_EXTRUCT_ENABLED = 'true';
    process.env.STRUCTURED_METADATA_EXTRUCT_URL = 'http://127.0.0.1:8111/extract/structured';
    process.env.STRUCTURED_METADATA_EXTRUCT_TIMEOUT_MS = '3500';
    process.env.PDF_BACKEND_ROUTER_ENABLED = 'true';
    process.env.PDF_PREFERRED_BACKEND = 'camelot';
    process.env.PDF_BACKEND_ROUTER_TIMEOUT_MS = '160000';
    process.env.PDF_BACKEND_ROUTER_MAX_PAGES = '80';
    process.env.PDF_BACKEND_ROUTER_MAX_PAIRS = '8000';
    process.env.PDF_BACKEND_ROUTER_MAX_TEXT_PREVIEW_CHARS = '28000';

    const cfg = loadConfig({ runProfile: 'standard' });
    assert.equal(cfg.articleExtractorV2Enabled, false);
    assert.equal(cfg.articleExtractorMinChars, 900);
    assert.equal(cfg.articleExtractorMinScore, 60);
    assert.equal(cfg.articleExtractorMaxChars, 18000);
    assert.equal(cfg.articleExtractorDomainPolicyMap?.['rtings.com']?.mode, 'prefer_readability');
    assert.equal(cfg.articleExtractorDomainPolicyMap?.['rtings.com']?.minChars, 450);
    assert.equal(cfg.htmlTableExtractorV2, false);
    assert.equal(cfg.structuredMetadataExtructEnabled, true);
    assert.equal(cfg.structuredMetadataExtructUrl, 'http://127.0.0.1:8111/extract/structured');
    assert.equal(cfg.structuredMetadataExtructTimeoutMs, 3500);
    assert.equal(cfg.pdfBackendRouterEnabled, true);
    assert.equal(cfg.pdfPreferredBackend, 'camelot');
    assert.equal(cfg.pdfBackendRouterTimeoutMs, 160000);
    assert.equal(cfg.pdfBackendRouterMaxPages, 80);
    assert.equal(cfg.pdfBackendRouterMaxPairs, 8000);
    assert.equal(cfg.pdfBackendRouterMaxTextPreviewChars, 28000);
  } finally {
    if (prevEnabled === undefined) delete process.env.ARTICLE_EXTRACTOR_V2;
    else process.env.ARTICLE_EXTRACTOR_V2 = prevEnabled;
    if (prevMinChars === undefined) delete process.env.ARTICLE_EXTRACTOR_MIN_CHARS;
    else process.env.ARTICLE_EXTRACTOR_MIN_CHARS = prevMinChars;
    if (prevMinScore === undefined) delete process.env.ARTICLE_EXTRACTOR_MIN_SCORE;
    else process.env.ARTICLE_EXTRACTOR_MIN_SCORE = prevMinScore;
    if (prevMaxChars === undefined) delete process.env.ARTICLE_EXTRACTOR_MAX_CHARS;
    else process.env.ARTICLE_EXTRACTOR_MAX_CHARS = prevMaxChars;
    if (prevDomainPolicy === undefined) delete process.env.ARTICLE_EXTRACTOR_DOMAIN_POLICY_MAP_JSON;
    else process.env.ARTICLE_EXTRACTOR_DOMAIN_POLICY_MAP_JSON = prevDomainPolicy;
    if (prevHtmlTableV2 === undefined) delete process.env.HTML_TABLE_EXTRACTOR_V2;
    else process.env.HTML_TABLE_EXTRACTOR_V2 = prevHtmlTableV2;
    if (prevStructuredEnabled === undefined) delete process.env.STRUCTURED_METADATA_EXTRUCT_ENABLED;
    else process.env.STRUCTURED_METADATA_EXTRUCT_ENABLED = prevStructuredEnabled;
    if (prevStructuredUrl === undefined) delete process.env.STRUCTURED_METADATA_EXTRUCT_URL;
    else process.env.STRUCTURED_METADATA_EXTRUCT_URL = prevStructuredUrl;
    if (prevStructuredTimeout === undefined) delete process.env.STRUCTURED_METADATA_EXTRUCT_TIMEOUT_MS;
    else process.env.STRUCTURED_METADATA_EXTRUCT_TIMEOUT_MS = prevStructuredTimeout;
    if (prevPdfRouterEnabled === undefined) delete process.env.PDF_BACKEND_ROUTER_ENABLED;
    else process.env.PDF_BACKEND_ROUTER_ENABLED = prevPdfRouterEnabled;
    if (prevPdfPreferredBackend === undefined) delete process.env.PDF_PREFERRED_BACKEND;
    else process.env.PDF_PREFERRED_BACKEND = prevPdfPreferredBackend;
    if (prevPdfRouterTimeout === undefined) delete process.env.PDF_BACKEND_ROUTER_TIMEOUT_MS;
    else process.env.PDF_BACKEND_ROUTER_TIMEOUT_MS = prevPdfRouterTimeout;
    if (prevPdfRouterMaxPages === undefined) delete process.env.PDF_BACKEND_ROUTER_MAX_PAGES;
    else process.env.PDF_BACKEND_ROUTER_MAX_PAGES = prevPdfRouterMaxPages;
    if (prevPdfRouterMaxPairs === undefined) delete process.env.PDF_BACKEND_ROUTER_MAX_PAIRS;
    else process.env.PDF_BACKEND_ROUTER_MAX_PAIRS = prevPdfRouterMaxPairs;
    if (prevPdfRouterPreviewChars === undefined) delete process.env.PDF_BACKEND_ROUTER_MAX_TEXT_PREVIEW_CHARS;
    else process.env.PDF_BACKEND_ROUTER_MAX_TEXT_PREVIEW_CHARS = prevPdfRouterPreviewChars;
  }
});
