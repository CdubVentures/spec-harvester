import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTargetedQueries } from '../src/search/queryBuilder.js';

test('buildTargetedQueries uses normalized missing fields and helper tooltip hints', () => {
  const queries = buildTargetedQueries({
    job: {
      category: 'mouse',
      identityLock: {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: 'Wireless'
      }
    },
    categoryConfig: {
      category: 'mouse',
      fieldOrder: ['weight', 'polling_rate'],
      sourceHosts: [
        { host: 'logitechg.com', tierName: 'manufacturer' },
        { host: 'razer.com', tierName: 'manufacturer' }
      ],
      searchTemplates: []
    },
    missingFields: ['fields.polling_rate'],
    tooltipHints: {
      polling_rate: ['report rate', 'polling interval']
    },
    lexicon: {},
    learnedQueries: {},
    maxQueries: 20
  });

  assert.equal(queries.some((row) => row.includes('report rate specification')), true);
  assert.equal(queries.some((row) => row.includes('polling interval manual pdf')), true);
  assert.equal(queries.some((row) => row.includes('site:logitechg.com')), true);
  assert.equal(queries.some((row) => row.includes('site:razer.com')), false);
});
