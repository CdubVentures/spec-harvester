import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rerankSerpResults } from '../src/research/serpReranker.js';

function makeResult({ url, title = '', snippet = '', host = '', tier, identity_match_level, variant_guard_hit, multi_model_hint }) {
  return {
    url,
    title,
    snippet,
    host: host || new URL(url).hostname.replace(/^www\./, ''),
    tier,
    identity_match_level,
    variant_guard_hit,
    multi_model_hint
  };
}

describe('serpReranker enhancements', () => {
  const baseConfig = { llmEnabled: false };
  const identity = { brand: 'Razer', model: 'Viper V3 Pro', variant: '' };

  it('deterministic scoring applies identity_match_level boost/penalty', async () => {
    const results = [
      makeResult({
        url: 'https://razer.com/mice/viper-v3-pro',
        title: 'Razer Viper V3 Pro',
        snippet: 'Official specs',
        identity_match_level: 'strong'
      }),
      makeResult({
        url: 'https://random.com/stuff',
        title: 'Random page',
        snippet: 'Nothing relevant',
        identity_match_level: 'none'
      })
    ];
    const ranked = await rerankSerpResults({
      config: baseConfig,
      identity,
      serpResults: results,
      topK: 10
    });
    assert.ok(ranked.length >= 1);
    const razerIdx = ranked.findIndex(r => r.url.includes('razer.com'));
    const randomIdx = ranked.findIndex(r => r.url.includes('random.com'));
    if (razerIdx >= 0 && randomIdx >= 0) {
      assert.ok(ranked[razerIdx].rerank_score > ranked[randomIdx].rerank_score,
        'Strong identity match should rank higher than none');
    }
  });

  it('variant guard hit applies heavy penalty', async () => {
    const results = [
      makeResult({
        url: 'https://rtings.com/razer-viper-v3-pro-review',
        title: 'Razer Viper V3 Pro Review',
        snippet: 'Full review',
        variant_guard_hit: false,
        identity_match_level: 'strong'
      }),
      makeResult({
        url: 'https://rtings.com/razer-viper-mini-review',
        title: 'Razer Viper Mini Review',
        snippet: 'Different mouse review',
        variant_guard_hit: true,
        identity_match_level: 'partial'
      })
    ];
    const ranked = await rerankSerpResults({
      config: baseConfig,
      identity,
      serpResults: results,
      topK: 10
    });
    const correctIdx = ranked.findIndex(r => r.url.includes('v3-pro'));
    const guardIdx = ranked.findIndex(r => r.url.includes('mini'));
    if (correctIdx >= 0 && guardIdx >= 0) {
      assert.ok(ranked[correctIdx].rerank_score > ranked[guardIdx].rerank_score,
        'Non-variant-guard result should rank higher');
    }
  });

  it('score breakdown is returned with each result', async () => {
    const results = [
      makeResult({
        url: 'https://razer.com/mice/viper-v3-pro',
        title: 'Razer Viper V3 Pro',
        snippet: 'Specs',
        identity_match_level: 'strong'
      })
    ];
    const ranked = await rerankSerpResults({
      config: baseConfig,
      identity,
      serpResults: results,
      topK: 10
    });
    assert.ok(ranked.length >= 1);
    const first = ranked[0];
    assert.ok('score_breakdown' in first, 'Result should have score_breakdown');
    assert.ok(typeof first.score_breakdown === 'object');
    assert.ok('identity_bonus' in first.score_breakdown);
    assert.ok('base_score' in first.score_breakdown);
  });

  it('domain safety gate blocks unsafe domains from ranking', async () => {
    const results = [
      makeResult({
        url: 'https://good-review.com/razer-viper-v3-pro',
        title: 'Razer Viper V3 Pro Review',
        snippet: 'Good review',
        identity_match_level: 'strong'
      }),
      makeResult({
        url: 'https://adult-site.com/razer-viper',
        title: 'Razer Viper',
        snippet: 'Adult site',
        identity_match_level: 'partial'
      })
    ];
    const safetyGateResults = new Map([
      ['adult-site.com', { safe: false, classification: 'adult_content', reason: 'Adult site' }]
    ]);
    const ranked = await rerankSerpResults({
      config: baseConfig,
      identity,
      serpResults: results,
      topK: 10,
      domainSafetyResults: safetyGateResults
    });
    const hasUnsafe = ranked.some(r => r.url.includes('adult-site.com'));
    assert.equal(hasUnsafe, false, 'Unsafe domains should be filtered out');
  });
});
