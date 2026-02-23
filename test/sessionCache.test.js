import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const COMPILED_FIELDS = {
  dpi_max: { type: 'number', label: 'DPI Max', ui: { label: 'Max DPI', group: 'sensor' } },
  weight: { type: 'number', label: 'Weight', ui: { label: 'Weight (g)' } },
};
const COMPILED_ORDER = ['dpi_max', 'weight'];

const DRAFT_PAYLOAD = {
  fields: {
    dpi_max: { ui: { label: 'Maximum DPI' } },
    polling_rate: { type: 'number', label: 'Polling Rate', ui: { label: 'Polling Rate (Hz)' } },
  },
  fieldOrder: ['__grp::sensor', 'dpi_max', 'polling_rate', 'weight'],
};

function makeDeps({ draftPayload = DRAFT_PAYLOAD, compiledFields = COMPILED_FIELDS, compiledOrder = COMPILED_ORDER, fsWriteCalls = [], manifest = null } = {}) {
  let diskDraft = draftPayload ? JSON.parse(JSON.stringify(draftPayload)) : null;
  let readCount = 0;

  const readJsonIfExists = async (filePath) => {
    readCount += 1;
    if (filePath.includes('manifest.json')) {
      return manifest ? JSON.parse(JSON.stringify(manifest)) : null;
    }
    return diskDraft ? JSON.parse(JSON.stringify(diskDraft)) : null;
  };

  const writeFile = async (_filePath, data) => {
    diskDraft = JSON.parse(data);
    fsWriteCalls.push({ path: _filePath, data: diskDraft });
  };

  const mkdir = async () => {};

  const loadCategoryConfig = async () => ({
    fieldRules: { fields: JSON.parse(JSON.stringify(compiledFields)) },
    fieldOrder: [...compiledOrder],
  });

  return { readJsonIfExists, writeFile, mkdir, loadCategoryConfig, getReadCount: () => readCount, fsWriteCalls };
}

async function createCache(deps) {
  const { createSessionCache } = await import('../src/field-rules/sessionCache.js');
  return createSessionCache({
    loadCategoryConfig: deps.loadCategoryConfig,
    readJsonIfExists: deps.readJsonIfExists,
    writeFile: deps.writeFile,
    mkdir: deps.mkdir,
    helperRoot: 'helper_files',
  });
}

