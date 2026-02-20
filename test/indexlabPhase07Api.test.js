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

test('indexlab phase07 endpoint returns tier retrieval + prime source payload', { timeout: 60_000 }, async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexlab-phase07-api-'));
  const indexlabRoot = path.join(tempRoot, 'indexlab');
  const runId = 'run-phase07-001';
  const category = 'mouse';
  const productId = 'mouse-fnatic-x-lamzu-maya-x-8k';
  const runDir = path.join(indexlabRoot, runId);

  await writeJson(path.join(runDir, 'run.json'), {
    run_id: runId,
    category,
    product_id: productId,
    status: 'completed',
    started_at: '2026-02-19T11:00:00.000Z',
    ended_at: '2026-02-19T11:04:00.000Z'
  });

  await writeJson(path.join(runDir, 'phase07_retrieval.json'), {
    run_id: runId,
    category,
    product_id: productId,
    generated_at: '2026-02-19T11:03:30.000Z',
    summary: {
      fields_attempted: 3,
      fields_with_hits: 2,
      fields_satisfied_min_refs: 1,
      fields_unsatisfied_min_refs: 2,
      refs_selected_total: 3,
      distinct_sources_selected: 2,
      avg_hits_per_field: 1.667,
      evidence_pool_size: 6
    },
    fields: [
      {
        field_key: 'polling_rate',
        required_level: 'critical',
        need_score: 38.88,
        min_refs_required: 2,
        refs_selected: 2,
        min_refs_satisfied: true,
        distinct_sources_required: true,
        distinct_sources_selected: 2,
        retrieval_query: 'Fnatic x Lamzu MAYA X 8K | polling rate | hz',
        hits: [
          {
            rank: 1,
            score: 8.15,
            url: 'https://www.techpowerup.com/review/lamzu-maya/single-page.html',
            host: 'www.techpowerup.com',
            tier: 2,
            doc_kind: 'lab_review',
            snippet_id: 'w01',
            quote_preview: 'Polling Rate: 125/250/500/1000/2000/4000/8000 Hz',
            reason_badges: ['anchor_match', 'unit_match', 'tier_preferred']
          }
        ],
        prime_sources: [
          {
            rank: 1,
            score: 8.15,
            url: 'https://www.techpowerup.com/review/lamzu-maya/single-page.html',
            host: 'www.techpowerup.com',
            tier: 2,
            doc_kind: 'lab_review',
            snippet_id: 'w01',
            quote_preview: 'Polling Rate: 125/250/500/1000/2000/4000/8000 Hz',
            reason_badges: ['anchor_match', 'unit_match', 'tier_preferred']
          }
        ]
      }
    ]
  });

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

  await waitForHttpReady(`http://127.0.0.1:${port}/api/v1/health`);
  const target = `http://127.0.0.1:${port}/api/v1/indexlab/run/${encodeURIComponent(runId)}/phase07-retrieval`;
  const response = await fetch(target);
  assert.equal(response.status, 200, `unexpected status ${response.status} stderr=${stderr}`);
  const payload = await response.json();

  assert.equal(payload.run_id, runId);
  assert.equal(payload.category, category);
  assert.equal(payload.product_id, productId);
  assert.equal(Number(payload.summary?.fields_attempted || 0), 3);
  assert.equal(Number(payload.summary?.refs_selected_total || 0), 3);
  assert.equal(Array.isArray(payload.fields), true);
  assert.equal(payload.fields.length, 1);
  assert.equal(payload.fields[0].field_key, 'polling_rate');
  assert.equal(payload.fields[0].min_refs_satisfied, true);
  assert.equal(Array.isArray(payload.fields[0].prime_sources), true);
});
