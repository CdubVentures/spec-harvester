import fs from 'node:fs/promises';
import path from 'node:path';

function toIso(value) {
  const raw = String(value || '').trim();
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return new Date().toISOString();
}

function asInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRunId(row = {}) {
  return String(row.runId || row.run_id || '').trim();
}

function normalizeStageStatus(statusCode) {
  const status = asInt(statusCode, 0);
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404 || status === 410) return '404';
  if (status === 403 || status === 429) return 'blocked';
  if (status >= 300 && status < 400) return 'redirect';
  if (status > 0) return 'error';
  return 'error';
}

function isSearchEvent(name = '') {
  return (
    name.startsWith('discovery_')
    || name.startsWith('search_provider_')
    || name === 'search_provider_diagnostics'
  );
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNeedSetSnapshot(row = {}, ts = '') {
  const safeTs = toIso(ts || row.ts || new Date().toISOString());
  const payload = {
    run_id: String(row.runId || row.run_id || '').trim(),
    category: String(row.category || row.cat || '').trim(),
    product_id: String(row.productId || row.product_id || '').trim(),
    generated_at: safeTs,
    total_fields: asInt(row.total_fields, 0),
    needset_size: asInt(row.needset_size ?? row.size, 0),
    reason_counts: toObject(row.reason_counts),
    required_level_counts: toObject(row.required_level_counts),
    needs: Array.isArray(row.needs) ? row.needs : [],
    snapshots: Array.isArray(row.snapshots) ? row.snapshots : []
  };
  if (payload.snapshots.length === 0) {
    payload.snapshots = [{ ts: safeTs, needset_size: payload.needset_size }];
  }
  return payload;
}

async function appendNdjson(filePath, row) {
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

export class IndexLabRuntimeBridge {
  constructor({ outRoot = 'artifacts/indexlab', context = {}, onEvent = null } = {}) {
    this.outRoot = path.resolve(String(outRoot || 'artifacts/indexlab'));
    this.context = { ...(context || {}) };
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;

    this.runId = '';
    this.runDir = '';
    this.eventsPath = '';
    this.runMetaPath = '';
    this.needSetPath = '';
    this.startedAt = '';
    this.endedAt = '';
    this.status = 'running';
    this.needSet = null;

    this.stageState = {
      search: { started_at: '', ended_at: '' },
      fetch: { started_at: '', ended_at: '' },
      parse: { started_at: '', ended_at: '' },
      index: { started_at: '', ended_at: '' }
    };
    this.fetchByUrl = new Map();
    this.queue = Promise.resolve();
    this.counters = {
      pages_checked: 0,
      fetched_ok: 0,
      fetched_404: 0,
      fetched_blocked: 0,
      fetched_error: 0,
      parse_completed: 0,
      indexed_docs: 0,
      fields_filled: 0
    };
  }

  setContext(next = {}) {
    this.context = {
      ...this.context,
      ...next
    };
  }

  onRuntimeEvent(row = {}) {
    this.queue = this.queue
      .then(() => this._handleRuntimeEvent(row))
      .catch(() => {});
  }

  async finalize(summary = {}) {
    this.queue = this.queue
      .then(async () => {
        const endedAt = toIso(summary?.ended_at || summary?.endedAt || new Date().toISOString());
        this.endedAt = endedAt;
        if (summary?.status) {
          this.status = String(summary.status);
        } else if (!this.status) {
          this.status = 'completed';
        }
        await this._finishStage('search', endedAt, { reason: 'run_finalize' });
        await this._finishStage('fetch', endedAt, { reason: 'run_finalize' });
        await this._finishStage('parse', endedAt, { reason: 'run_finalize' });
        await this._finishStage('index', endedAt, { reason: 'run_finalize' });
        await this._writeRunMeta({
          ...summary,
          status: this.status,
          ended_at: endedAt
        });
      })
      .catch(() => {});
    await this.queue;
  }

  async _ensureRun(row = {}) {
    const runId = normalizeRunId(row);
    if (!runId) return false;
    if (this.runId && this.runId !== runId) return false;
    if (this.runId === runId && this.runDir) return true;

    this.runId = runId;
    this.runDir = path.join(this.outRoot, runId);
    this.eventsPath = path.join(this.runDir, 'run_events.ndjson');
    this.runMetaPath = path.join(this.runDir, 'run.json');
    this.needSetPath = path.join(this.runDir, 'needset.json');
    this.startedAt = toIso(row.ts || new Date().toISOString());

    await fs.mkdir(this.runDir, { recursive: true });
    await this._writeRunMeta({
      status: 'running',
      started_at: this.startedAt
    });
    return true;
  }

  async _writeRunMeta(extra = {}) {
    if (!this.runMetaPath) return;
    const doc = {
      run_id: this.runId || '',
      started_at: this.startedAt || '',
      ended_at: this.endedAt || '',
      status: this.status || 'running',
      category: this.context.category || '',
      product_id: this.context.productId || '',
      s3key: this.context.s3Key || '',
      out_root: this.outRoot,
      events_path: this.eventsPath || '',
      counters: this.counters,
      stages: this.stageState,
      needset: this.needSet
        ? {
          needset_size: asInt(this.needSet.needset_size, 0),
          total_fields: asInt(this.needSet.total_fields, 0),
          generated_at: this.needSet.generated_at || null
        }
        : null,
      ...extra
    };
    await fs.writeFile(this.runMetaPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  async _writeNeedSet(payload = {}) {
    if (!this.needSetPath) return;
    await fs.writeFile(this.needSetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  async _emit(stage, event, payload = {}, ts = '') {
    if (!this.eventsPath || !this.runId) return;
    const row = {
      run_id: this.runId,
      category: this.context.category || '',
      product_id: this.context.productId || '',
      ts: toIso(ts || new Date().toISOString()),
      stage: String(stage || '').trim(),
      event: String(event || '').trim(),
      payload: payload && typeof payload === 'object' ? payload : {}
    };
    await appendNdjson(this.eventsPath, row);
    if (this.onEvent) {
      try {
        this.onEvent(row);
      } catch {
        // ignore callback failures
      }
    }
  }

  async _startStage(stage, ts = '', payload = {}) {
    const state = this.stageState[stage];
    if (!state || state.started_at) return;
    state.started_at = toIso(ts || new Date().toISOString());
    await this._emit(stage, `${stage}_started`, { scope: 'stage', ...payload }, state.started_at);
  }

  async _finishStage(stage, ts = '', payload = {}) {
    const state = this.stageState[stage];
    if (!state || !state.started_at || state.ended_at) return;
    state.ended_at = toIso(ts || new Date().toISOString());
    await this._emit(stage, `${stage}_finished`, { scope: 'stage', ...payload }, state.ended_at);
  }

  async _handleRuntimeEvent(row = {}) {
    const ready = await this._ensureRun(row);
    if (!ready) return;
    const runId = normalizeRunId(row);
    if (runId !== this.runId) return;

    const rowCategory = String(row.category || row.cat || '').trim();
    const rowProductId = String(row.productId || row.product_id || '').trim();
    if (rowCategory || rowProductId) {
      this.setContext({
        category: rowCategory || this.context.category || '',
        productId: rowProductId || this.context.productId || ''
      });
    }

    const eventName = String(row.event || '').trim();
    const ts = toIso(row.ts || new Date().toISOString());
    const url = String(row.url || row.finalUrl || '').trim();

    if (eventName === 'run_started') {
      this.startedAt = ts;
      this.setContext({
        category: row.category || row.cat || this.context.category || '',
        productId: row.productId || row.product_id || this.context.productId || ''
      });
      // Mark the run as active immediately so GUI activity panels do not appear stalled
      // while discovery planning/setup is still running before first fetch.
      await this._startStage('search', ts, { trigger: 'run_started' });
    }

    if (isSearchEvent(eventName)) {
      await this._startStage('search', ts, { trigger: eventName });
      if (eventName === 'discovery_query_started') {
        await this._emit('search', 'search_started', {
          scope: 'query',
          query: String(row.query || ''),
          provider: String(row.provider || '')
        }, ts);
      } else if (eventName === 'discovery_query_completed') {
        await this._emit('search', 'search_finished', {
          scope: 'query',
          query: String(row.query || ''),
          provider: String(row.provider || ''),
          result_count: asInt(row.result_count, 0),
          duration_ms: asInt(row.duration_ms, 0)
        }, ts);
      }
    }

    if (eventName === 'source_fetch_started') {
      await this._startStage('fetch', ts, { trigger: eventName });
      if (this.stageState.search.started_at && !this.stageState.search.ended_at) {
        await this._finishStage('search', ts, { reason: 'first_fetch_started' });
      }
      if (url) {
        this.counters.pages_checked += 1;
        this.fetchByUrl.set(url, { started_at: ts });
      }
      await this._emit('fetch', 'fetch_started', {
        scope: 'url',
        url,
        tier: asInt(row.tier, 0),
        role: String(row.role || '')
      }, ts);
    }

    if (eventName === 'source_fetch_failed') {
      await this._startStage('fetch', ts, { trigger: eventName });
      await this._finishFetchUrl({
        url,
        ts,
        status: 0,
        error: String(row.message || '')
      });
    }

    if (eventName === 'source_processed') {
      await this._startStage('fetch', ts, { trigger: eventName });
      await this._startStage('parse', ts, { trigger: eventName });
      await this._startStage('index', ts, { trigger: eventName });

      const status = asInt(row.status, 0);
      await this._finishFetchUrl({
        url,
        ts,
        status
      });

      this.counters.parse_completed += 1;
      await this._emit('parse', 'parse_finished', {
        scope: 'url',
        url,
        status,
        candidate_count: asInt(row.candidate_count, 0)
      }, ts);
    }

    if (eventName === 'fields_filled_from_source') {
      await this._startStage('index', ts, { trigger: eventName });
      const count = asInt(row.count, 0);
      this.counters.indexed_docs += 1;
      this.counters.fields_filled += Math.max(0, count);
      await this._emit('index', 'index_finished', {
        scope: 'url',
        url,
        count,
        filled_fields: Array.isArray(row.filled_fields) ? row.filled_fields : []
      }, ts);
    }

    if (eventName === 'needset_computed') {
      await this._startStage('index', ts, { trigger: eventName });
      const payload = toNeedSetSnapshot(row, ts);
      this.needSet = payload;
      await this._emit('index', 'needset_computed', {
        scope: 'needset',
        needset_size: payload.needset_size,
        total_fields: payload.total_fields,
        reason_counts: payload.reason_counts,
        required_level_counts: payload.required_level_counts,
        needs: payload.needs,
        snapshots: payload.snapshots
      }, ts);
      await this._writeNeedSet(payload);
      await this._writeRunMeta({
        needset: {
          needset_size: payload.needset_size,
          total_fields: payload.total_fields,
          generated_at: payload.generated_at
        }
      });
    }

    if (row.level === 'error' || eventName === 'max_run_seconds_reached') {
      await this._emit('error', 'error', {
        event: eventName,
        message: String(row.message || ''),
        url
      }, ts);
    }

    if (eventName === 'run_completed') {
      this.status = 'completed';
      this.endedAt = ts;
      await this._finishStage('search', ts, { reason: 'run_completed' });
      await this._finishStage('fetch', ts, { reason: 'run_completed' });
      await this._finishStage('parse', ts, { reason: 'run_completed' });
      await this._finishStage('index', ts, { reason: 'run_completed' });
      await this._writeRunMeta({
        status: 'completed',
        ended_at: ts
      });
    }
  }

  async _finishFetchUrl({ url = '', ts = '', status = 0, error = '' } = {}) {
    const started = url ? this.fetchByUrl.get(url) : null;
    if (url) {
      this.fetchByUrl.delete(url);
    }
    const durationMs = started?.started_at
      ? Math.max(0, Date.parse(toIso(ts)) - Date.parse(toIso(started.started_at)))
      : 0;
    const statusClass = normalizeStageStatus(status);
    if (statusClass === 'ok') this.counters.fetched_ok += 1;
    else if (statusClass === '404') this.counters.fetched_404 += 1;
    else if (statusClass === 'blocked') this.counters.fetched_blocked += 1;
    else this.counters.fetched_error += 1;

    await this._emit('fetch', 'fetch_finished', {
      scope: 'url',
      url,
      status: asInt(status, 0),
      status_class: statusClass,
      ms: durationMs,
      error
    }, ts);
  }
}
