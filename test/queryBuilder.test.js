import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicAliases, buildSearchProfile, buildTargetedQueries } from '../src/search/queryBuilder.js';

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

test('buildSearchProfile uses field rules search hints and emits provenance', () => {
  const profile = buildSearchProfile({
    job: {
      category: 'mouse',
      identityLock: {
        brand: 'Alienware',
        model: 'AW610M',
        variant: ''
      }
    },
    categoryConfig: {
      category: 'mouse',
      fieldOrder: ['polling_rate'],
      sourceHosts: [
        { host: 'alienware.com', tierName: 'manufacturer' }
      ],
      searchTemplates: [],
      fieldRules: {
        fields: {
          polling_rate: {
            search_hints: {
              query_terms: ['polling_rate', 'report rate'],
              domain_hints: ['support.dell.com'],
              preferred_content_types: ['manual_pdf']
            },
            ui: {
              tooltip_md: 'Polling rate in Hz'
            }
          }
        }
      }
    },
    missingFields: ['polling_rate'],
    maxQueries: 24
  });

  assert.equal(Array.isArray(profile.identity_aliases), true);
  assert.equal(profile.identity_aliases.some((row) => row.alias === 'aw610m'), true);
  assert.equal(profile.query_rows.some((row) => row.hint_source === 'field_rules.search_hints'), true);
  assert.equal(profile.queries.some((query) => query.includes('site:support.dell.com')), true);
  assert.equal(profile.queries.some((query) => query.includes('polling_rate')), false);
});

test('buildDeterministicAliases emits spacing and hyphen model variants', () => {
  const aliases = buildDeterministicAliases({
    brand: 'Alienware',
    model: 'AW610M',
    variant: ''
  });
  const tokens = aliases.map((row) => row.alias);
  assert.equal(tokens.includes('aw610m'), true);
  assert.equal(tokens.includes('aw-610-m') || tokens.includes('aw-610m'), true);
  assert.equal(tokens.includes('aw 610 m') || tokens.includes('aw 610m'), true);
});
