import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendEnumCurationSuggestions,
  enumSuggestionPath
} from '../src/engine/curationSuggestions.js';

test('appendEnumCurationSuggestions appends and de-duplicates enum suggestions', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-curation-'));
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  try {
    const first = await appendEnumCurationSuggestions({
      config,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-1',
      suggestions: [
        {
          field_key: 'coating',
          normalized_value: 'satin microtexture'
        }
      ]
    });
    assert.equal(first.appended_count, 1);
    assert.equal(first.total_count, 1);

    const second = await appendEnumCurationSuggestions({
      config,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      runId: 'run-2',
      suggestions: [
        {
          field_key: 'coating',
          normalized_value: 'satin microtexture'
        },
        {
          field_key: 'coating',
          normalized_value: 'frosted polymer'
        }
      ]
    });
    assert.equal(second.appended_count, 1);
    assert.equal(second.total_count, 2);

    const suggestionFile = enumSuggestionPath({ config, category: 'mouse' });
    const payload = JSON.parse(await fs.readFile(suggestionFile, 'utf8'));
    assert.equal(payload.category, 'mouse');
    assert.equal(Array.isArray(payload.suggestions), true);
    assert.equal(payload.suggestions.length, 2);
    assert.equal(
      payload.suggestions.some((row) => row.value === 'satin microtexture'),
      true
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