describe('sessionCache', () => {
  it('returns merged compiled+draft fields on first call', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.ok(result.mergedFields.dpi_max, 'dpi_max should exist');
    assert.ok(result.mergedFields.polling_rate, 'polling_rate should exist from draft');
    assert.ok(result.mergedFields.weight, 'weight should exist from compiled');

    assert.equal(result.mergedFields.dpi_max.ui.label, 'Maximum DPI', 'draft ui.label wins');
    assert.equal(result.mergedFields.dpi_max.ui.group, 'sensor', 'compiled ui.group preserved');
    assert.equal(result.mergedFields.dpi_max.type, 'number', 'compiled type preserved');
  });

  it('returns correct mergedFieldOrder from draft', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.deepEqual(result.mergedFieldOrder, ['__grp::sensor', 'dpi_max', 'polling_rate', 'weight']);
  });

  it('cleanFieldOrder filters __grp:: markers', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.deepEqual(result.cleanFieldOrder, ['dpi_max', 'polling_rate', 'weight']);
    assert.ok(!result.cleanFieldOrder.some(k => k.startsWith('__grp::')));
  });

  it('labels derived correctly from merged fields', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.equal(result.labels.dpi_max, 'Maximum DPI', 'draft label wins');
    assert.equal(result.labels.weight, 'Weight (g)', 'compiled label preserved');
    assert.equal(result.labels.polling_rate, 'Polling Rate (Hz)', 'draft-only field label');
  });

  it('second call returns cached (no re-read)', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);

    await cache.getSessionRules('mouse');
    const readsBefore = deps.getReadCount();

    await cache.getSessionRules('mouse');
    assert.equal(deps.getReadCount(), readsBefore, 'should not re-read from disk on cache hit');
  });

  it('invalidateSessionCache clears, next call re-reads', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);

    await cache.getSessionRules('mouse');
    const readsAfterFirst = deps.getReadCount();

    cache.invalidateSessionCache('mouse');

    await cache.getSessionRules('mouse');
    assert.ok(deps.getReadCount() > readsAfterFirst, 'should re-read after invalidation');
  });

  it('invalidateSessionCache with no args clears all categories', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);

    await cache.getSessionRules('mouse');
    await cache.getSessionRules('monitor');
    const readsAfterBoth = deps.getReadCount();

    cache.invalidateSessionCache();

    await cache.getSessionRules('mouse');
    await cache.getSessionRules('monitor');
    assert.ok(deps.getReadCount() > readsAfterBoth + 1, 'should re-read both categories');
  });

  it('updateSessionRules updates cache and writes to disk', async () => {
    const fsWriteCalls = [];
    const deps = makeDeps({ fsWriteCalls });
    const cache = await createCache(deps);

    await cache.getSessionRules('mouse');

    await cache.updateSessionRules('mouse', {
      fields: { dpi_max: { ui: { label: 'Updated DPI Label' } } },
      fieldOrder: ['dpi_max', 'weight'],
    });

    assert.ok(fsWriteCalls.length > 0, 'should write to disk');

    const result = await cache.getSessionRules('mouse');
    assert.equal(result.mergedFields.dpi_max.ui.label, 'Updated DPI Label');
  });

  it('returns draftFields and draftFieldOrder separately', async () => {
    const deps = makeDeps();
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.ok(result.draftFields, 'should expose draftFields');
    assert.ok(result.draftFieldOrder, 'should expose draftFieldOrder');
    assert.deepEqual(result.draftFieldOrder, ['__grp::sensor', 'dpi_max', 'polling_rate', 'weight']);
  });

  it('handles no draft file gracefully', async () => {
    const deps = makeDeps({ draftPayload: null });
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.deepEqual(result.mergedFields, COMPILED_FIELDS);
    assert.deepEqual(result.mergedFieldOrder, COMPILED_ORDER);
    assert.deepEqual(result.cleanFieldOrder, COMPILED_ORDER);
    assert.equal(result.draftFields, null);
    assert.equal(result.draftFieldOrder, null);
  });

  it('compileStale is true when draft is newer than compiled', async () => {
    const deps = makeDeps({
      draftPayload: { ...DRAFT_PAYLOAD, draft_saved_at: '2026-02-20T12:00:00.000Z' },
      manifest: { generated_at: '2026-02-19T12:00:00.000Z' },
    });
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.equal(result.compileStale, true);
    assert.equal(result.compiledAt, '2026-02-19T12:00:00.000Z');
    assert.equal(result.draftSavedAt, '2026-02-20T12:00:00.000Z');
  });

  it('compileStale is false when compiled is newer than draft', async () => {
    const deps = makeDeps({
      draftPayload: { ...DRAFT_PAYLOAD, draft_saved_at: '2026-02-19T12:00:00.000Z' },
      manifest: { generated_at: '2026-02-20T12:00:00.000Z' },
    });
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.equal(result.compileStale, false);
  });

  it('compileStale is false when no draft exists', async () => {
    const deps = makeDeps({
      draftPayload: null,
      manifest: { generated_at: '2026-02-20T12:00:00.000Z' },
    });
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.equal(result.compileStale, false);
    assert.equal(result.compiledAt, '2026-02-20T12:00:00.000Z');
    assert.equal(result.draftSavedAt, null);
  });

  it('compileStale is true when draft exists but no manifest', async () => {
    const deps = makeDeps({
      draftPayload: { ...DRAFT_PAYLOAD, draft_saved_at: '2026-02-20T12:00:00.000Z' },
      manifest: null,
    });
    const cache = await createCache(deps);
    const result = await cache.getSessionRules('mouse');

    assert.equal(result.compileStale, true);
    assert.equal(result.compiledAt, null);
  });

  it('updateSessionRules writes draft_saved_at timestamp', async () => {
    const fsWriteCalls = [];
    const deps = makeDeps({ fsWriteCalls });
    const cache = await createCache(deps);

    await cache.updateSessionRules('mouse', {
      fields: { dpi_max: { ui: { label: 'Test' } } },
    });

    assert.ok(fsWriteCalls.length > 0);
    const written = fsWriteCalls[0].data;
    assert.ok(written.draft_saved_at, 'draft_saved_at should be written');
    assert.ok(!isNaN(Date.parse(written.draft_saved_at)), 'draft_saved_at should be valid ISO date');
  });
});
