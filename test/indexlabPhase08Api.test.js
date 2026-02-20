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

test('indexlab phase08 endpoint returns extraction context payload', { timeout: 60_000 }, async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexlab-phase08-api-'));
  const indexlabRoot = path.join(tempRoot, 'indexlab');
  const runId = 'run-phase08-001';
  const category = 'mouse';
  const productId = 'mouse-fnatic-x-lamzu-maya-x-8k';
  const runDir = path.join(indexlabRoot, runId);

  await writeJson(path.join(runDir, 'run.json'), {
    run_id: runId,
    category,
    product_id: productId,
    status: 'completed',
    started_at: '2026-02-19T12:10:00.000Z',
    ended_at: '2026-02-19T12:16:00.000Z'
  });

  await writeJson(path.join(runDir, 'phase08_extraction.json'), {
    run_id: runId,
    category,
    product_id: productId,
    generated_at: '2026-02-19T12:15:55.000Z',
    summary: {
      batch_count: 3,
      batch_error_count: 0,
      schema_fail_rate: 0,
      raw_candidate_count: 14,
      accepted_candidate_count: 9,
      dangling_snippet_ref_count: 1,
      dangling_snippet_ref_rate: 0.071428,
      evidence_policy_violation_count: 2,
      evidence_policy_violation_rate: 0.142857,
      min_refs_satisfied_count: 8,
      min_refs_total: 9,
      min_refs_satisfied_rate: 0.888889,
      validator_context_field_count: 5,
      validator_prime_source_rows: 11
    },
    batches: [
      {
        batch_id: 'sensor_performance',
        status: 'completed',
        model: 'gemini-2.5-flash',
        target_field_count: 4,
        snippet_count: 5,
        reference_count: 5,
        raw_candidate_count: 6,
        accepted_candidate_count: 4,
        min_refs_satisfied_count: 4,
        min_refs_total: 4,
        elapsed_ms: 821
      }
    ],
    field_contexts: {
      polling_rate: {
        field_key: 'polling_rate',
        required_level: 'critical',
        difficulty: 'hard',
        ai_mode: 'judge',
        parse_template_intent: {
          template_id: 'list_of_numbers_with_unit'
        },
        evidence_policy: {
          required: true,
          min_evidence_refs: 2,
          distinct_sources_required: true,
          tier_preference: [1, 2, 3]
        }
      }
    },
    prime_sources: {
      rows: [
        {
          field_key: 'polling_rate',
          snippet_id: 'w01',
          source_id: 'techpowerup_com',
          url: 'https://www.techpowerup.com/review/lamzu-maya/single-page.html',
          quote_preview: 'Polling Rate: 125/250/500/1000/2000/4000/8000 Hz'
        }
      ]
    }
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
  const target = `http://127.0.0.1:${port}/api/v1/indexlab/run/${encodeURIComponent(runId)}/phase08-extraction`;
  const response = await fetch(target);
  assert.equal(response.status, 200, `unexpected status ${response.status} stderr=${stderr}`);
  const payload = await response.json();

  assert.equal(payload.run_id, runId);
  assert.equal(payload.category, category);
  assert.equal(payload.product_id, productId);
  assert.equal(Number(payload.summary?.batch_count || 0), 3);
  assert.equal(Number(payload.summary?.accepted_candidate_count || 0), 9);
  assert.equal(Array.isArray(payload.batches), true);
  assert.equal(payload.batches.length, 1);
  assert.equal(payload.batches[0].batch_id, 'sensor_performance');
  assert.equal(payload.field_contexts?.polling_rate?.parse_template_intent?.template_id, 'list_of_numbers_with_unit');
  assert.equal(Array.isArray(payload.prime_sources?.rows), true);
  assert.equal(payload.prime_sources.rows.length, 1);
});
