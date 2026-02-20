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
      // not ready yet
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

test('domain checklist endpoint returns shape with loop metrics', { timeout: 60_000 }, async (t) => {
  const port = await getFreePort();
  const proc = spawn(
    process.execPath,
    ['src/api/guiServer.js', '--port', String(port), '--local'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  t.after(() => {
    if (!proc.killed) proc.kill('SIGTERM');
  });

  const healthUrl = `http://127.0.0.1:${port}/api/v1/health`;
  await waitForHttpReady(healthUrl);

  const target = `http://127.0.0.1:${port}/api/v1/indexing/domain-checklist/mouse?windowMinutes=60&includeUrls=true`;
  const response = await fetch(target);
  assert.equal(response.status, 200, `unexpected status ${response.status} stderr=${stderr}`);

  const payload = await response.json();
  assert.equal(payload.command, 'indexing');
  assert.equal(payload.action, 'domain-checklist');
  assert.equal(payload.category, 'mouse');
  assert.equal(Array.isArray(payload.rows), true);
  assert.equal(Array.isArray(payload.milestones?.primary_domains), true);
  assert.equal(Array.isArray(payload.domain_field_yield), true);

  if (payload.rows.length > 0) {
    const row = payload.rows[0];
    assert.equal(typeof row.domain, 'string');
    assert.equal(typeof row.site_kind, 'string');
    assert.equal(typeof row.candidates_checked, 'number');
    assert.equal(typeof row.urls_selected, 'number');
    assert.equal(typeof row.pages_fetched_ok, 'number');
    assert.equal(typeof row.pages_indexed, 'number');
    assert.equal(typeof row.dedupe_hits, 'number');
    assert.equal(typeof row.err_404, 'number');
    assert.equal(typeof row.repeat_404_urls, 'number');
    assert.equal(typeof row.blocked_count, 'number');
    assert.equal(typeof row.repeat_blocked_urls, 'number');
    assert.equal(typeof row.parse_fail_count, 'number');
    assert.equal(typeof row.avg_fetch_ms, 'number');
    assert.equal(typeof row.p95_fetch_ms, 'number');
    assert.equal(typeof row.evidence_hits, 'number');
    assert.equal(typeof row.evidence_used, 'number');
    assert.equal(typeof row.fields_covered, 'number');
    assert.equal(typeof row.status, 'string');
    assert.equal(typeof row.url_count, 'number');
    assert.equal(Array.isArray(row.urls), true);
  }
});

test('domain checklist excludes helper pseudo-domain rows from provenance rollup', { timeout: 60_000 }, async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexing-checklist-'));
  const outputRoot = path.join(tempRoot, 'out');
  const category = 'mouse';
  const productId = 'mouse-test-brand-model';
  const runId = 'run-helper-filter-001';

  const runtimeEventsPath = path.join(outputRoot, '_runtime', 'events.jsonl');
  await writeJsonl(runtimeEventsPath, [
    {
      ts: '2026-02-18T08:00:00.000Z',
      event: 'source_fetch_started',
      category,
      productId,
      runId,
      url: 'https://alienware.com/product/aw720m',
      role: 'manufacturer'
    },
    {
      ts: '2026-02-18T08:00:02.000Z',
      event: 'source_processed',
      category,
      productId,
      runId,
      url: 'https://alienware.com/product/aw720m',
      role: 'manufacturer',
      status: 200
    }
  ]);

  const runBase = path.join(
    outputRoot,
    'specs',
    'outputs',
    category,
    productId,
    'runs',
    runId
  );
  await writeJson(path.join(runBase, 'provenance', 'fields.provenance.json'), {
    fields: {
      weight: {
        value: '60 g',
        pass_target: 1,
        meets_pass_target: true,
        confidence: 0.9,
        evidence: [
          {
            url: 'helper_files://mouse/activeFiltering.json#4',
            host: 'helper-files.local',
            rootDomain: 'helper-files.local',
            tier: 2,
            tierName: 'database',
            method: 'helper_supportive'
          },
          {
            url: 'https://alienware.com/product/aw720m',
            host: 'alienware.com',
            rootDomain: 'alienware.com',
            tier: 1,
            tierName: 'manufacturer',
            method: 'extract'
          }
        ]
      }
    }
  });

  const port = await getFreePort();
  const proc = spawn(
    process.execPath,
    ['src/api/guiServer.js', '--port', String(port), '--local'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_MODE: 'true',
        LOCAL_OUTPUT_ROOT: outputRoot
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

  const target = `http://127.0.0.1:${port}/api/v1/indexing/domain-checklist/${encodeURIComponent(category)}?windowMinutes=180&productId=${encodeURIComponent(productId)}&runId=${encodeURIComponent(runId)}&includeUrls=true`;
  const response = await fetch(target);
  assert.equal(response.status, 200, `unexpected status ${response.status} stderr=${stderr}`);
  const payload = await response.json();

  assert.equal(Array.isArray(payload.rows), true);
  assert.equal(payload.rows.some((row) => row.domain === 'alienware.com'), true);
  assert.equal(payload.rows.some((row) => row.domain === 'helper-files.local'), false);
  const manufacturerRow = payload.rows.find((row) => row.domain === 'alienware.com');
  assert.ok(manufacturerRow);
  assert.equal(Array.isArray(manufacturerRow.urls), true);
  assert.equal(manufacturerRow.url_count >= 1, true);
});

test('domain checklist marks domain good when indexed signal exists even with 404 URL failures', { timeout: 60_000 }, async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexing-checklist-status-'));
  const outputRoot = path.join(tempRoot, 'out');
  const category = 'mouse';
  const productId = 'mouse-hyperx-pulsefire-haste-wireless';
  const runId = 'run-status-001';
  const targetUrl = 'https://hyperx.com/product/pulsefire-haste-wireless';

  const runtimeEventsPath = path.join(outputRoot, '_runtime', 'events.jsonl');
  await writeJsonl(runtimeEventsPath, [
    {
      ts: '2026-02-18T09:00:00.000Z',
      event: 'source_fetch_started',
      category,
      productId,
      runId,
      url: targetUrl,
      role: 'manufacturer'
    },
    {
      ts: '2026-02-18T09:00:01.000Z',
      event: 'source_processed',
      category,
      productId,
      runId,
      url: targetUrl,
      role: 'manufacturer',
      status: 404,
      candidate_count: 2
    },
    {
      ts: '2026-02-18T09:00:01.500Z',
      event: 'fields_filled_from_source',
      category,
      productId,
      runId,
      url: targetUrl,
      count: 3
    }
  ]);

  const port = await getFreePort();
  const proc = spawn(
    process.execPath,
    ['src/api/guiServer.js', '--port', String(port), '--local'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_MODE: 'true',
        LOCAL_OUTPUT_ROOT: outputRoot
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

  const target = `http://127.0.0.1:${port}/api/v1/indexing/domain-checklist/${encodeURIComponent(category)}?windowMinutes=180&productId=${encodeURIComponent(productId)}&runId=${encodeURIComponent(runId)}&includeUrls=true`;
  const response = await fetch(target);
  assert.equal(response.status, 200, `unexpected status ${response.status} stderr=${stderr}`);
  const payload = await response.json();

  const row = payload.rows.find((entry) => entry.domain === 'hyperx.com');
  assert.ok(row);
  assert.equal(row.pages_fetched_ok, 0);
  assert.equal(row.err_404 > 0, true);
  assert.equal(row.pages_indexed > 0, true);
  assert.equal(row.status, 'good');
  assert.equal(Array.isArray(row.urls), true);

  const urlRow = row.urls.find((entry) => entry.url === targetUrl);
  assert.ok(urlRow);
  assert.equal(urlRow.err_404_count, 1);
  assert.equal(urlRow.indexed, true);
});
