import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEmbeddedState } from '../src/extractors/embeddedStateExtractor.js';

test('extractEmbeddedState parses NEXT_DATA, NUXT and APOLLO assignments', () => {
  const html = `
    <html><head>
      <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"model":"Viper"}}}</script>
      <script>
        window.__NUXT__ = {"model":"Viper","variant":"Wireless"};
        window.__APOLLO_STATE__ = {"brand":"Razer"};
      </script>
    </head></html>
  `;

  const embedded = extractEmbeddedState(html);
  assert.equal(embedded.nextData.props.pageProps.model, 'Viper');
  assert.equal(embedded.nuxtState.variant, 'Wireless');
  assert.equal(embedded.apolloState.brand, 'Razer');
});
