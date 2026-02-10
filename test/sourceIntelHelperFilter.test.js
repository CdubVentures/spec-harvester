import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceIntel, persistSourceIntel } from '../src/intel/sourceIntel.js';

function makeMemoryStorage() {
  const map = new Map();
  return {
    resolveOutputKey(...parts) {
      return ['specs/outputs', ...parts].join('/');
    },
    async readJsonOrNull(key) {
      const row = map.get(key);
      return row ? JSON.parse(row.toString('utf8')) : null;
    },
    async writeObject(key, body) {
      map.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
    }
  };
}

test('persistSourceIntel ignores helper pseudo domains from source rows and evidence', async () => {
  const storage = makeMemoryStorage();
  const config = {
    s3OutputPrefix: 'specs/outputs',
    fieldRewardHalfLifeDays: 45
  };

  await persistSourceIntel({
    storage,
    config,
    category: 'mouse',
    productId: 'mouse-logitech-g-pro-x-superlight-2-wireless',
    brand: 'Logitech',
    sourceResults: [
      {
        url: 'helper_files://mouse/trusted-a.json#0',
        finalUrl: 'helper_files://mouse/trusted-a.json#0',
        host: 'helper-files.local',
        rootDomain: 'helper-files.local',
        helperSource: true,
        approvedDomain: true,
        status: 200,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [{ field: 'weight', value: '60 g', method: 'helper_supportive' }]
      },
      {
        url: 'https://www.logitechg.com/en-us/products/gaming-mice/pro-x-superlight-2.html',
        finalUrl: 'https://www.logitechg.com/en-us/products/gaming-mice/pro-x-superlight-2.html',
        host: 'www.logitechg.com',
        rootDomain: 'logitechg.com',
        approvedDomain: true,
        status: 200,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [{ field: 'weight', value: '60 g', method: 'dom' }]
      }
    ],
    provenance: {
      weight: {
        value: '60 g',
        evidence: [
          {
            url: 'helper_files://mouse/trusted-a.json#0',
            host: 'helper-files.local',
            rootDomain: 'helper-files.local',
            method: 'helper_supportive'
          },
          {
            url: 'https://www.logitechg.com/en-us/products/gaming-mice/pro-x-superlight-2.html',
            host: 'www.logitechg.com',
            rootDomain: 'logitechg.com',
            method: 'dom'
          }
        ]
      }
    },
    categoryConfig: {
      approvedRootDomains: new Set(),
      criticalFieldSet: new Set(['weight'])
    },
    constraintAnalysis: {
      contradictions: []
    }
  });

  const loaded = await loadSourceIntel({
    storage,
    config,
    category: 'mouse'
  });
  const domains = loaded.data.domains || {};
  assert.equal(Boolean(domains['helper-files.local']), false);
  assert.equal(Boolean(domains['logitechg.com']), true);
});
