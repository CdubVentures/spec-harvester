import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLdJsonBlocks } from '../src/extractors/ldjsonExtractor.js';

test('extractLdJsonBlocks parses valid JSON-LD scripts and ignores invalid', () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">{"@type":"Product","name":"Mouse A"}</script>
        <script type="application/ld+json">[{"@type":"Thing","name":"x"}]</script>
        <script type="application/ld+json">{invalid}</script>
      </head>
    </html>
  `;

  const blocks = extractLdJsonBlocks(html);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].name, 'Mouse A');
  assert.equal(blocks[1].name, 'x');
});
