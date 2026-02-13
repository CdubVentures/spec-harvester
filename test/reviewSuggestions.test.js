import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendReviewSuggestion } from '../src/review/suggestions.js';

test('appendReviewSuggestion writes enum/component/alias suggestions and deduplicates entries', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-suggestions-'));
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  try {
    const enumOne = await appendReviewSuggestion({
      config,
      category: 'mouse',
      type: 'enum',
      payload: {
        product_id: 'mouse-a',
        field: 'switch_type',
        value: 'optical-v2',
        evidence: {
          url: 'https://example.com/specs',
          quote: 'Switch Type: Optical V2'
        }
      }
    });
    assert.equal(enumOne.appended, true);
    assert.equal(enumOne.total_count, 1);

    const enumDup = await appendReviewSuggestion({
      config,
      category: 'mouse',
      type: 'enum',
      payload: {
        product_id: 'mouse-a',
        field: 'switch_type',
        value: 'optical-v2',
        evidence: {
          url: 'https://example.com/specs',
          quote: 'Switch Type: Optical V2'
        }
      }
    });
    assert.equal(enumDup.appended, false);
    assert.equal(enumDup.total_count, 1);

    const component = await appendReviewSuggestion({
      config,
      category: 'mouse',
      type: 'component',
      payload: {
        product_id: 'mouse-a',
        field: 'sensor',
        value: 'Focus Pro 45K',
        evidence: {
          url: 'https://example.com/specs',
          quote: 'Sensor: Focus Pro 45K'
        }
      }
    });
    assert.equal(component.appended, true);
    assert.equal(component.total_count, 1);

    const alias = await appendReviewSuggestion({
      config,
      category: 'mouse',
      type: 'alias',
      payload: {
        product_id: 'mouse-a',
        field: 'sensor',
        value: 'focus-45k',
        canonical: 'Focus Pro 45K',
        evidence: {
          url: 'https://example.com/specs',
          quote: 'Focus 45K'
        }
      }
    });
    assert.equal(alias.appended, true);
    assert.equal(alias.total_count, 1);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('appendReviewSuggestion requires evidence url and quote', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-suggestions-validation-'));
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  try {
    await assert.rejects(
      () => appendReviewSuggestion({
        config,
        category: 'mouse',
        type: 'enum',
        payload: {
          product_id: 'mouse-a',
          field: 'switch_type',
          value: 'optical-v2',
          evidence: {
            url: '',
            quote: ''
          }
        }
      }),
      /requires evidence.url and evidence.quote/i
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
