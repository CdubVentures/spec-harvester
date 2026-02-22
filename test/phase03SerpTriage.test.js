import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSerpResults } from '../src/search/serpDedupe.js';
import { rerankSearchResults } from '../src/search/resultReranker.js';
import { rerankSerpResults } from '../src/research/serpReranker.js';
import {
  computeIdentityMatchLevel,
  detectVariantGuardHit,
  detectMultiModelHint
} from '../src/discovery/searchDiscovery.js';

function makeCategoryConfig() {
  return {
    category: 'mouse',
    fieldOrder: ['weight', 'sensor', 'dpi', 'polling_rate'],
    sourceHosts: [
      { host: 'razer.com', tierName: 'manufacturer', role: 'manufacturer', tier: 1 },
      { host: 'rtings.com', tierName: 'lab', role: 'review', tier: 2 },
      { host: 'techpowerup.com', tierName: 'lab', role: 'review', tier: 2 },
      { host: 'amazon.com', tierName: 'retailer', role: 'retailer', tier: 3 },
      { host: 'spam-site.biz', tierName: 'denied', role: 'denied', tier: 4 }
    ],
    denylist: ['spam-site.biz']
  };
}

describe('Phase 03 — SERP Dedupe Audit', () => {
  it('deduplicates URLs across providers and merges metadata', () => {
    const results = [
      { url: 'https://razer.com/mice/viper-v3-pro', provider: 'google', query: 'razer viper v3 pro specs' },
      { url: 'https://razer.com/mice/viper-v3-pro', provider: 'bing', query: 'razer viper v3 pro review' },
      { url: 'https://rtings.com/mouse/reviews/razer-viper-v3-pro', provider: 'google', query: 'razer viper v3 pro specs' }
    ];

    const { deduped, stats } = dedupeSerpResults(results);

    console.log(`[DEDUPE] input=${stats.total_input} output=${stats.total_output} removed=${stats.duplicates_removed}`);
    console.log(`[DEDUPE] providers_seen: ${stats.providers_seen}`);

    assert.equal(deduped.length, 2);
    assert.equal(stats.duplicates_removed, 1);

    const razer = deduped.find((r) => r.canonical_url.includes('razer.com'));
    assert.ok(razer);
    assert.deepEqual(razer.seen_by_providers.sort(), ['bing', 'google']);
    assert.equal(razer.cross_provider_count, 2);
    assert.deepEqual(razer.seen_in_queries.sort(), ['razer viper v3 pro review', 'razer viper v3 pro specs']);
  });

  it('strips tracking parameters for dedup comparison', () => {
    const results = [
      { url: 'https://example.com/page?utm_source=google&ref=abc&q=test', provider: 'google' },
      { url: 'https://example.com/page?utm_source=bing&fbclid=xyz&q=test', provider: 'bing' }
    ];

    const { deduped } = dedupeSerpResults(results);

    console.log(`[DEDUPE] tracking stripped: ${deduped.length} unique (from 2)`);

    assert.equal(deduped.length, 1);
  });

  it('normalizes trailing slashes and host case', () => {
    const results = [
      { url: 'https://Example.COM/page/', provider: 'google' },
      { url: 'https://example.com/page', provider: 'bing' }
    ];

    const { deduped } = dedupeSerpResults(results);
    assert.equal(deduped.length, 1);
  });
});

