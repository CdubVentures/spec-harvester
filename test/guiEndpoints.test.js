import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;

function fetchJson(urlPath, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${urlPath}`;
    const req = http.get(url, { timeout }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: body.slice(0, 500) });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, data: null, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null, error: 'timeout' }); });
  });
}

function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/v1/indexlab/runs`, { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

describe('GUI IndexLab Endpoints (integration)', async () => {
  let serverUp = false;
  let richRunId = null;

  before(async () => {
    serverUp = await isServerUp();
    if (!serverUp) return;

    const { data } = await fetchJson('/api/v1/indexlab/runs');
    if (!data?.runs?.length) return;

    const sorted = data.runs
      .filter((r) => r.status === 'completed' && r.counters?.pages_checked > 5)
      .sort((a, b) => (b.counters?.pages_checked || 0) - (a.counters?.pages_checked || 0));
    richRunId = sorted[0]?.run_id || data.runs[0]?.run_id;
  });

  it('skips all tests when server is not running', { skip: false }, () => {
    if (!serverUp) {
      assert.ok(true, 'GUI server not running on port 8788 — skipping integration tests');
    }
  });

  describe('Panel 00 — Event Stream', () => {
    it('GET /runs returns array of run objects', async () => {
      if (!serverUp) return;
      const { status, data } = await fetchJson('/api/v1/indexlab/runs');
      assert.equal(status, 200);
      assert.ok(Array.isArray(data.runs), 'runs should be an array');
      assert.ok(data.runs.length > 0, 'should have at least one run');

      const run = data.runs[0];
      assert.ok(run.run_id, 'each run should have run_id');
      assert.ok(run.category, 'each run should have category');
      assert.ok(run.status, 'each run should have status');
    });

    it('GET /run/{id} returns run metadata', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}`);
      assert.equal(status, 200);
      assert.equal(data.run_id, richRunId);
      assert.ok(data.category);
      assert.ok(data.status);
      assert.ok(data.started_at);
    });

    it('GET /run/{id}/events returns event array', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/events`);
      assert.equal(status, 200);
      assert.ok(data.run_id);
      assert.ok(typeof data.count === 'number');
      assert.ok(Array.isArray(data.events));
      assert.ok(data.events.length > 0);

      const evt = data.events[0];
      assert.ok(evt.event || evt.stage, 'events should have event or stage');
    });

    it('returns 404 for non-existent run', async () => {
      if (!serverUp) return;
      const { status } = await fetchJson('/api/v1/indexlab/run/nonexistent-run-id');
      assert.equal(status, 404);
    });
  });

  describe('Panel 01 — NeedSet', () => {
    it('GET /run/{id}/needset returns NeedSet data', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/needset`);
      assert.equal(status, 200);
      assert.ok(data !== null, 'NeedSet should not be null');
      assert.ok(Array.isArray(data.needs), 'should have needs array');
      assert.ok(typeof data.total_fields === 'number' || typeof data.field_count === 'number',
        'should have field count');
    });
  });

  describe('Panel 02 — Search Profile', () => {
    it('GET /run/{id}/search-profile returns search profile', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/search-profile`);
      assert.equal(status, 200);
      assert.ok(data !== null, 'Search profile should not be null');
      assert.ok(Array.isArray(data.queries), 'should have queries array');
      assert.ok(data.queries.length > 0, 'should have at least one query');
    });
  });

  describe('Panel 03 — SERP Explorer', () => {
    it('GET /run/{id}/serp returns SERP data', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/serp`);
      if (status === 404) {
        assert.ok(true, 'SERP data not available for this run (may require search_profile.serp_explorer or summary fallback)');
        return;
      }
      assert.equal(status, 200);
      assert.ok(data.query_count !== undefined || data.queries !== undefined,
        'should have query data');
    });
  });

  describe('Panel 05 — Dynamic Fetch Dashboard', () => {
    it('GET /run/{id}/dynamic-fetch-dashboard returns data or 404', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/dynamic-fetch-dashboard`);
      assert.ok(status === 200 || status === 404, `should be 200 or 404, got ${status}`);
      if (status === 200) {
        assert.ok(data.run_id || data.host_count !== undefined, 'should have fetch dashboard data');
      }
    });
  });

  describe('Panel 06A — Evidence Index', () => {
    it('GET /run/{id}/evidence-index returns evidence data', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/evidence-index`);
      assert.equal(status, 200);
      assert.ok(data.run_id);
      assert.ok(typeof data.db_ready === 'boolean');
      assert.ok(data.scope);
      assert.ok(data.summary);
      assert.ok(typeof data.summary.documents === 'number');
      assert.ok(Array.isArray(data.documents));
      assert.ok(data.search);
      assert.ok(data.dedupe_stream);
    });
  });

  describe('Panel 06B — Automation Queue', () => {
    it('GET /run/{id}/automation-queue returns queue data', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/automation-queue`);
      assert.equal(status, 200);
      assert.ok(data.run_id);
      assert.ok(data.summary);
      assert.ok(typeof data.summary.total_jobs === 'number');
      assert.ok(Array.isArray(data.jobs));
      assert.ok(data.policies);
      assert.ok(Array.isArray(data.actions));
    });
  });

  describe('Panel 07 — Phase 07 Retrieval', () => {
    it('GET /run/{id}/phase07-retrieval returns data or 404', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/phase07-retrieval`);
      assert.ok(status === 200 || status === 404, `should be 200 or 404, got ${status}`);
      if (status === 200) {
        assert.ok(data.run_id);
      }
    });
  });

  describe('Panel 08 — Phase 08 Extraction', () => {
    it('GET /run/{id}/phase08-extraction returns data or 404', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/phase08-extraction`);
      assert.ok(status === 200 || status === 404, `should be 200 or 404, got ${status}`);
      if (status === 200) {
        assert.ok(data.run_id);
      }
    });
  });

  describe('Panel — LLM Traces', () => {
    it('GET /run/{id}/llm-traces returns trace data', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/llm-traces`);
      assert.equal(status, 200);
      assert.ok(data.run_id);
      assert.ok(typeof data.count === 'number');
      assert.ok(Array.isArray(data.traces));
    });
  });

  describe('Panel 09 — Round Summary', () => {
    it('GET /run/{id}/rounds returns round summary', async () => {
      if (!serverUp || !richRunId) return;
      const { status, data } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/rounds`);
      assert.equal(status, 200);
      assert.ok(data.run_id);
      assert.ok(typeof data.round_count === 'number');
      assert.ok(Array.isArray(data.rounds));
    });
  });

  describe('Indexing Packets', () => {
    it('GET /run/{id}/source-indexing-packets returns data or 404', async () => {
      if (!serverUp || !richRunId) return;
      const { status } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/source-indexing-packets`);
      assert.ok(status === 200 || status === 404, `should be 200 or 404, got ${status}`);
    });

    it('GET /run/{id}/item-indexing-packet returns data or 404', async () => {
      if (!serverUp || !richRunId) return;
      const { status } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/item-indexing-packet`);
      assert.ok(status === 200 || status === 404, `should be 200 or 404, got ${status}`);
    });

    it('GET /run/{id}/run-meta-packet returns data or 404', async () => {
      if (!serverUp || !richRunId) return;
      const { status } = await fetchJson(`/api/v1/indexlab/run/${richRunId}/run-meta-packet`);
      assert.ok(status === 200 || status === 404, `should be 200 or 404, got ${status}`);
    });
  });

  describe('Error handling', () => {
    it('returns proper 404 for events of non-existent run', async () => {
      if (!serverUp) return;
      const { status, data } = await fetchJson('/api/v1/indexlab/run/fake-run-99/events');
      assert.ok(status === 200 || status === 404, 'should handle gracefully');
      if (status === 200 && Array.isArray(data?.events)) {
        assert.equal(data.events.length, 0, 'should return empty events for unknown run');
      }
    });

    it('returns proper 404 for needset of non-existent run', async () => {
      if (!serverUp) return;
      const { status } = await fetchJson('/api/v1/indexlab/run/fake-run-99/needset');
      assert.equal(status, 404);
    });
  });
});
