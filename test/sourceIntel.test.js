import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSourceExpansionPlans,
  loadSourceIntel,
  persistSourceIntel,
  sourceIntelKey
} from '../src/intel/sourceIntel.js';

function makeMemoryStorage() {
  const map = new Map();

  return {
    async readJsonOrNull(key) {
      const raw = map.get(key);
      return raw ? JSON.parse(raw.toString('utf8')) : null;
    },
    async writeObject(key, body) {
      map.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
    getMap() {
      return map;
    }
  };
}

test('persistSourceIntel writes aggregate stats and promotion suggestion report', async () => {
  const storage = makeMemoryStorage();
  const config = {
    s3OutputPrefix: 'specs/outputs'
  };

  const sourceResults = [
    {
      host: 'approved-a.com',
      rootDomain: 'approved-a.com',
      approvedDomain: true,
      status: 200,
      identity: { match: true },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: [{ field: 'sensor', value: 'Focus Pro 35K' }]
    },
    {
      host: 'candidate-b.com',
      rootDomain: 'candidate-b.com',
      approvedDomain: false,
      status: 200,
      identity: { match: true },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: [{ field: 'weight', value: '54' }]
    }
  ];

  const provenance = {
    sensor: {
      value: 'Focus Pro 35K',
      evidence: [{ rootDomain: 'approved-a.com' }]
    },
    weight: {
      value: 'unk',
      evidence: []
    }
  };

  const result = await persistSourceIntel({
    storage,
    config,
    category: 'mouse',
    productId: 'mouse-a',
    brand: 'Razer',
    sourceResults,
    provenance,
    categoryConfig: {
      criticalFieldSet: new Set(['sensor']),
      approvedRootDomains: new Set(['approved-a.com'])
    }
  });

  assert.equal(result.domainStatsKey, sourceIntelKey(config, 'mouse'));
  assert.equal(result.promotionSuggestionsKey.includes('/promotion_suggestions/'), true);
  assert.equal(result.expansionPlanKey.includes('/expansion_plans/'), true);

  const intel = await loadSourceIntel({ storage, config, category: 'mouse' });
  const domain = intel.data.domains['approved-a.com'];
  const brandStats = domain.per_brand.razer;

  assert.equal(domain.attempts, 1);
  assert.equal(domain.identity_match_count, 1);
  assert.equal(domain.fields_accepted_count, 1);
  assert.equal(domain.accepted_critical_fields_count, 1);
  assert.equal(domain.products_seen, 1);
  assert.equal(brandStats.attempts, 1);
  assert.equal(brandStats.fields_accepted_count, 1);
  assert.equal(domain.per_field_accept_count.sensor, 1);
  assert.equal(typeof domain.last_seen_at, 'string');
});

test('generateSourceExpansionPlans emits per-brand candidate suggestions', async () => {
  const storage = makeMemoryStorage();
  const config = {
    s3OutputPrefix: 'specs/outputs'
  };

  await storage.writeObject(
    'specs/outputs/_source_intel/mouse/domain_stats.json',
    Buffer.from(JSON.stringify({
      category: 'mouse',
      updated_at: new Date().toISOString(),
      domains: {
        'candidate-db.com': {
          rootDomain: 'candidate-db.com',
          attempts: 5,
          http_ok_count: 5,
          identity_match_count: 5,
          major_anchor_conflict_count: 0,
          fields_contributed_count: 100,
          fields_accepted_count: 8,
          accepted_critical_fields_count: 2,
          products_seen: 4,
          recent_products: ['mouse-a', 'mouse-b'],
          approved_attempts: 0,
          candidate_attempts: 5,
          per_field_helpfulness: { sensor: 4, polling_rate: 3 },
          http_ok_rate: 1,
          identity_match_rate: 1,
          major_anchor_conflict_rate: 0,
          acceptance_yield: 0.08,
          planner_score: 0.9,
          per_brand: {
            razer: {
              brand: 'Razer',
              brand_key: 'razer',
              attempts: 5,
              http_ok_count: 5,
              identity_match_count: 5,
              major_anchor_conflict_count: 0,
              fields_contributed_count: 100,
              fields_accepted_count: 6,
              accepted_critical_fields_count: 1,
              products_seen: 3,
              recent_products: ['mouse-a', 'mouse-b'],
              approved_attempts: 0,
              candidate_attempts: 5,
              per_field_helpfulness: { sensor: 4, polling_rate: 2 },
              http_ok_rate: 1,
              identity_match_rate: 1,
              major_anchor_conflict_rate: 0,
              acceptance_yield: 0.06,
              planner_score: 0.88
            }
          }
        }
      }
    }, null, 2), 'utf8')
  );

  const result = await generateSourceExpansionPlans({
    storage,
    config,
    category: 'mouse',
    categoryConfig: {
      approvedRootDomains: new Set(['approved-a.com'])
    }
  });

  assert.equal(result.expansionPlanKey.includes('/expansion_plans/'), true);
  assert.equal(result.planCount, 1);
  assert.equal(result.brandPlanKeys.length, 1);
});
