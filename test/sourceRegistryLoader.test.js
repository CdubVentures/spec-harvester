import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCategoryConfig } from '../src/categories/loader.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('loadCategoryConfig maps rich source registry metadata to source hosts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase4-source-registry-'));
  const helperRoot = path.join(root, 'helper_files');
  const category = 'mouse';
  try {
    await writeJson(path.join(helperRoot, category, '_generated', 'field_rules.json'), {
      category: 'mouse',
      fields: {
        weight: {
          required_level: 'required',
          availability: 'expected',
          difficulty: 'easy'
        }
      }
    });

    await writeJson(path.join(helperRoot, category, 'sources.json'), {
      category: 'mouse',
      version: '1.0.0',
      approved: {
        manufacturer: [],
        lab: [],
        database: [],
        retailer: []
      },
      sources: {
        razer_com: {
          display_name: 'Razer',
          tier: 'tier1_manufacturer',
          base_url: 'https://www.razer.com',
          crawl_config: {
            method: 'playwright',
            rate_limit_ms: 2200,
            robots_txt_compliant: true
          },
          field_coverage: {
            high: ['weight', 'dpi']
          }
        },
        rtings_com: {
          display_name: 'RTINGS',
          tier: 'tier2_lab',
          base_url: 'https://www.rtings.com',
          crawl_config: {
            method: 'playwright',
            rate_limit_ms: 3000,
            robots_txt_compliant: true
          }
        }
      }
    });

    const config = await loadCategoryConfig(category, {
      config: {
        helperFilesRoot: helperRoot
      }
    });

    const hostMap = config.sourceHostMap || new Map();
    assert.equal(hostMap.has('razer.com'), true);
    assert.equal(hostMap.has('rtings.com'), true);

    const razer = hostMap.get('razer.com');
    assert.equal(razer.sourceId, 'razer_com');
    assert.equal(razer.tierName, 'manufacturer');
    assert.equal(razer.crawlConfig.rate_limit_ms, 2200);
    assert.equal(razer.robotsTxtCompliant, true);

    const sourceHosts = new Set((config.sourceHosts || []).map((row) => row.host));
    assert.equal(sourceHosts.has('razer.com'), true);
    assert.equal(sourceHosts.has('rtings.com'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
