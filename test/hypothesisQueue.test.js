import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHypothesisQueue, nextBestUrlsFromHypotheses } from '../src/learning/hypothesisQueue.js';

test('hypothesis queue prioritizes critical missing fields with suggestions', () => {
  const queue = buildHypothesisQueue({
    criticalFieldsBelowPassTarget: ['sensor'],
    missingRequiredFields: ['sensor'],
    provenance: {
      sensor: {
        value: 'unk',
        confidence: 0.1,
        meets_pass_target: false
      }
    },
    sourceResults: [
      {
        url: 'https://manufacturer.com/product/m100',
        finalUrl: 'https://manufacturer.com/product/m100',
        rootDomain: 'manufacturer.com',
        host: 'manufacturer.com',
        role: 'manufacturer',
        approvedDomain: true,
        tier: 1,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          {
            field: 'sensor',
            value: 'PixArt 3395',
            method: 'network_json',
            keyPath: 'payload.sensor'
          }
        ],
        endpointSuggestions: [
          {
            url: 'https://manufacturer.com/support/m100/specs',
            score: 5,
            reason: 'endpoint_signal',
            field_hints: ['sensor'],
            rootDomain: 'manufacturer.com',
            endpoint: 'manufacturer.com/support/m100/specs'
          }
        ]
      }
    ],
    sourceIntelDomains: {
      'manufacturer.com': {
        rootDomain: 'manufacturer.com',
        planner_score: 0.9,
        per_field_helpfulness: { sensor: 5 },
        per_path: {
          '/support/m100/specs': {
            path: '/support/m100/specs',
            planner_score: 0.93,
            per_field_helpfulness: { sensor: 3 }
          }
        }
      }
    },
    criticalFieldSet: new Set(['sensor'])
  });

  assert.equal(queue.length, 1);
  assert.equal(queue[0].field, 'sensor');
  assert.equal(queue[0].suggestion_count >= 1, true);

  const nextBest = nextBestUrlsFromHypotheses({
    hypothesisQueue: queue,
    field: 'sensor',
    limit: 5
  });

  assert.equal(nextBest.length >= 1, true);
  assert.equal(nextBest[0].field, 'sensor');
});
