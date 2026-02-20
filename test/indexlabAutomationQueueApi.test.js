import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForHttpReady(url, timeoutMs = 25_000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout_waiting_for_http_ready:${url}`);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, rows) {
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${text}\n`, 'utf8');
}

test('indexlab automation queue endpoint returns phase 06b jobs and transitions', { timeout: 60_000 }, async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexlab-automation-queue-'));
  const indexlabRoot = path.join(tempRoot, 'indexlab');
  const runId = 'run-automation-queue-001';
  const category = 'mouse';
  const productId = 'mouse-corsair-m55-wireless';
  const runDir = path.join(indexlabRoot, runId);

  const now = '2026-02-19T10:00:00.000Z';
  await writeJson(path.join(runDir, 'run.json'), {
    run_id: runId,
    category,
    product_id: productId,
    status: 'completed',
    started_at: now,
    ended_at: '2026-02-19T10:04:00.000Z'
  });

  await writeJson(path.join(runDir, 'search_profile.json'), {
    run_id: runId,
    category,
    product_id: productId,
    provider: 'duckduckgo',
    query_rows: [
      {
        query: 'Corsair M55 Wireless polling rate specification',
        target_fields: ['polling_rate'],
        result_count: 5,
        attempts: 1,
        providers: ['duckduckgo']
      }
    ]
  });

  await writeJson(path.join(runDir, 'needset.json'), {
    run_id: runId,
    category,
    product_id: productId,
    generated_at: '2026-02-19T10:03:30.000Z',
    needset_size: 2,
    total_fields: 75,
    needs: [
      {
        field_key: 'polling_rate',
        required_level: 'critical',
        need_score: 18.0,
        reasons: ['missing', 'tier_pref_unmet', 'min_refs_fail']
      },
      {
        field_key: 'sensor',
        required_level: 'required',
        need_score: 12.0,
        reasons: ['missing', 'min_refs_fail']
      }
    ]
  });

  await writeJsonl(path.join(runDir, 'run_events.ndjson'), [
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:01:00.000Z',
      stage: 'scheduler',
      event: 'repair_query_enqueued',
      payload: {
        domain: 'corsair.com',
        host: 'corsair.com',
        query: 'Corsair M55 Wireless manual',
        reason: 'status_404',
        provider: 'duckduckgo',
        doc_hint: 'manual',
        field_targets: ['polling_rate']
      }
    },
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:01:02.000Z',
      stage: 'search',
      event: 'search_started',
      payload: {
        scope: 'query',
        query: 'Corsair M55 Wireless manual',
        provider: 'duckduckgo'
      }
    },
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:01:03.000Z',
      stage: 'search',
      event: 'search_finished',
      payload: {
        scope: 'query',
        query: 'Corsair M55 Wireless manual',
        provider: 'duckduckgo',
        result_count: 6
      }
    },
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:02:05.000Z',
      stage: 'fetch',
      event: 'fetch_finished',
      payload: {
        scope: 'url',
        url: 'https://example.com/spec-a',
        status: 200,
        content_hash: 'sha256:abc123'
      }
    },
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:02:15.000Z',
      stage: 'fetch',
      event: 'fetch_finished',
      payload: {
        scope: 'url',
        url: 'https://example.org/spec-b',
        status: 200,
        content_hash: 'sha256:abc123'
      }
    },
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:02:40.000Z',
      stage: 'scheduler',
      event: 'url_cooldown_applied',
      payload: {
        url: 'https://corsair.com/manual/m55',
        reason: 'path_dead_pattern',
        next_retry_ts: '2026-02-21T10:02:40.000Z'
      }
    },
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:02:45.000Z',
      stage: 'scheduler',
      event: 'blocked_domain_cooldown_applied',
      payload: {
        host: 'blocked.example.com',
        status: 429,
        blocked_count: 3,
        threshold: 2
      }
    },
    {
      run_id: runId,
      category,
      product_id: productId,
      ts: '2026-02-19T10:03:30.000Z',
      stage: 'index',
      event: 'needset_computed',
      payload: {
        run_id: runId,
        category,
        product_id: productId,
        generated_at: '2026-02-19T10:03:30.000Z',
        needset_size: 2,
        total_fields: 75,
        needs: [
          {
            field_key: 'polling_rate',
            required_level: 'critical',
            need_score: 18.0,
            reasons: ['missing', 'tier_pref_unmet', 'min_refs_fail']
          }
        ]
      }
    }
  ]);

  const port = await getFreePort();
  const proc = spawn(
    process.execPath,
    [
      'src/api/guiServer.js',
      '--port',
      String(port),
      '--local',
      '--indexlab-root',
      indexlabRoot
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_MODE: 'true'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  t.after(async () => {
    if (!proc.killed) proc.kill('SIGTERM');
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const healthUrl = `http://127.0.0.1:${port}/api/v1/health`;
  await waitForHttpReady(healthUrl);

  const target = `http://127.0.0.1:${port}/api/v1/indexlab/run/${encodeURIComponent(runId)}/automation-queue`;
  const response = await fetch(target);
  assert.equal(response.status, 200, `unexpected status ${response.status} stderr=${stderr}`);
  const payload = await response.json();

  assert.equal(payload.run_id, runId);
  assert.equal(payload.category, category);
  assert.equal(payload.product_id, productId);
  assert.equal(typeof payload.summary, 'object');
  assert.equal(Array.isArray(payload.jobs), true);
  assert.equal(Array.isArray(payload.actions), true);
  assert.equal(Number(payload.summary.total_jobs || 0) >= 3, true);
  assert.equal(Number(payload.summary.queue_depth || 0) >= 0, true);
  assert.equal(Number(payload.summary.cooldown || 0) >= 1, true);
  assert.equal(payload.jobs.some((row) => row.job_type === 'repair_search'), true);
  assert.equal(payload.jobs.some((row) => row.job_type === 'staleness_refresh'), true);
  assert.equal(payload.jobs.some((row) => row.job_type === 'deficit_rediscovery'), true);
  assert.equal(payload.actions.length > 0, true);
});
