import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCategoryConfig } from '../src/categories/loader.js';

test('loadCategoryConfig merges S3 source override while preserving denylist', async () => {
  const storage = {
    async readJsonOrNull(key) {
      if (key === 'specs/inputs/_sources/overrides/mouse/sources.override.json') {
        return {
          approved: {
            database: ['newdb.example.com'],
            lab: ['newlab.example.com']
          },
          denylist: ['bad-source.example.com']
        };
      }
      return null;
    }
  };

  const categoryConfig = await loadCategoryConfig('mouse', {
    storage,
    config: {
      s3InputPrefix: 'specs/inputs'
    }
  });

  const approvedHosts = new Set(categoryConfig.sourceHosts.map((item) => item.host));
  assert.equal(approvedHosts.has('newdb.example.com'), true);
  assert.equal(approvedHosts.has('newlab.example.com'), true);
  assert.equal(categoryConfig.denylist.includes('bad-source.example.com'), true);
  assert.equal(
    categoryConfig.sources_override_key,
    'specs/inputs/_sources/overrides/mouse/sources.override.json'
  );
});
