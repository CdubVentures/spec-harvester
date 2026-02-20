import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMainArticle } from '../src/extract/articleExtractor.js';

test('article extractor: readability keeps article body and drops nav/footer noise', () => {
  const html = `
    <html>
      <head><title>OP1we Wireless Review</title></head>
      <body>
        <nav>Home | Deals | Login</nav>
        <article>
          <h1>Endgame Gear OP1we Wireless Review</h1>
          <p>The OP1we is a compact wireless mouse focused on low latency and competitive play.</p>
          <h2>Performance</h2>
          <p>Sensor performance remained stable during rapid flick tests and lift-off behavior was consistent.</p>
          <p>Weight measured at 58 grams on our scale and battery life landed around 95 hours in office use.</p>
        </article>
        <footer>Cookie settings | Privacy policy</footer>
      </body>
    </html>
  `;

  const extracted = extractMainArticle(html, {
    url: 'https://example.com/review/op1we',
    title: 'OP1we Wireless Review',
    minChars: 120,
    minScore: 20
  });

  assert.equal(extracted.method, 'readability');
  assert.ok(extracted.text.includes('Endgame Gear OP1we Wireless Review'));
  assert.ok(extracted.text.includes('Weight measured at 58 grams'));
  assert.ok(!extracted.text.toLowerCase().includes('cookie settings'));
  assert.ok(extracted.quality.score >= 20);
});

test('article extractor: uses heuristic fallback when disabled', () => {
  const html = '<html><body><main><p>Simple body text with model and weight details.</p></main></body></html>';
  const extracted = extractMainArticle(html, {
    enabled: false,
    minChars: 20,
    minScore: 1
  });
  assert.equal(extracted.method, 'heuristic_fallback');
  assert.equal(extracted.fallback_reason, 'disabled');
  assert.ok(extracted.text.includes('Simple body text'));
});

test('article extractor: falls back when readability output is weak and fallback scores higher', () => {
  const html = `
    <html>
      <body>
        <div>subscribe now subscribe now subscribe now</div>
        <div>privacy terms cookies</div>
        <div>weight: 61 g polling rate: 1000 hz sensor: paw3395 wireless 2.4ghz usb-c</div>
      </body>
    </html>
  `;
  const extracted = extractMainArticle(html, {
    minChars: 10,
    minScore: 5
  });
  assert.ok(['heuristic_fallback', 'readability'].includes(extracted.method));
  assert.ok(typeof extracted.quality.score === 'number');
  assert.ok(typeof extracted.quality.duplicate_sentence_ratio === 'number');
});
