import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function stripTrailingV1(url) {
  return String(url || '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
}

function toTimeoutSignal(timeoutMs) {
  if (globalThis.AbortSignal?.timeout) {
    return globalThis.AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function isComposeRunningOutput(text) {
  const token = String(text || '').toLowerCase();
  if (!token.includes('chatmock')) {
    return false;
  }
  return token.includes('running') || token.includes('up');
}

export class CortexLifecycle {
  constructor(config = {}, deps = {}) {
    this.composeFile = String(config.CHATMOCK_COMPOSE_FILE || '').trim()
      || path.join(String(config.CHATMOCK_DIR || '').trim(), 'docker-compose.yml');
    this.chatmockDir = String(config.CHATMOCK_DIR || '').trim() || path.dirname(this.composeFile);
    this.baseUrlNoV1 = stripTrailingV1(config.CORTEX_BASE_URL) || 'http://localhost:8000';
    this.autoStart = boolFromEnv(config.CORTEX_AUTO_START, false);
    this.ensureReadyTimeoutMs = Math.max(1_000, toInt(config.CORTEX_ENSURE_READY_TIMEOUT_MS, 15_000));
    this.startReadyTimeoutMs = Math.max(3_000, toInt(config.CORTEX_START_READY_TIMEOUT_MS, 60_000));
    this._startingUp = false;

    this.execFile = deps.execFile || execFileAsync;
    this.fetch = deps.fetch || globalThis.fetch;
    this.sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async _compose(args, options = {}) {
    const composeArgs = ['compose', '-f', this.composeFile, ...args];
    try {
      const { stdout = '', stderr = '' } = await this.execFile('docker', composeArgs, {
        cwd: this.chatmockDir,
        timeout: options.timeout || 120_000,
        windowsHide: true
      });
      return {
        ok: true,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim()
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error || 'compose_failed'),
        stderr: String(error?.stderr || '').trim()
      };
    }
  }

  async _waitForReady(timeoutMs = 60_000) {
    const deadline = Date.now() + Math.max(1_000, Number(timeoutMs) || 60_000);
    while (Date.now() < deadline) {
      try {
        const response = await this.fetch(`${this.baseUrlNoV1}/v1/models`, {
          signal: toTimeoutSignal(3_000)
        });
        if (response?.ok) {
          return true;
        }
      } catch {
        // keep polling until timeout
      }
      await this.sleep(3_000);
    }
    return false;
  }

  async start() {
    if (this._startingUp) {
      return { ok: true, status: 'already_starting' };
    }
    this._startingUp = true;
    try {
      const dockerCheck = await this._compose(['version']);
      if (!dockerCheck.ok) {
        return { ok: false, error: 'Docker Desktop is not running. Start it first.' };
      }

      const up = await this._compose(['up', '-d'], { timeout: 180_000 });
      if (!up.ok) {
        return up;
      }

      const healthy = await this._waitForReady(this.startReadyTimeoutMs);
      return { ok: healthy, status: healthy ? 'started' : 'started_but_unready' };
    } finally {
      this._startingUp = false;
    }
  }

  async stop() {
    return this._compose(['down']);
  }

  async restart() {
    await this.stop();
    await this.sleep(3_000);
    return this.start();
  }

  async rebuild() {
    return this._compose(['up', '-d', '--build'], { timeout: 300_000 });
  }

  async status() {
    const ps = await this._compose(['ps']);
    const running = ps.ok && isComposeRunningOutput(ps.stdout);
    if (!running) {
      return { running: false, ready: false, models: [] };
    }

    try {
      const response = await this.fetch(`${this.baseUrlNoV1}/v1/models`, {
        signal: toTimeoutSignal(5_000)
      });
      if (!response?.ok) {
        return { running: true, ready: false, models: [] };
      }
      const payload = await response.json();
      const models = Array.isArray(payload?.data)
        ? payload.data.map((row) => String(row?.id || '').trim()).filter(Boolean)
        : [];
      return { running: true, ready: true, models };
    } catch {
      return { running: true, ready: false, models: [] };
    }
  }

  async ensureRunning() {
    const initial = await this.status();
    if (initial.ready) {
      return { ok: true, status: initial };
    }

    if (!initial.running && this.autoStart) {
      const startResult = await this.start();
      return {
        ok: Boolean(startResult?.ok),
        status: await this.status()
      };
    }

    const ready = await this._waitForReady(this.ensureReadyTimeoutMs);
    return {
      ok: ready,
      status: await this.status()
    };
  }
}
