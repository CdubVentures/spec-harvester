import { CortexLifecycle } from './cortex_lifecycle.js';
import { CortexCircuitBreaker } from './cortex_health.js';
import { buildCortexTaskPlan } from './cortex_router.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function normalizeBaseUrl(url, fallback) {
  const value = String(url || fallback || '').trim();
  return value.replace(/\/+$/, '');
}

function toTimeoutSignal(timeoutMs) {
  if (globalThis.AbortSignal?.timeout) {
    return globalThis.AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function fallbackRows(tasks = [], reason = 'sidecar_unavailable') {
  return tasks.map((task, idx) => ({
    id: String(task?.id || `task-${idx + 1}`),
    status: 'fallback_non_sidecar',
    reason
  }));
}

export class CortexClient {
  constructor({
    config = {},
    lifecycle = null,
    fetch = null,
    circuitBreaker = null
  } = {}) {
    this.config = config || {};
    this.fetch = fetch || globalThis.fetch;
    this.lifecycle = lifecycle || new CortexLifecycle(
      {
        CHATMOCK_DIR: this.config.chatmockDir || this.config.CHATMOCK_DIR,
        CHATMOCK_COMPOSE_FILE: this.config.chatmockComposeFile || this.config.CHATMOCK_COMPOSE_FILE,
        CORTEX_BASE_URL: this.config.cortexBaseUrl || this.config.CORTEX_BASE_URL,
        CORTEX_AUTO_START: String(this.config.cortexAutoStart || this.config.CORTEX_AUTO_START || ''),
        CORTEX_ENSURE_READY_TIMEOUT_MS: this.config.cortexEnsureReadyTimeoutMs,
        CORTEX_START_READY_TIMEOUT_MS: this.config.cortexStartReadyTimeoutMs
      },
      {
        fetch: this.fetch
      }
    );
    this.circuitBreaker = circuitBreaker || new CortexCircuitBreaker({
      failureThreshold: toInt(this.config.cortexFailureThreshold, 3),
      openMs: toInt(this.config.cortexCircuitOpenMs, 30_000)
    });
  }

  isEnabled() {
    return toBool(this.config.cortexEnabled, false);
  }

  async health() {
    const status = await this.lifecycle.status();
    return {
      enabled: this.isEnabled(),
      status,
      circuit: this.circuitBreaker.snapshot()
    };
  }

  async runPass({ tasks = [], context = {} } = {}) {
    if (!this.isEnabled()) {
      return {
        ok: true,
        mode: 'disabled',
        fallback_to_non_sidecar: true,
        fallback_reason: 'sidecar_disabled',
        results: fallbackRows(tasks, 'sidecar_disabled'),
        plan: null
      };
    }

    if (!this.circuitBreaker.canRequest()) {
      return {
        ok: true,
        mode: 'fallback',
        fallback_to_non_sidecar: true,
        fallback_reason: 'circuit_open',
        results: fallbackRows(tasks, 'circuit_open'),
        plan: null
      };
    }

    const ensured = await this.lifecycle.ensureRunning();
    if (!ensured.ok || !ensured.status?.ready) {
      this.circuitBreaker.recordFailure('sidecar_not_ready');
      return {
        ok: true,
        mode: 'fallback',
        fallback_to_non_sidecar: true,
        fallback_reason: 'sidecar_unavailable',
        sidecar_status: ensured.status || null,
        results: fallbackRows(tasks, 'sidecar_unavailable'),
        plan: null
      };
    }

    const plan = buildCortexTaskPlan({
      tasks,
      context,
      config: this.config
    });
    const results = [];
    for (const task of plan.assignments) {
      try {
        if (task.transport === 'async') {
          const asyncResult = await this._executeAsyncTask(task);
          results.push({
            id: task.id,
            status: 'ok',
            tier: task.tier,
            model: task.model,
            transport: task.transport,
            response: asyncResult
          });
        } else {
          const syncResult = await this._executeSyncTask(task);
          results.push({
            id: task.id,
            status: 'ok',
            tier: task.tier,
            model: task.model,
            transport: task.transport,
            response: syncResult
          });
        }
      } catch (error) {
        this.circuitBreaker.recordFailure(error);
        results.push({
          id: task.id,
          status: 'error',
          tier: task.tier,
          model: task.model,
          transport: task.transport,
          error: String(error?.message || error || 'sidecar_task_failed')
        });
      }
    }

    const hasErrors = results.some((row) => row.status !== 'ok');
    if (hasErrors) {
      return {
        ok: true,
        mode: 'fallback',
        fallback_to_non_sidecar: true,
        fallback_reason: 'sidecar_task_failed',
        results,
        plan
      };
    }

    this.circuitBreaker.recordSuccess();
    return {
      ok: true,
      mode: 'sidecar',
      fallback_to_non_sidecar: false,
      fallback_reason: null,
      results,
      plan
    };
  }

  async _executeSyncTask(task) {
    const baseUrl = normalizeBaseUrl(this.config.cortexBaseUrl, 'http://localhost:8000/v1');
    const timeoutMs = Math.max(3_000, toInt(this.config.cortexSyncTimeoutMs, 60_000));
    const response = await this.fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${String(this.config.cortexApiKey || 'key')}`
      },
      body: JSON.stringify({
        model: task.model,
        messages: [
          { role: 'system', content: 'You are the Cortex sidecar for Spec Factory.' },
          {
            role: 'user',
            content: JSON.stringify({
              task_id: task.id,
              task_type: task.type,
              critical: task.critical,
              payload: task.payload || {}
            })
          }
        ]
      }),
      signal: toTimeoutSignal(timeoutMs)
    });
    if (!response?.ok) {
      throw new Error(`cortex_sync_http_${response?.status || 'error'}`);
    }
    return response.json();
  }

  async _executeAsyncTask(task) {
    const baseUrl = normalizeBaseUrl(this.config.cortexAsyncBaseUrl, 'http://localhost:4000/api');
    const pollIntervalMs = Math.max(500, toInt(this.config.cortexAsyncPollIntervalMs, 5_000));
    const maxWaitMs = Math.max(3_000, toInt(this.config.cortexAsyncMaxWaitMs, 900_000));
    const submitPath = String(this.config.cortexAsyncSubmitPath || '/jobs');
    const statusTemplate = String(this.config.cortexAsyncStatusPath || '/jobs/{id}');
    const submitRes = await this.fetch(`${baseUrl}${submitPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: task.model,
        task_id: task.id,
        task_type: task.type,
        payload: task.payload || {}
      }),
      signal: toTimeoutSignal(Math.max(3_000, pollIntervalMs))
    });
    if (!submitRes?.ok) {
      throw new Error(`cortex_async_submit_http_${submitRes?.status || 'error'}`);
    }
    const submitPayload = await submitRes.json();
    const jobId = String(submitPayload?.job_id || submitPayload?.id || '').trim();
    if (!jobId) {
      throw new Error('cortex_async_missing_job_id');
    }

    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const statusPath = statusTemplate.replace('{id}', encodeURIComponent(jobId));
      const pollRes = await this.fetch(`${baseUrl}${statusPath}`, {
        signal: toTimeoutSignal(Math.max(3_000, pollIntervalMs))
      });
      if (!pollRes?.ok) {
        throw new Error(`cortex_async_poll_http_${pollRes?.status || 'error'}`);
      }
      const payload = await pollRes.json();
      const status = String(payload?.status || '').toLowerCase();
      if (status === 'completed' || status === 'done' || status === 'succeeded') {
        return payload;
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(String(payload?.error || 'cortex_async_failed'));
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error('cortex_async_timeout');
  }
}
