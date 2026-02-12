import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEndpointSignals, mineEndpointSignals } from '../src/intel/endpointMiner.js';
import { aggregateTemporalSignals, extractTemporalSignals } from '../src/intel/temporalSignals.js';

test('endpoint miner extracts ranked endpoint signals and suggestions', () => {
  const mined = mineEndpointSignals({
    source: {
      url: 'https://manufacturer.com/product/m100'
    },
    pageData: {
      networkResponses: [
        {
          request_url: 'https://api.manufacturer.com/v1/products/123/specs',
          request_method: 'GET',
          status: 200,
          classification: 'specs',
          isGraphQl: false,
          jsonFull: { specs: { dpi: 26000, sensor: 'Focus' } }
        },
        {
          request_url: 'https://api.manufacturer.com/v1/products/124/specs',
          request_method: 'GET',
          status: 200,
          classification: 'specs',
          isGraphQl: false,
          jsonFull: { specs: { dpi: 26000, sensor: 'Focus' } }
        },
        {
          request_url: 'https://manufacturer.com/support/m100/specifications',
          request_method: 'GET',
          status: 200,
          classification: 'product_payload',
          isGraphQl: false
        }
      ]
    },
    criticalFields: ['sensor', 'dpi']
  });

  assert.equal(mined.endpointSignals.length >= 2, true);
  assert.equal(mined.endpointSignals[0].signal_score > 0, true);
  assert.equal(mined.endpointSignals.some((row) => row.field_hints.includes('sensor')), true);
  assert.equal(mined.nextBestUrls.length >= 1, true);

  const aggregated = aggregateEndpointSignals([
    {
      url: 'https://manufacturer.com/product/m100',
      endpointSignals: mined.endpointSignals
    }
  ]);

  assert.equal(aggregated.endpoint_count >= 1, true);
  assert.equal(aggregated.top_endpoints[0].source_count, 1);
});

test('temporal extractor aggregates date and version hints', () => {
  const temporal = extractTemporalSignals({
    source: {
      url: 'https://manufacturer.com/product/m100'
    },
    pageData: {
      title: 'Acme M100 - Updated January 6, 2025',
      finalUrl: 'https://manufacturer.com/product/m100-v2-2025',
      html: '<html><body>Firmware v2.1.0 released 2025-01-06</body></html>',
      networkResponses: [
        {
          request_url: 'https://manufacturer.com/api/specs?version=2.1.0&updated=2025-01-06'
        }
      ]
    },
    fieldCandidates: [
      {
        field: 'sensor_date',
        value: '2025-01-06'
      }
    ]
  });

  assert.equal(temporal.date_hints.length >= 1, true);
  assert.equal(temporal.version_hints.length >= 1, true);

  const aggregate = aggregateTemporalSignals([
    {
      url: 'https://manufacturer.com/product/m100',
      temporalSignals: temporal
    }
  ]);

  assert.equal(aggregate.date_hint_count >= 1, true);
  assert.equal(aggregate.version_hint_count >= 1, true);
});
