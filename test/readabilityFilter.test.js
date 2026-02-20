import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterReadableHtml,
  extractReadableText,
  truncateForTokenBudget
} from '../src/extract/readabilityFilter.js';

// ---------------------------------------------------------------------------
// Phase 02 — Evidence Extraction Quality: Readability Filter Tests
// ---------------------------------------------------------------------------

test('P02 filter: strips nav tags', () => {
  const html = '<div>Main content</div><nav>Menu links</nav><div>More content</div>';
  const result = filterReadableHtml(html);
  assert.ok(result.includes('Main content'));
  assert.ok(!result.includes('Menu links'));
});

test('P02 filter: strips header/footer tags', () => {
  const html = '<header>Site Logo</header><main>Specs: 54g</main><footer>Copyright</footer>';
  const result = filterReadableHtml(html);
  assert.ok(!result.includes('Site Logo'));
  assert.ok(!result.includes('Copyright'));
  assert.ok(result.includes('Specs: 54g'));
});

test('P02 filter: strips script and style tags', () => {
  const html = '<style>.x{color:red}</style><div>Weight: 54g</div><script>alert(1)</script>';
  const result = filterReadableHtml(html);
  assert.ok(!result.includes('color:red'));
  assert.ok(!result.includes('alert'));
  assert.ok(result.includes('Weight: 54g'));
});

test('P02 filter: strips HTML comments', () => {
  const html = '<!-- This is a comment --><div>Content</div><!-- Another comment -->';
  const result = filterReadableHtml(html);
  assert.ok(!result.includes('comment'));
  assert.ok(result.includes('Content'));
});

test('P02 filter: handles null/empty input', () => {
  assert.equal(filterReadableHtml(null), '');
  assert.equal(filterReadableHtml(''), '');
  assert.equal(filterReadableHtml(undefined), '');
});

test('P02 text: extracts readable text from HTML', () => {
  const html = '<div><h1>Razer Viper</h1><p>Weight: <strong>54</strong> grams</p></div>';
  const text = extractReadableText(html);
  assert.ok(text.includes('Razer Viper'));
  assert.ok(text.includes('Weight:'));
  assert.ok(text.includes('54'));
  assert.ok(!text.includes('<'));
});

test('P02 text: decodes HTML entities', () => {
  const html = '<div>5 &lt; 10 &amp; more &quot;text&quot;</div>';
  const text = extractReadableText(html);
  assert.ok(text.includes('5 < 10 & more "text"'));
});

test('P02 text: collapses excessive whitespace', () => {
  const html = '<div>   Lots    of   spaces   </div>\n\n\n\n\n<div>End</div>';
  const text = extractReadableText(html);
  assert.ok(!text.includes('    '));
  assert.ok(text.includes('Lots of spaces'));
});

test('P02 truncate: returns full text under limit', () => {
  const text = 'Short text';
  assert.equal(truncateForTokenBudget(text, 100), text);
});

test('P02 truncate: truncates at maxChars', () => {
  const text = 'a'.repeat(200);
  const result = truncateForTokenBudget(text, 50);
  assert.equal(result.length, 50);
});

test('P02 truncate: handles empty input', () => {
  assert.equal(truncateForTokenBudget('', 100), '');
  assert.equal(truncateForTokenBudget(null, 100), '');
});