describe('Phase 03 — Deterministic Reranker (resultReranker.js)', () => {
  it('scores tier 1 manufacturer higher than tier 3 retailer', () => {
    const results = [
      { url: 'https://amazon.com/razer-viper', title: 'Razer Viper V3 Pro', snippet: 'Buy now' },
      { url: 'https://razer.com/mice/razer-viper-v3-pro', title: 'Razer Viper V3 Pro', snippet: 'Official specs' }
    ];

    const ranked = rerankSearchResults({
      results,
      categoryConfig: makeCategoryConfig(),
      missingFields: ['weight', 'sensor']
    });

    console.log('[RERANK-DET] scores:');
    for (const row of ranked) {
      console.log(`  ${row.host}: score=${row.score} tier=${row.tier} role=${row.role} approved=${row.approved_domain}`);
    }

    assert.ok(ranked[0].url.includes('razer.com'), 'manufacturer ranks first');
    assert.ok(ranked[0].score > ranked[1].score, 'manufacturer score > retailer score');
  });

  it('gives PDF paths a bonus', () => {
    const results = [
      { url: 'https://razer.com/support/viper-v3-pro-manual.pdf', title: 'Razer Manual', snippet: 'PDF manual' },
      { url: 'https://razer.com/mice/razer-viper-v3-pro', title: 'Razer Product Page', snippet: 'Product specs' }
    ];

    const ranked = rerankSearchResults({
      results,
      categoryConfig: makeCategoryConfig(),
      missingFields: ['weight']
    });

    console.log('[RERANK-DET] PDF vs page:');
    for (const row of ranked) {
      console.log(`  ${row.path}: score=${row.score}`);
    }

    const pdfRow = ranked.find((r) => r.path.endsWith('.pdf'));
    const pageRow = ranked.find((r) => !r.path.endsWith('.pdf'));
    assert.ok(pdfRow.score > pageRow.score, 'PDF gets bonus over product page');
  });

  it('filters out denied hosts', () => {
    const results = [
      { url: 'https://spam-site.biz/razer-viper', title: 'Razer Viper', snippet: 'Spam' },
      { url: 'https://razer.com/mice/razer-viper-v3-pro', title: 'Razer Viper V3 Pro', snippet: 'Official' }
    ];

    const ranked = rerankSearchResults({
      results,
      categoryConfig: makeCategoryConfig(),
      missingFields: ['weight']
    });

    console.log(`[RERANK-DET] denied host filter: ${ranked.length} results (from 2)`);

    assert.equal(ranked.length, 1);
    assert.ok(ranked[0].url.includes('razer.com'));
  });

  it('each result includes tier, role, approved_domain, host, path', () => {
    const results = [
      { url: 'https://rtings.com/mouse/reviews/razer-viper-v3-pro', title: 'Review', snippet: 'Lab review' }
    ];

    const ranked = rerankSearchResults({
      results,
      categoryConfig: makeCategoryConfig(),
      missingFields: ['weight']
    });

    const row = ranked[0];
    console.log(`[RERANK-DET] enrichment: tier=${row.tier} role=${row.role} host=${row.host} approved=${row.approved_domain}`);

    assert.ok(typeof row.tier === 'number');
    assert.ok(typeof row.role === 'string');
    assert.ok(typeof row.host === 'string');
    assert.ok(typeof row.path === 'string');
    assert.ok(typeof row.approved_domain === 'boolean');
    assert.ok(typeof row.score === 'number');
  });
});

describe('Phase 03 — Applicability Functions (pure)', () => {
  it('computeIdentityMatchLevel: strong when brand+model+variant all present', () => {
    const level = computeIdentityMatchLevel({
      url: 'https://razer.com/viper-v3-pro',
      title: 'Razer Viper V3 Pro Specifications',
      snippet: 'The Razer Viper V3 Pro gaming mouse',
      identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
    });

    console.log(`[IDENTITY] brand+model+variant → ${level}`);
    assert.equal(level, 'strong');
  });

  it('computeIdentityMatchLevel: partial/weak/none for decreasing matches', () => {
    const partial = computeIdentityMatchLevel({
      url: '', title: 'Razer Viper V3 Review', snippet: '',
      identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
    });
    const weak = computeIdentityMatchLevel({
      url: '', title: 'Latest Razer Products', snippet: '',
      identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
    });
    const none = computeIdentityMatchLevel({
      url: '', title: 'Best Gaming Mice', snippet: '',
      identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
    });

    console.log(`[IDENTITY] partial=${partial} weak=${weak} none=${none}`);

    assert.equal(partial, 'partial');
    assert.equal(weak, 'weak');
    assert.equal(none, 'none');
  });

  it('detectVariantGuardHit: true when wrong variant appears, false for target variant', () => {
    const hit = detectVariantGuardHit({
      title: 'Razer Viper V3 Hyperspeed', snippet: '',
      url: 'https://example.com/hyperspeed',
      variantGuardTerms: ['hyperspeed', 'pro'],
      targetVariant: 'Pro'
    });
    const noHit = detectVariantGuardHit({
      title: 'Razer Viper V3 Pro Review', snippet: '',
      url: 'https://example.com/pro',
      variantGuardTerms: ['hyperspeed', 'pro'],
      targetVariant: 'Pro'
    });

    console.log(`[GUARD] wrong variant hit=${hit}, target variant hit=${noHit}`);

    assert.equal(hit, true);
    assert.equal(noHit, false);
  });

  it('detectMultiModelHint: true for comparisons, top-N, and vs pages', () => {
    assert.equal(detectMultiModelHint({ title: 'Top 10 gaming mice', snippet: '' }), true);
    assert.equal(detectMultiModelHint({ title: 'Razer Viper vs Logitech G Pro', snippet: '' }), true);
    assert.equal(detectMultiModelHint({ title: 'Best wireless mice comparison', snippet: '' }), true);
    assert.equal(detectMultiModelHint({ title: 'Razer Viper V3 Pro Specs', snippet: '' }), false);

    console.log('[MULTI-MODEL] top-N=true, vs=true, comparison=true, single=false');
  });
});

