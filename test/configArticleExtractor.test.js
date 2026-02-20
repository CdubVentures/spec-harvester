import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('config: parses article extractor env flags', () => {
  const prevEnabled = process.env.ARTICLE_EXTRACTOR_V2;
  const prevMinChars = process.env.ARTICLE_EXTRACTOR_MIN_CHARS;
  const prevMinScore = process.env.ARTICLE_EXTRACTOR_MIN_SCORE;
  const prevMaxChars = process.env.ARTICLE_EXTRACTOR_MAX_CHARS;
  try {
    process.env.ARTICLE_EXTRACTOR_V2 = 'false';
    process.env.ARTICLE_EXTRACTOR_MIN_CHARS = '900';
    process.env.ARTICLE_EXTRACTOR_MIN_SCORE = '60';
    process.env.ARTICLE_EXTRACTOR_MAX_CHARS = '18000';

    const cfg = loadConfig({ runProfile: 'standard' });
    assert.equal(cfg.articleExtractorV2Enabled, false);
    assert.equal(cfg.articleExtractorMinChars, 900);
    assert.equal(cfg.articleExtractorMinScore, 60);
    assert.equal(cfg.articleExtractorMaxChars, 18000);
  } finally {
    if (prevEnabled === undefined) delete process.env.ARTICLE_EXTRACTOR_V2;
    else process.env.ARTICLE_EXTRACTOR_V2 = prevEnabled;
    if (prevMinChars === undefined) delete process.env.ARTICLE_EXTRACTOR_MIN_CHARS;
    else process.env.ARTICLE_EXTRACTOR_MIN_CHARS = prevMinChars;
    if (prevMinScore === undefined) delete process.env.ARTICLE_EXTRACTOR_MIN_SCORE;
    else process.env.ARTICLE_EXTRACTOR_MIN_SCORE = prevMinScore;
    if (prevMaxChars === undefined) delete process.env.ARTICLE_EXTRACTOR_MAX_CHARS;
    else process.env.ARTICLE_EXTRACTOR_MAX_CHARS = prevMaxChars;
  }
});
