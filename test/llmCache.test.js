import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LLMCache } from '../src/llm/llmCache.js';

test('LLMCache stores and retrieves responses by deterministic key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-cache-test-'));
  try {
    const cache = new LLMCache({
      cacheDir: root,
      defaultTtlMs: 10_000
    });
    const key = cache.getCacheKey({
      model: 'gemini-2.0-flash',
      prompt: 'extract',
      evidence: { refs: ['s1'] }
    });

    await cache.set(key, { ok: true, candidates: 2 });
    const hit = await cache.get(key);
    assert.deepEqual(hit, { ok: true, candidates: 2 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('LLMCache expires stale entries by ttl', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-cache-expiry-'));
  try {
    const cache = new LLMCache({
      cacheDir: root,
      defaultTtlMs: 1
    });
    const key = cache.getCacheKey({
      model: 'deepseek-reasoner',
      prompt: 'extract',
      evidence: { refs: ['s1'] }
    });
    await cache.set(key, { ok: true }, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const miss = await cache.get(key);
    assert.equal(miss, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