describe('Phase 03 — SerpReranker Deterministic Scoring (with breakdown)', () => {
  it('identity_match_level strong gets higher score than none', async () => {
    const results = [
      {
        url: 'https://example.com/strong',
        title: 'Razer Viper V3 Pro',
        snippet: 'Specs',
        host: 'example.com',
        identity_match_level: 'strong'
      },
      {
        url: 'https://example.com/none',
        title: 'Random Page',
        snippet: 'Nothing',
        host: 'example.com',
        identity_match_level: 'none'
      }
    ];

    const ranked = await rerankSerpResults({
      config: { llmEnabled: false },
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' },
      serpResults: results,
      topK: 10
    });

    console.log('[SERP-RERANK] scores with identity:');
    for (const row of ranked) {
      console.log(`  ${row.url}: score=${row.rerank_score.toFixed(2)} breakdown=${JSON.stringify(row.score_breakdown)}`);
    }

    assert.ok(ranked[0].url.includes('strong'));
    assert.ok(ranked[0].rerank_score > ranked[1].rerank_score);
  });

  it('variant_guard_hit applies heavy penalty (-3.0)', async () => {
    const results = [
      {
        url: 'https://example.com/correct',
        title: 'Razer Viper V3 Pro Review',
        snippet: 'Full review',
        host: 'example.com',
        variant_guard_hit: false,
        identity_match_level: 'strong'
      },
      {
        url: 'https://example.com/wrong-variant',
        title: 'Razer Viper V3 Hyperspeed Review',
        snippet: 'Different model',
        host: 'example.com',
        variant_guard_hit: true,
        identity_match_level: 'partial'
      }
    ];

    const ranked = await rerankSerpResults({
      config: { llmEnabled: false },
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' },
      serpResults: results,
      topK: 10
    });

    const correct = ranked.find((r) => r.url.includes('correct'));
    const wrong = ranked.find((r) => r.url.includes('wrong-variant'));

    console.log(`[SERP-RERANK] variant guard: correct=${correct.rerank_score.toFixed(2)} wrong=${wrong.rerank_score.toFixed(2)}`);
    console.log(`[SERP-RERANK] variant_guard_penalty: ${wrong.score_breakdown.variant_guard_penalty}`);

    assert.ok(correct.rerank_score > wrong.rerank_score);
    assert.equal(wrong.score_breakdown.variant_guard_penalty, -3.0);
  });

  it('multi_model_hint applies penalty (-1.5)', async () => {
    const results = [
      {
        url: 'https://example.com/single',
        title: 'Razer Viper V3 Pro Specs',
        snippet: 'Single product page',
        host: 'example.com',
        multi_model_hint: false,
        identity_match_level: 'strong'
      },
      {
        url: 'https://example.com/multi',
        title: 'Razer Viper V3 Pro vs Logitech',
        snippet: 'Comparison page',
        host: 'example.com',
        multi_model_hint: true,
        identity_match_level: 'strong'
      }
    ];

    const ranked = await rerankSerpResults({
      config: { llmEnabled: false },
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' },
      serpResults: results,
      topK: 10
    });

    const single = ranked.find((r) => r.url.includes('single'));
    const multi = ranked.find((r) => r.url.includes('multi'));

    console.log(`[SERP-RERANK] multi-model: single=${single.rerank_score.toFixed(2)} multi=${multi.rerank_score.toFixed(2)}`);

    assert.ok(single.rerank_score > multi.rerank_score);
    assert.equal(multi.score_breakdown.multi_model_penalty, -1.5);
  });

  it('tier 1 gets tier_bonus of 1.5, tier 2 gets 0.5', async () => {
    const results = [
      {
        url: 'https://example.com/t1',
        title: 'Razer Viper V3 Pro',
        snippet: 'Specs',
        host: 'razer.com',
        tier: 1,
        identity_match_level: 'strong'
      },
      {
        url: 'https://example.com/t2',
        title: 'Razer Viper V3 Pro Review',
        snippet: 'Lab review',
        host: 'rtings.com',
        tier: 2,
        identity_match_level: 'strong'
      }
    ];

    const ranked = await rerankSerpResults({
      config: { llmEnabled: false },
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' },
      serpResults: results,
      topK: 10
    });

    const t1 = ranked.find((r) => r.url.includes('t1'));
    const t2 = ranked.find((r) => r.url.includes('t2'));

    console.log(`[SERP-RERANK] tier bonus: t1=${t1.score_breakdown.tier_bonus} t2=${t2.score_breakdown.tier_bonus}`);

    assert.equal(t1.score_breakdown.tier_bonus, 1.5);
    assert.equal(t2.score_breakdown.tier_bonus, 0.5);
  });

  it('score_breakdown contains all required components', async () => {
    const results = [{
      url: 'https://razer.com/mice/viper-v3-pro',
      title: 'Razer Viper V3 Pro',
      snippet: 'Specs',
      host: 'razer.com',
      identity_match_level: 'strong',
      variant_guard_hit: false,
      multi_model_hint: false,
      tier: 1
    }];

    const ranked = await rerankSerpResults({
      config: { llmEnabled: false },
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' },
      serpResults: results,
      topK: 10
    });

    const bd = ranked[0].score_breakdown;
    console.log('[SERP-RERANK] full breakdown:', JSON.stringify(bd));

    assert.ok('base_score' in bd);
    assert.ok('frontier_penalty' in bd);
    assert.ok('identity_bonus' in bd);
    assert.ok('variant_guard_penalty' in bd);
    assert.ok('multi_model_penalty' in bd);
    assert.ok('tier_bonus' in bd);
    assert.ok(typeof ranked[0].rerank_score === 'number');
    assert.equal(ranked[0].rerank_reason, 'deterministic');
  });

  it('domain safety gate filters unsafe domains', async () => {
    const results = [
      { url: 'https://good.com/review', title: 'Razer Viper Review', snippet: 'Good', host: 'good.com', identity_match_level: 'strong' },
      { url: 'https://bad.com/spam', title: 'Razer Viper', snippet: 'Spam', host: 'bad.com', identity_match_level: 'partial' }
    ];
    const safetyMap = new Map([['bad.com', { safe: false, classification: 'spam' }]]);

    const ranked = await rerankSerpResults({
      config: { llmEnabled: false },
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' },
      serpResults: results,
      topK: 10,
      domainSafetyResults: safetyMap
    });

    console.log(`[SERP-RERANK] safety gate: ${ranked.length} results (filtered from 2)`);

    assert.equal(ranked.length, 1);
    assert.ok(ranked[0].url.includes('good.com'));
  });
});

