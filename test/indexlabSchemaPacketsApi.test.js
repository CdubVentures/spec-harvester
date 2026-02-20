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

test('indexlab schema packet endpoints return source/item/run-meta packets', { timeout: 60_000 }, async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexlab-schema-packets-api-'));
  const indexlabRoot = path.join(tempRoot, 'indexlab');
  const runId = 'run-schema-001';
  const category = 'mouse';
  const productId = 'mouse-logitech-g-pro-x-superlight-2';
  const runDir = path.join(indexlabRoot, runId);

  await writeJson(path.join(runDir, 'run.json'), {
    run_id: runId,
    category,
    product_id: productId,
    status: 'completed',
    started_at: '2026-02-20T12:10:00.000Z',
    ended_at: '2026-02-20T12:16:00.000Z'
  });

  await writeJson(path.join(runDir, 'source_indexing_extraction_packets.json'), {
    schema_version: '2026-02-20.source-indexing-extraction-packet.collection.v1',
    record_kind: 'source_indexing_extraction_packet_collection',
    run_id: runId,
    category,
    item_identifier: productId,
    generated_at: '2026-02-20T12:15:55.000Z',
    source_packet_count: 1,
    packets: [
      {
        schema_version: '2026-02-20.source-indexing-extraction-packet.v1',
        record_kind: 'source_indexing_extraction_packet',
        source_packet_id: 'sha256:source-01',
        source_id: 'src_01',
        canonical_url: 'https://example.com/product',
        source_version_id: 'sha256:source-version-01'
      }
    ]
  });

  await writeJson(path.join(runDir, 'item_indexing_extraction_packet.json'), {
    schema_version: '2026-02-20.item-indexing-extraction-packet.v1',
    record_kind: 'item_indexing_extraction_packet',
    item_packet_id: 'sha256:item-01',
    category,
    item_identifier: productId,
    generated_at: '2026-02-20T12:15:56.000Z',
    run_scope: {
      current_run_id: runId,
      included_run_ids: [runId]
    },
    source_packet_refs: [
      {
        source_packet_id: 'sha256:source-01',
        source_id: 'src_01',
        canonical_url: 'https://example.com/product',
        source_version_id: 'sha256:source-version-01',
        content_hash: 'sha256:content-01',
        run_id: runId
      }
    ],
    field_source_index: {},
    field_key_map: {},
    coverage_summary: {
      field_count: 1,
      known_field_count: 1,
      required_coverage: '1/1',
      critical_coverage: '1/1'
    },
    indexing_projection: {
      retrieval_ready: true,
      candidate_chunk_count: 1,
      priority_field_keys: ['polling_rate']
    },
    sql_projection: {
      item_field_state_rows: [
        {
          category,
          product_id: productId,
          field_key: 'polling_rate'
        }
      ],
      candidate_rows: [
        {
          candidate_id: 'cand_01',
          category,
          product_id: productId,
          field_key: 'polling_rate'
        }
      ]
    }
  });

  await writeJson(path.join(runDir, 'run_meta_packet.json'), {
    schema_version: '2026-02-20.run-meta-packet.v1',
    record_kind: 'run_meta_packet',
    run_packet_id: 'sha256:run-meta-01',
    run_id: runId,
    category,
    started_at: '2026-02-20T12:10:00.000Z',
    finished_at: '2026-02-20T12:16:00.000Z',
    duration_ms: 360000,
    trigger: 'manual',
    execution_summary: {
      item_total: 1,
      item_succeeded: 1,
      item_partial: 0,
      item_failed: 0,
      source_total: 1,
      source_fetched: 1,
      source_failed: 0,
      assertion_total: 1,
      evidence_total: 1,
      identity_rejected_evidence_total: 0
    },
    phase_summary: {
      phase_01_static_html: { enabled: true, executed_sources: 1, assertion_count: 1, evidence_count: 1, error_count: 0, duration_ms: 10 },
      phase_02_dynamic_js: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_03_main_article: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_04_html_spec_table: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_05_embedded_json: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_06_text_pdf: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_07_scanned_pdf_ocr: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_08_image_ocr: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_09_chart_graph: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 },
      phase_10_office_mixed_doc: { enabled: true, executed_sources: 0, assertion_count: 0, evidence_count: 0, error_count: 0, duration_ms: 0 }
    },
    output_refs: {
      source_packet_refs: [{ source_packet_id: 'sha256:source-01', source_version_id: 'sha256:source-version-01', source_id: 'src_01' }],
      item_packet_refs: [{ item_packet_id: 'sha256:item-01', item_identifier: productId }]
    },
    quality_gates: {
      coverage_gate_passed: true,
      evidence_gate_passed: true,
      error_rate_gate_passed: true,
      target_match_gate_passed: true
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

  const sourceRes = await fetch(`http://127.0.0.1:${port}/api/v1/indexlab/run/${encodeURIComponent(runId)}/source-indexing-packets`);
  assert.equal(sourceRes.status, 200, `unexpected source packets status ${sourceRes.status} stderr=${stderr}`);
  const sourcePayload = await sourceRes.json();
  assert.equal(sourcePayload.record_kind, 'source_indexing_extraction_packet_collection');
  assert.equal(Number(sourcePayload.source_packet_count || 0), 1);

  const itemRes = await fetch(`http://127.0.0.1:${port}/api/v1/indexlab/run/${encodeURIComponent(runId)}/item-indexing-packet`);
  assert.equal(itemRes.status, 200, `unexpected item packet status ${itemRes.status} stderr=${stderr}`);
  const itemPayload = await itemRes.json();
  assert.equal(itemPayload.record_kind, 'item_indexing_extraction_packet');
  assert.equal(itemPayload.item_identifier, productId);

  const runMetaRes = await fetch(`http://127.0.0.1:${port}/api/v1/indexlab/run/${encodeURIComponent(runId)}/run-meta-packet`);
  assert.equal(runMetaRes.status, 200, `unexpected run meta packet status ${runMetaRes.status} stderr=${stderr}`);
  const runMetaPayload = await runMetaRes.json();
  assert.equal(runMetaPayload.record_kind, 'run_meta_packet');
  assert.equal(runMetaPayload.run_id, runId);
});