describe('Phase 03 — Two-Reranker Pipeline Integration', () => {
  it('resultReranker then serpReranker produce compatible output', async () => {
    const rawResults = [
      { url: 'https://razer.com/mice/razer-viper-v3-pro', title: 'Razer Viper V3 Pro', snippet: 'Official specs', provider: 'google' },
      { url: 'https://rtings.com/mouse/reviews/razer-viper-v3-pro', title: 'Razer Viper V3 Pro Review', snippet: 'Full lab review', provider: 'bing' },
      { url: 'https://amazon.com/razer-viper', title: 'Buy Razer Viper V3 Pro', snippet: 'Add to cart', provider: 'google' }
    ];

    const deterministicReranked = rerankSearchResults({
      results: rawResults,
      categoryConfig: makeCategoryConfig(),
      missingFields: ['weight', 'sensor']
    });

    console.log('[PIPELINE] resultReranker output:');
    for (const row of deterministicReranked) {
      console.log(`  ${row.host}: score=${row.score} tier=${row.tier}`);
    }

    const finalRanked = await rerankSerpResults({
      config: { llmEnabled: false },
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' },
      missingFields: ['weight', 'sensor'],
      serpResults: deterministicReranked,
      topK: 10
    });

    console.log('[PIPELINE] serpReranker output:');
    for (const row of finalRanked) {
      console.log(`  ${row.host}: rerank_score=${row.rerank_score.toFixed(2)} reason=${row.rerank_reason}`);
    }

    assert.ok(finalRanked.length >= 1);
    assert.ok(finalRanked.every((r) => typeof r.rerank_score === 'number'));
    assert.ok(finalRanked.every((r) => typeof r.rerank_reason === 'string'));
    assert.ok(finalRanked.every((r) => typeof r.score_breakdown === 'object'));

    assert.ok(finalRanked[0].url.includes('razer.com'), 'manufacturer still ranks first through both stages');
  });
});
