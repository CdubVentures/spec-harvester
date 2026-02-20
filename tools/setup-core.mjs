import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

export const IS_WINDOWS = process.platform === 'win32';

export function toolName(base) {
  if (!IS_WINDOWS) {
    return base;
  }
  if (base.endsWith('.cmd') || base.endsWith('.exe')) {
    return base;
  }
  return `${base}.cmd`;
}

export function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function parseDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) {
    return {};
  }
  const out = {};
  const raw = fs.readFileSync(dotEnvPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const clean = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const index = clean.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = clean.slice(0, index).trim();
    let value = clean.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(root) {
  return {
    ...parseDotEnv(path.join(root, '.env')),
    ...process.env
  };
}

export function normalizeUrl(value, fallback = '') {
  const token = String(value || fallback || '').trim();
  if (!token) {
    return '';
  }
  return token.replace(/\/+$/, '');
}

export function hostAndPort(urlString, fallbackPort) {
  const url = new URL(urlString);
  const host = String(url.hostname || 'localhost');
  const port = Number.parseInt(url.port || '', 10) || fallbackPort;
  return { host, port };
}

export function checkSocket(urlString, fallbackPort, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let host = 'localhost';
    let port = fallbackPort;

    try {
      const parsed = hostAndPort(urlString, fallbackPort);
      host = parsed.host;
      port = parsed.port;
    } catch {
      resolve({
        ok: false,
        host,
        port,
        error: 'invalid_url'
      });
      return;
    }

    const socket = new net.Socket();
    let settled = false;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(payload);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, host, port }));
    socket.once('timeout', () => finish({ ok: false, host, port, error: 'timeout' }));
    socket.once('error', (error) => {
      finish({
        ok: false,
        host,
        port,
        error: String(error?.code || error?.message || 'connect_error')
      });
    });
    socket.connect(port, host);
  });
}

export function commandExists(command) {
  return new Promise((resolve) => {
    let probe = null;
    try {
      probe = spawn(IS_WINDOWS ? 'where' : 'which', [command], {
        stdio: 'ignore',
        shell: false
      });
    } catch {
      resolve(false);
      return;
    }
    probe.once('error', () => resolve(false));
    probe.once('close', (code) => resolve(code === 0));
  });
}

export function runCommand(command, args = [], options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    allowFailure = false,
    onLine = null,
    echo = false,
    shell = null
  } = options;

  const useShell = shell === null
    ? Boolean(IS_WINDOWS && /\.(cmd|bat)$/i.test(String(command || '')))
    : Boolean(shell);

  return new Promise((resolve, reject) => {
    let child = null;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: useShell,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      if (allowFailure) {
        resolve({
          ok: false,
          code: 1,
          stdout: '',
          stderr: '',
          error: String(error?.message || error)
        });
        return;
      }
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let outCarry = '';
    let errCarry = '';

    const emitLines = (chunk, fromStdErr = false) => {
      const text = String(chunk || '');
      const lines = text.split(/\r?\n/);
      if (fromStdErr) {
        lines[0] = errCarry + lines[0];
      } else {
        lines[0] = outCarry + lines[0];
      }

      const last = lines.pop();
      for (const line of lines) {
        if (!line) {
          continue;
        }
        if (onLine) {
          onLine(line);
        }
        if (echo) {
          process.stdout.write(`${line}\n`);
        }
      }

      if (fromStdErr) {
        errCarry = last || '';
      } else {
        outCarry = last || '';
      }
    };

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      emitLines(text, false);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      emitLines(text, true);
    });

    child.once('error', (error) => {
      if (allowFailure) {
        resolve({
          ok: false,
          code: 1,
          stdout,
          stderr,
          error: String(error?.message || error)
        });
        return;
      }
      reject(error);
    });

    child.once('close', (code) => {
      if (outCarry) {
        if (onLine) {
          onLine(outCarry);
        }
        if (echo) {
          process.stdout.write(`${outCarry}\n`);
        }
      }
      if (errCarry) {
        if (onLine) {
          onLine(errCarry);
        }
        if (echo) {
          process.stdout.write(`${errCarry}\n`);
        }
      }

      if (code === 0) {
        resolve({ ok: true, code: 0, stdout, stderr });
        return;
      }
      if (allowFailure) {
        resolve({
          ok: false,
          code: Number(code || 1),
          stdout,
          stderr,
          error: `exit_${code}`
        });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`));
    });
  });
}

export async function getCommandOutput(command, args = [], options = {}) {
  const result = await runCommand(command, args, {
    ...options,
    allowFailure: true
  });
  return {
    ok: result.ok,
    code: result.code,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null
  };
}

export function searxLikelyNeeded(envVars) {
  const provider = String(envVars.SEARCH_PROVIDER || 'none').trim().toLowerCase();
  if (provider === 'searxng') {
    return true;
  }
  return Boolean(envVars.SEARXNG_BASE_URL);
}

function candidateChatmockComposeFiles(envVars = {}) {
  const files = [];

  const composeFromEnv = String(envVars.CHATMOCK_COMPOSE_FILE || '').trim();
  if (composeFromEnv) {
    files.push(composeFromEnv);
  }

  const dirFromEnv = String(envVars.CHATMOCK_DIR || '').trim();
  if (dirFromEnv) {
    files.push(path.join(dirFromEnv, 'docker-compose.yml'));
  }

  const profile = String(envVars.USERPROFILE || process.env.USERPROFILE || '').trim();
  if (profile) {
    files.push(path.join(profile, 'Desktop', 'ChatMock', 'docker-compose.yml'));
    files.push(path.join(profile, 'Desktop', 'ChatMock - claude', 'docker-compose.yml'));
  }

  return [...new Set(files)];
}

function resolveChatmockComposeFile(envVars = {}) {
  for (const filePath of candidateChatmockComposeFiles(envVars)) {
    if (filePath && fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return '';
}

export function resolveChatmockCompose(envVars = {}) {
  return resolveChatmockComposeFile(envVars);
}

function inferEvalBenchHostPortFromCompose(composePath) {
  if (!composePath || !fs.existsSync(composePath)) {
    return null;
  }
  let text = '';
  try {
    text = fs.readFileSync(composePath, 'utf8');
  } catch {
    return null;
  }

  const blockMatch = text.match(
    /^\s{2}eval-bench:\s*([\s\S]*?)(?=^\s{2}[A-Za-z0-9_-]+:\s*$|^volumes:|\Z)/m
  );
  if (!blockMatch) {
    return null;
  }
  const block = blockMatch[1];
  const mapping = block.match(/["']?(\d+)\s*:\s*4000["']?/);
  if (!mapping) {
    return null;
  }
  const hostPort = Number.parseInt(mapping[1], 10);
  return Number.isFinite(hostPort) ? hostPort : null;
}

function inferCortexAsyncBaseUrl(envVars = {}) {
  const fromEnv = normalizeUrl(envVars.CORTEX_ASYNC_BASE_URL, '');
  if (fromEnv) {
    return {
      url: fromEnv,
      source: 'env',
      composeFile: ''
    };
  }

  const composeFile = resolveChatmockComposeFile(envVars);
  const hostPort = inferEvalBenchHostPortFromCompose(composeFile);
  if (!hostPort) {
    return {
      url: '',
      source: '',
      composeFile: composeFile || ''
    };
  }
  return {
    url: `http://localhost:${hostPort}/api`,
    source: 'chatmock_compose',
    composeFile
  };
}

export function resolveCortexAsyncBaseUrl(envVars = {}) {
  const meta = inferCortexAsyncBaseUrl(envVars);
  return {
    url: meta.url || '',
    source: meta.source || '',
    compose_file: meta.composeFile || ''
  };
}

export function buildServiceTargets(envVars = {}) {
  const targets = [];
  const llmEnabled = parseBool(envVars.LLM_ENABLED, false);
  const cortexEnabled = parseBool(envVars.CORTEX_ENABLED, false);
  const asyncEnabledExplicit = hasOwn(envVars, 'CORTEX_ASYNC_ENABLED');
  const cortexAsyncEnabled = parseBool(envVars.CORTEX_ASYNC_ENABLED, false);
  const asyncDisabledExplicit = asyncEnabledExplicit && !cortexAsyncEnabled;
  const asyncUrlMeta = inferCortexAsyncBaseUrl(envVars);
  const asyncUrl = normalizeUrl(asyncUrlMeta.url, '');
  let asyncPort = 4000;
  if (asyncUrl) {
    try {
      asyncPort = hostAndPort(asyncUrl, 4000).port;
    } catch {
      asyncPort = 4000;
    }
  }
  const asyncConfigured = !asyncDisabledExplicit &&
    Boolean(asyncUrl) &&
    (
      cortexAsyncEnabled ||
      hasOwn(envVars, 'CORTEX_ASYNC_BASE_URL') ||
      asyncUrlMeta.source === 'chatmock_compose'
    );

  if (llmEnabled || cortexEnabled) {
    targets.push({
      id: 'svc_llm_sync',
      category: 'services',
      name: 'LLM/Cortex Sync Endpoint',
      url: normalizeUrl(envVars.CORTEX_BASE_URL || envVars.LLM_BASE_URL, 'http://localhost:5001/v1'),
      fallbackPort: 5001,
      required: true
    });
  }

  if (cortexEnabled && asyncConfigured) {
    targets.push({
      id: 'svc_cortex_async',
      category: 'services',
      name: 'Cortex Async Endpoint (optional)',
      url: asyncUrl,
      fallbackPort: asyncPort,
      required: false,
      source: asyncUrlMeta.source || 'default',
      compose_file: asyncUrlMeta.composeFile || ''
    });
  }

  if (searxLikelyNeeded(envVars)) {
    targets.push({
      id: 'svc_searxng',
      category: 'services',
      name: 'SearXNG Endpoint',
      url: normalizeUrl(envVars.SEARXNG_BASE_URL, 'http://127.0.0.1:8080'),
      fallbackPort: 8080,
      required: false
    });
  }

  return targets;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dockerDesktopCandidates() {
  const files = [];
  const programFiles = String(process.env.ProgramFiles || 'C:\\Program Files').trim();
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] || '').trim();
  files.push(path.join(programFiles, 'Docker', 'Docker', 'Docker Desktop.exe'));
  if (programFilesX86) {
    files.push(path.join(programFilesX86, 'Docker', 'Docker', 'Docker Desktop.exe'));
  }
  return [...new Set(files)];
}

async function tryStartDockerDesktop(onLine) {
  if (!IS_WINDOWS) {
    return false;
  }
  for (const candidate of dockerDesktopCandidates()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const child = spawn(candidate, [], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      if (onLine) {
        onLine(`Attempted Docker Desktop launch: ${candidate}`);
      }
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

async function ensureDockerReady({ root, onLine = null } = {}) {
  const hasDocker = await commandExists('docker');
  if (!hasDocker) {
    if (onLine) {
      onLine('Docker CLI not found in PATH.');
    }
    return false;
  }

  const quick = await getCommandOutput('docker', ['info'], {
    cwd: root,
    shell: false
  });
  if (quick.ok) {
    return true;
  }

  if (onLine) {
    onLine('Docker daemon not ready. Trying to start Docker Desktop...');
  }
  const launched = await tryStartDockerDesktop(onLine);
  if (!launched) {
    if (onLine) {
      onLine('Could not auto-launch Docker Desktop.');
    }
    return false;
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = await getCommandOutput('docker', ['info'], {
      cwd: root,
      shell: false
    });
    if (result.ok) {
      if (onLine) {
        onLine('Docker daemon is ready.');
      }
      return true;
    }
    await sleep(3000);
  }

  if (onLine) {
    onLine('Docker did not become ready within timeout.');
  }
  return false;
}

async function waitForService(url, fallbackPort, timeoutMs = 90_000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 90_000);
  while (Date.now() < deadline) {
    const probe = await checkSocket(url, fallbackPort);
    if (probe.ok) {
      return true;
    }
    await sleep(2000);
  }
  return false;
}

function resolveCortexSyncEndpoint(envVars = {}) {
  const url = normalizeUrl(envVars.CORTEX_BASE_URL || envVars.LLM_BASE_URL, 'http://localhost:5001/v1');
  let port = 5001;
  try {
    port = hostAndPort(url, 5001).port;
  } catch {
    port = 5001;
  }
  return { url, port };
}

function resolveChatmockUiUrl(envVars = {}) {
  const explicit = normalizeUrl(envVars.CHATMOCK_UI_URL, '');
  if (explicit) {
    return explicit;
  }

  const asyncMeta = inferCortexAsyncBaseUrl(envVars);
  const asyncUrl = normalizeUrl(asyncMeta.url, '');
  if (asyncUrl) {
    return asyncUrl.replace(/\/api$/i, '');
  }

  const sync = resolveCortexSyncEndpoint(envVars).url;
  if (sync) {
    return sync.replace(/\/v1$/i, '');
  }
  return '';
}

export async function startChatmockEvalBenchStack({
  root,
  envVars = null,
  onLine = null,
  waitForReady = true
} = {}) {
  const env = envVars || loadEnv(root);
  const composePath = resolveChatmockComposeFile(env);
  if (!composePath) {
    throw new Error('ChatMock docker-compose.yml not found.');
  }

  const dockerReady = await ensureDockerReady({ root, onLine });
  if (!dockerReady) {
    throw new Error('Docker is not ready.');
  }

  const composeDir = path.dirname(composePath);
  if (onLine) {
    onLine(`Starting ChatMock stack via: ${composePath}`);
  }

  const up = await runCommand('docker', ['compose', '-f', composePath, 'up', '-d'], {
    cwd: composeDir,
    allowFailure: true,
    onLine,
    shell: false
  });
  if (!up.ok) {
    throw new Error(`docker compose up failed (${up.error || up.code})`);
  }

  const sync = resolveCortexSyncEndpoint(env);
  const asyncMeta = inferCortexAsyncBaseUrl(env);
  const asyncUrl = normalizeUrl(asyncMeta.url, '');
  const asyncEnabled = parseBool(env.CORTEX_ASYNC_ENABLED, false)
    || hasOwn(env, 'CORTEX_ASYNC_BASE_URL')
    || asyncMeta.source === 'chatmock_compose';
  let asyncPort = 4000;
  if (asyncUrl) {
    try {
      asyncPort = hostAndPort(asyncUrl, 4000).port;
    } catch {
      asyncPort = 4000;
    }
  }

  const readiness = {
    sync_url: sync.url,
    sync_ready: false,
    async_url: asyncEnabled ? asyncUrl : '',
    async_ready: false
  };

  if (waitForReady) {
    if (onLine) {
      onLine(`Waiting for ChatMock sync endpoint: ${sync.url}`);
    }
    readiness.sync_ready = await waitForService(sync.url, sync.port, 120_000);
    if (!readiness.sync_ready && onLine) {
      onLine('ChatMock sync endpoint did not become ready in time.');
    }

    if (asyncEnabled && asyncUrl) {
      if (onLine) {
        onLine(`Waiting for async endpoint: ${asyncUrl}`);
      }
      readiness.async_ready = await waitForService(asyncUrl, asyncPort, 120_000);
      if (!readiness.async_ready && onLine) {
        onLine('ChatMock async endpoint did not become ready in time.');
      }
    }
  }

  return {
    ok: true,
    compose_file: composePath,
    ...readiness
  };
}

async function maybeAutoStartChatmockStack({ root, envVars = {}, onLine = null } = {}) {
  const syncTarget = buildServiceTargets(envVars).find((row) => row.id === 'svc_llm_sync');
  if (!syncTarget) {
    return { attempted: false, started: false };
  }
  const composePath = resolveChatmockComposeFile(envVars);
  if (!composePath) {
    return { attempted: false, started: false };
  }

  const before = await checkSocket(syncTarget.url, syncTarget.fallbackPort);
  if (before.ok) {
    return { attempted: false, started: false };
  }

  if (onLine) {
    onLine('LLM/Cortex sync endpoint is down. Attempting ChatMock stack start...');
  }

  try {
    const started = await startChatmockEvalBenchStack({
      root,
      envVars,
      onLine,
      waitForReady: true
    });
    return {
      attempted: true,
      started: Boolean(started.sync_ready)
    };
  } catch (error) {
    if (onLine) {
      onLine(`ChatMock stack start failed: ${error.message || error}`);
    }
    return { attempted: true, started: false };
  }
}

async function maybeAutoStartSearxng({ root, envVars = {}, onLine = null } = {}) {
  const target = buildServiceTargets(envVars).find((row) => row.id === 'svc_searxng');
  if (!target) {
    return { attempted: false, started: false };
  }

  const before = await checkSocket(target.url, target.fallbackPort);
  if (before.ok) {
    return { attempted: false, started: false };
  }

  const composePath = path.join(root, 'tools', 'searxng', 'docker-compose.yml');
  if (!fs.existsSync(composePath)) {
    if (onLine) {
      onLine('SearXNG compose file not found. Skipping auto-start.');
    }
    return { attempted: false, started: false };
  }

  if (onLine) {
    onLine('SearXNG endpoint is down. Attempting Docker auto-start...');
  }
  try {
    const started = await startSearxngStack({
      root,
      envVars,
      onLine,
      waitForReady: true
    });
    return { attempted: true, started: Boolean(started.ready) };
  } catch (error) {
    if (onLine) {
      onLine(`SearXNG auto-start failed: ${error.message || error}`);
    }
    return { attempted: true, started: false };
  }
}

export async function startSearxngStack({
  root,
  envVars = null,
  onLine = null,
  waitForReady = true
} = {}) {
  const env = envVars || loadEnv(root);
  const target = buildServiceTargets(env).find((row) => row.id === 'svc_searxng');
  if (!target) {
    throw new Error('SearXNG endpoint is not configured.');
  }

  const composePath = path.join(root, 'tools', 'searxng', 'docker-compose.yml');
  if (!fs.existsSync(composePath)) {
    throw new Error('SearXNG compose file not found.');
  }

  const dockerReady = await ensureDockerReady({ root, onLine });
  if (!dockerReady) {
    throw new Error('Docker is not ready.');
  }

  if (onLine) {
    onLine(`Starting SearXNG stack via: ${composePath}`);
  }

  const up = await runCommand('docker', ['compose', '-f', composePath, 'up', '-d'], {
    cwd: root,
    allowFailure: true,
    onLine,
    shell: false
  });
  if (!up.ok) {
    throw new Error(`SearXNG docker compose up failed (${up.error || up.code})`);
  }

  let ready = true;
  if (waitForReady) {
    if (onLine) {
      onLine(`Waiting for SearXNG endpoint: ${target.url}`);
    }
    ready = await waitForService(target.url, target.fallbackPort, 120_000);
    if (!ready && onLine) {
      onLine('SearXNG endpoint did not become ready in time.');
    }
  }

  return {
    ok: true,
    compose_file: composePath,
    url: target.url,
    ready
  };
}

function endpointActionForTarget({
  target,
  chatmockComposePath,
  envVars = {},
  reachable = false,
  allTargets = []
} = {}) {
  if (target.id === 'svc_searxng') {
    if (reachable) {
      return {
        action_id: 'open_searxng_ui',
        action_label: 'Open SearXNG UI',
        action_kind: 'launch'
      };
    }
    return {
      action_id: 'start_searxng_stack',
      action_label: 'Launch SearXNG',
      action_kind: 'launch'
    };
  }
  if ((target.id === 'svc_llm_sync' || target.id === 'svc_cortex_async') && chatmockComposePath) {
    if (reachable) {
      const hasAsyncTarget = allTargets.some((row) => row.id === 'svc_cortex_async');
      const exposeUiAction = target.id === 'svc_cortex_async' || !hasAsyncTarget;
      if (exposeUiAction && resolveChatmockUiUrl(envVars)) {
        return {
          action_id: 'open_chatmock_ui',
          action_label: 'Open ChatMock UI',
          action_kind: 'launch'
        };
      }
      return {
        action_id: '',
        action_label: '',
        action_kind: ''
      };
    }
    return {
      action_id: 'start_chatmock_stack',
      action_label: 'Launch ChatMock',
      action_kind: 'launch'
    };
  }
  return {
    action_id: '',
    action_label: '',
    action_kind: ''
  };
}

function checkWithUiMeta(payload = {}) {
  return {
    installed_state: 'unknown',
    running_state: 'inactive',
    action_id: '',
    action_label: '',
    action_kind: '',
    ...payload
  };
}

function openUrlInBrowser(url) {
  if (!url) {
    throw new Error('URL is required.');
  }

  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return;
    }

    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [url], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch (error) {
    throw new Error(`Failed to open URL: ${error?.message || error}`);
  }
}

export async function runEndpointChecks({ envVars = {}, strictServices = false, onLine = null } = {}) {
  const targets = buildServiceTargets(envVars);
  const checks = [];
  const chatmockComposePath = resolveChatmockComposeFile(envVars);
  let requiredFailures = 0;

  const chatmockTargets = targets.filter(
    (target) => target.id === 'svc_llm_sync' || target.id === 'svc_cortex_async'
  );
  const otherTargets = targets.filter(
    (target) => target.id !== 'svc_llm_sync' && target.id !== 'svc_cortex_async'
  );

  for (const target of otherTargets) {
    const result = await checkSocket(target.url, target.fallbackPort);
    const action = endpointActionForTarget({
      target,
      chatmockComposePath,
      envVars,
      reachable: result.ok,
      allTargets: targets
    });
    if (result.ok) {
      const line = `[ok] ${target.name} -> ${result.host}:${result.port}`;
      if (onLine) {
        onLine(line);
      }
      checks.push(checkWithUiMeta({
        ...target,
        status: 'ok',
        reachable: true,
        details: `${result.host}:${result.port}`,
        installed_state: 'installed',
        running_state: 'running',
        ...action
      }));
      continue;
    }

    const strictFailure = target.required && strictServices;
    if (strictFailure) {
      requiredFailures += 1;
    }
    const level = strictFailure ? 'error' : 'warn';
    const line = `[${level}] ${target.name} not reachable (${result.host}:${result.port}, ${result.error})`;
    if (onLine) {
      onLine(line);
    }

    checks.push(checkWithUiMeta({
      ...target,
      status: strictFailure ? 'missing' : 'warn',
      reachable: false,
      details: `${result.host}:${result.port} (${result.error})`,
      installed_state: 'installed',
      running_state: 'inactive',
      ...action
    }));
  }

  if (chatmockTargets.length > 0) {
    const syncTarget = chatmockTargets.find((target) => target.id === 'svc_llm_sync') || null;
    const asyncTarget = chatmockTargets.find((target) => target.id === 'svc_cortex_async') || null;

    let syncResult = null;
    if (syncTarget) {
      syncResult = await checkSocket(syncTarget.url, syncTarget.fallbackPort);
      const level = syncResult.ok ? 'ok' : (strictServices && syncTarget.required ? 'error' : 'warn');
      if (onLine) {
        onLine(`[${level}] ${syncTarget.name} ${syncResult.ok ? '->' : 'not reachable ('}${syncResult.host}:${syncResult.port}${syncResult.ok ? '' : `, ${syncResult.error})`}`);
      }
    }

    let asyncResult = null;
    if (asyncTarget) {
      asyncResult = await checkSocket(asyncTarget.url, asyncTarget.fallbackPort);
      if (onLine) {
        const level = asyncResult.ok ? 'ok' : 'warn';
        onLine(`[${level}] ${asyncTarget.name} ${asyncResult.ok ? '->' : 'not reachable ('}${asyncResult.host}:${asyncResult.port}${asyncResult.ok ? '' : `, ${asyncResult.error})`}`);
      }
    }

    const syncReady = Boolean(syncResult?.ok);
    const asyncReady = Boolean(asyncResult?.ok);
    const requiredReady = syncTarget ? syncReady : asyncReady;
    const syncStrictFailure = Boolean(syncTarget && !syncReady && strictServices && syncTarget.required);
    if (syncStrictFailure) {
      requiredFailures += 1;
    }

    const detailParts = [];
    if (syncTarget && syncResult) {
      detailParts.push(`sync ${syncResult.host}:${syncResult.port} (${syncResult.ok ? 'up' : (syncResult.error || 'down')})`);
    }
    if (asyncTarget && asyncResult) {
      const asyncState = asyncResult.ok
        ? 'up'
        : `${asyncResult.error || 'down'}, optional`;
      detailParts.push(`async ${asyncResult.host}:${asyncResult.port} (${asyncState})`);
    }
    if (chatmockComposePath) {
      detailParts.push(`compose ${chatmockComposePath}`);
    } else if (!requiredReady) {
      detailParts.push('compose not found (set CHATMOCK_COMPOSE_FILE for one-click launch)');
    }

    let action = {
      action_id: '',
      action_label: '',
      action_kind: ''
    };
    if (requiredReady) {
      const chatmockUiUrl = resolveChatmockUiUrl(envVars);
      if (chatmockUiUrl) {
        action = {
          action_id: 'open_chatmock_ui',
          action_label: 'Open ChatMock UI',
          action_kind: 'launch'
        };
      }
    } else if (chatmockComposePath) {
      action = {
        action_id: 'start_chatmock_stack',
        action_label: 'Launch ChatMock',
        action_kind: 'launch'
      };
    }

    checks.push(checkWithUiMeta({
      id: 'svc_chatmock',
      category: 'services',
      name: 'ChatMock Endpoint',
      required: Boolean(syncTarget?.required),
      status: requiredReady ? 'ok' : (syncStrictFailure ? 'missing' : 'warn'),
      reachable: requiredReady,
      details: detailParts.join(' | '),
      installed_state: requiredReady || chatmockComposePath ? 'installed' : 'missing',
      running_state: requiredReady ? 'running' : 'inactive',
      ...action
    }));
  }

  return {
    checks,
    requiredFailures
  };
}

export async function detectPythonCommand() {
  if (await commandExists('python')) {
    return 'python';
  }
  if (await commandExists('py')) {
    return 'py';
  }
  return '';
}

function localPlaywrightInstalled(root) {
  const browserRoot = path.join(root, 'node_modules', 'playwright-core', '.local-browsers');
  if (!fs.existsSync(browserRoot)) {
    return false;
  }
  try {
    return fs.readdirSync(browserRoot).some((name) => name.startsWith('chromium-'));
  } catch {
    return false;
  }
}

async function checkPythonModule(pythonCommand, moduleName, root) {
  if (!pythonCommand) {
    return {
      installed: false,
      version: null
    };
  }

  const script = [
    'import importlib.util, importlib.metadata, json',
    `name = ${JSON.stringify(moduleName)}`,
    'spec = importlib.util.find_spec(name)',
    'version = None',
    'if spec is not None:',
    '  try:',
    '    version = importlib.metadata.version(name)',
    '  except Exception:',
    '    version = None',
    'print(json.dumps({"installed": bool(spec), "version": version}))'
  ].join('\n');

  const out = await getCommandOutput(pythonCommand, ['-c', script], { cwd: root });
  if (!out.ok || !out.stdout) {
    return {
      installed: false,
      version: null
    };
  }
  try {
    const parsed = JSON.parse(out.stdout);
    return {
      installed: Boolean(parsed.installed),
      version: parsed.version || null
    };
  } catch {
    return {
      installed: false,
      version: null
    };
  }
}

function summarizeChecks(checks = []) {
  const total = checks.length;
  const ok = checks.filter((row) => row.status === 'ok').length;
  const warn = checks.filter((row) => row.status === 'warn').length;
  const missingRequired = checks.filter((row) => row.required && row.status !== 'ok').length;
  const missingOptional = checks.filter((row) => !row.required && row.status !== 'ok').length;
  return {
    total,
    ok,
    warn,
    missing_required: missingRequired,
    missing_optional: missingOptional
  };
}

function setupReadyForLaunch(checks = []) {
  const requiredFailures = checks.some((row) => row.required && row.status !== 'ok');
  return !requiredFailures;
}

export async function collectSetupStatus({ root, envVars = null } = {}) {
  const env = envVars || loadEnv(root);
  const checks = [];
  const serviceTargets = buildServiceTargets(env);
  const chatmockCompose = resolveChatmockComposeFile(env);

  const nodeVersion = process.version
    ? {
        ok: true,
        stdout: process.version
      }
    : await getCommandOutput('node', ['-v'], { cwd: root });
  checks.push(checkWithUiMeta({
    id: 'node_runtime',
    category: 'core',
    name: 'SpecFactory Runtime (Node.js)',
    status: nodeVersion.ok ? 'ok' : 'warn',
    required: true,
    details: nodeVersion.ok
      ? `active (${nodeVersion.stdout})`
      : 'inactive (Node.js not found in PATH)',
    installed_state: nodeVersion.ok ? 'installed' : 'missing',
    running_state: nodeVersion.ok ? 'running' : 'inactive',
    action_id: nodeVersion.ok ? '' : 'install_node_lts',
    action_label: nodeVersion.ok ? '' : 'Install Node LTS',
    action_kind: nodeVersion.ok ? '' : 'fix'
  }));

  if (serviceTargets.some((row) => row.id === 'svc_searxng')) {
    const dockerCli = await commandExists('docker');
    checks.push(checkWithUiMeta({
      id: 'docker_cli',
      category: 'services',
      name: 'Docker CLI',
      status: dockerCli ? 'ok' : 'warn',
      required: false,
      details: dockerCli ? 'docker command available' : 'docker not found in PATH',
      installed_state: dockerCli ? 'installed' : 'missing',
      running_state: dockerCli ? 'running' : 'inactive',
      action_id: dockerCli ? '' : 'install_docker_desktop',
      action_label: dockerCli ? '' : 'Install Docker Desktop',
      action_kind: dockerCli ? '' : 'fix'
    }));

    if (dockerCli) {
      const dockerInfo = await getCommandOutput('docker', ['info'], {
        cwd: root,
        shell: false
      });
      checks.push(checkWithUiMeta({
        id: 'docker_daemon',
        category: 'services',
        name: 'Docker Daemon',
        status: dockerInfo.ok ? 'ok' : 'warn',
        required: false,
        details: dockerInfo.ok ? 'running' : 'inactive (start Docker Desktop)',
        installed_state: 'installed',
        running_state: dockerInfo.ok ? 'running' : 'inactive',
        action_id: dockerInfo.ok ? '' : 'start_docker_desktop',
        action_label: dockerInfo.ok ? '' : 'Launch Docker',
        action_kind: dockerInfo.ok ? '' : 'launch'
      }));
    }
  }

  const npmCommand = toolName('npm');
  const npmVersion = await getCommandOutput(npmCommand, ['-v'], { cwd: root });
  checks.push(checkWithUiMeta({
    id: 'npm_cli',
    category: 'core',
    name: 'npm CLI',
    status: npmVersion.ok ? 'ok' : 'warn',
    required: true,
    details: npmVersion.ok ? npmVersion.stdout : 'inactive (npm not found)',
    installed_state: npmVersion.ok ? 'installed' : 'missing',
    running_state: npmVersion.ok ? 'running' : 'inactive',
    action_id: npmVersion.ok ? '' : 'install_node_lts',
    action_label: npmVersion.ok ? '' : 'Install Node LTS',
    action_kind: npmVersion.ok ? '' : 'fix'
  }));

  const npxCommand = toolName('npx');
  const npxVersion = await getCommandOutput(npxCommand, ['-v'], { cwd: root });
  checks.push(checkWithUiMeta({
    id: 'npx_cli',
    category: 'core',
    name: 'npx CLI',
    status: npxVersion.ok ? 'ok' : 'warn',
    required: true,
    details: npxVersion.ok ? npxVersion.stdout : 'inactive (npx not found)',
    installed_state: npxVersion.ok ? 'installed' : 'missing',
    running_state: npxVersion.ok ? 'running' : 'inactive',
    action_id: npxVersion.ok ? '' : 'install_node_lts',
    action_label: npxVersion.ok ? '' : 'Install Node LTS',
    action_kind: npxVersion.ok ? '' : 'fix'
  }));

  const hasNodeModules = fs.existsSync(path.join(root, 'node_modules'));
  checks.push(checkWithUiMeta({
    id: 'node_modules',
    category: 'core',
    name: 'Node Modules Installed',
    status: hasNodeModules ? 'ok' : 'missing',
    required: true,
    details: hasNodeModules ? 'node_modules present' : 'npm install required',
    installed_state: hasNodeModules ? 'installed' : 'missing',
    running_state: hasNodeModules ? 'running' : 'inactive',
    action_id: hasNodeModules ? '' : 'install_npm_packages',
    action_label: hasNodeModules ? '' : 'Install npm packages',
    action_kind: hasNodeModules ? '' : 'fix'
  }));

  const playwrightInstalled = localPlaywrightInstalled(root);
  checks.push(checkWithUiMeta({
    id: 'playwright_browser',
    category: 'core',
    name: 'Playwright Chromium',
    status: playwrightInstalled ? 'ok' : 'missing',
    required: true,
    details: playwrightInstalled ? 'local browser binary found' : 'playwright chromium not installed',
    installed_state: playwrightInstalled ? 'installed' : 'missing',
    running_state: playwrightInstalled ? 'running' : 'inactive',
    action_id: playwrightInstalled ? '' : 'install_playwright_chromium',
    action_label: playwrightInstalled ? '' : 'Install Playwright',
    action_kind: playwrightInstalled ? '' : 'fix'
  }));

  const pythonCommand = await detectPythonCommand();
  let pythonVersion = null;
  if (pythonCommand) {
    const version = await getCommandOutput(pythonCommand, ['--version'], { cwd: root });
    pythonVersion = version.ok ? version.stdout : null;
  }

  checks.push(checkWithUiMeta({
    id: 'python_runtime',
    category: 'python',
    name: 'Python Runtime',
    status: pythonCommand ? 'ok' : 'warn',
    required: true,
    details: pythonCommand
      ? `${pythonCommand} (${pythonVersion || 'available'})`
      : 'inactive (python not found in PATH)',
    installed_state: pythonCommand ? 'installed' : 'missing',
    running_state: pythonCommand ? 'running' : 'inactive',
    action_id: pythonCommand ? '' : 'install_python_runtime',
    action_label: pythonCommand ? '' : 'Install Python 3',
    action_kind: pythonCommand ? '' : 'fix'
  }));

  const pdfplumber = await checkPythonModule(pythonCommand, 'pdfplumber', root);
  checks.push(checkWithUiMeta({
    id: 'python_pdfplumber',
    category: 'python',
    name: 'Python: pdfplumber',
    status: pdfplumber.installed ? 'ok' : 'missing',
    required: true,
    details: pdfplumber.installed ? `v${pdfplumber.version || 'installed'}` : 'not installed',
    installed_state: pdfplumber.installed ? 'installed' : 'missing',
    running_state: pdfplumber.installed ? 'running' : 'inactive',
    action_id: pdfplumber.installed ? '' : 'install_python_pdfplumber',
    action_label: pdfplumber.installed ? '' : 'Install pdfplumber',
    action_kind: pdfplumber.installed ? '' : 'fix'
  }));

  const requests = await checkPythonModule(pythonCommand, 'requests', root);
  checks.push(checkWithUiMeta({
    id: 'python_requests',
    category: 'python',
    name: 'Python: requests',
    status: requests.installed ? 'ok' : 'missing',
    required: true,
    details: requests.installed ? `v${requests.version || 'installed'}` : 'not installed',
    installed_state: requests.installed ? 'installed' : 'missing',
    running_state: requests.installed ? 'running' : 'inactive',
    action_id: requests.installed ? '' : 'install_python_requests',
    action_label: requests.installed ? '' : 'Install requests',
    action_kind: requests.installed ? '' : 'fix'
  }));

  const endpoints = await runEndpointChecks({
    envVars: env,
    strictServices: false
  });
  checks.push(...endpoints.checks);

  const specFactoryExePath = path.join(root, 'SpecFactory.exe');
  const specFactoryExeExists = fs.existsSync(specFactoryExePath);
  const readyForLaunch = setupReadyForLaunch(checks);
  checks.push(checkWithUiMeta({
    id: 'specfactory_app',
    category: 'application',
    name: 'SpecFactory App',
    status: specFactoryExeExists ? 'ok' : 'warn',
    required: false,
    details: specFactoryExeExists
      ? `found at ${specFactoryExePath}`
      : `missing (${specFactoryExePath})`,
    installed_state: specFactoryExeExists ? 'installed' : 'missing',
    running_state: 'inactive',
    action_id: specFactoryExeExists ? 'launch_specfactory_exe' : '',
    action_label: specFactoryExeExists ? 'Launch SpecFactory' : '',
    action_kind: specFactoryExeExists ? 'launch' : '',
    action_requires_ready: specFactoryExeExists ? true : false,
    ready_for_launch: readyForLaunch
  }));

  return {
    generated_at: new Date().toISOString(),
    checks,
    summary: summarizeChecks(checks)
  };
}

async function installViaWinget({ root, packageId, packageLabel, onLine = null } = {}) {
  if (!IS_WINDOWS) {
    throw new Error(`${packageLabel || packageId} auto-install is supported on Windows only.`);
  }
  const hasWinget = await commandExists('winget');
  if (!hasWinget) {
    throw new Error('winget was not found in PATH.');
  }
  if (onLine) {
    onLine(`Installing ${packageLabel || packageId} via winget...`);
  }
  const install = await runCommand(
    'winget',
    [
      'install',
      '--id',
      packageId,
      '--exact',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ],
    {
      cwd: root,
      allowFailure: true,
      onLine,
      shell: false
    }
  );
  if (!install.ok) {
    throw new Error(`winget install failed (${install.error || install.code})`);
  }
  return {
    ok: true,
    package_id: packageId,
    restart_required: true
  };
}

async function installPythonModule({ root, moduleName, onLine = null } = {}) {
  const python = await detectPythonCommand();
  if (!python) {
    throw new Error('Python runtime is not available in PATH.');
  }
  await runCommand(python, ['-m', 'pip', 'install', moduleName], {
    cwd: root,
    onLine
  });
  return { ok: true, module: moduleName };
}

export async function runSetupAction({
  root,
  actionId,
  envVars = null,
  onLine = null
} = {}) {
  if (!actionId) {
    throw new Error('actionId is required.');
  }
  const env = envVars || loadEnv(root);
  const npm = toolName('npm');
  const npx = toolName('npx');

  if (actionId === 'install_node_lts') {
    return installViaWinget({
      root,
      packageId: 'OpenJS.NodeJS.LTS',
      packageLabel: 'Node.js LTS',
      onLine
    });
  }

  if (actionId === 'install_python_runtime') {
    return installViaWinget({
      root,
      packageId: 'Python.Python.3.12',
      packageLabel: 'Python 3.12',
      onLine
    });
  }

  if (actionId === 'install_docker_desktop') {
    return installViaWinget({
      root,
      packageId: 'Docker.DockerDesktop',
      packageLabel: 'Docker Desktop',
      onLine
    });
  }

  if (actionId === 'start_docker_desktop') {
    const ready = await ensureDockerReady({ root, onLine });
    if (!ready) {
      throw new Error('Docker is not ready.');
    }
    return { ok: true, ready: true };
  }

  if (actionId === 'install_npm_packages') {
    const hasNpm = await commandExists(npm);
    if (!hasNpm) {
      throw new Error('npm is not available. Install Node.js first.');
    }
    await runCommand(npm, ['install'], {
      cwd: root,
      onLine
    });
    return { ok: true };
  }

  if (actionId === 'install_playwright_chromium') {
    const hasNpx = await commandExists(npx);
    if (!hasNpx) {
      throw new Error('npx is not available. Install Node.js first.');
    }
    await runCommand(npx, ['playwright', 'install', 'chromium'], {
      cwd: root,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: '0'
      },
      onLine
    });
    return { ok: true };
  }

  if (actionId === 'install_python_pdfplumber') {
    return installPythonModule({ root, moduleName: 'pdfplumber', onLine });
  }

  if (actionId === 'install_python_requests') {
    return installPythonModule({ root, moduleName: 'requests', onLine });
  }

  if (actionId === 'start_chatmock_stack') {
    return startChatmockEvalBenchStack({
      root,
      envVars: env,
      onLine,
      waitForReady: true
    });
  }

  if (actionId === 'start_searxng_stack') {
    return startSearxngStack({
      root,
      envVars: env,
      onLine,
      waitForReady: true
    });
  }

  if (actionId === 'open_chatmock_ui') {
    const url = resolveChatmockUiUrl(env);
    if (!url) {
      throw new Error('ChatMock UI URL is not configured.');
    }
    openUrlInBrowser(url);
    if (onLine) {
      onLine(`Opened ChatMock UI: ${url}`);
    }
    return {
      ok: true,
      opened: true,
      url
    };
  }

  if (actionId === 'open_searxng_ui') {
    const url = normalizeUrl(env.SEARXNG_BASE_URL, 'http://127.0.0.1:8080');
    openUrlInBrowser(url);
    if (onLine) {
      onLine(`Opened SearXNG UI: ${url}`);
    }
    return {
      ok: true,
      opened: true,
      url
    };
  }

  if (actionId === 'launch_specfactory_exe') {
    const status = await collectSetupStatus({ root, envVars: env });
    if (!setupReadyForLaunch(status.checks)) {
      throw new Error('Setup not ready. Resolve required checks before launching SpecFactory.');
    }
    const exePath = path.join(root, 'SpecFactory.exe');
    if (!fs.existsSync(exePath)) {
      throw new Error('SpecFactory.exe not found in project root.');
    }
    try {
      const child = spawn(exePath, [], {
        cwd: root,
        detached: true,
        stdio: 'ignore',
        shell: false
      });
      child.unref();
    } catch (error) {
      throw new Error(`Failed to launch SpecFactory.exe (${error?.message || error})`);
    }
    return {
      ok: true,
      launched: true,
      path: exePath
    };
  }

  throw new Error(`Unknown setup action: ${actionId}`);
}

export async function installDependencies({
  root,
  strictServices = false,
  onLine = null
} = {}) {
  const log = (line) => {
    if (onLine) {
      onLine(String(line));
    }
  };

  const npm = toolName('npm');
  const npx = toolName('npx');
  const hasNpm = await commandExists(npm);
  const hasNpx = await commandExists(npx);

  if (!hasNpm || !hasNpx) {
    throw new Error('Node.js + npm are required. Install Node 20+ and retry.');
  }

  log('=== Step 1/5 - npm install ===');
  await runCommand(npm, ['install'], {
    cwd: root,
    onLine: log
  });

  log('=== Step 2/5 - Playwright browser install ===');
  await runCommand(npx, ['playwright', 'install', 'chromium'], {
    cwd: root,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: '0'
    },
    onLine: log
  });

  log('=== Step 3/5 - Python dependencies ===');
  const python = await detectPythonCommand();
  if (!python) {
    log('Python not found in PATH. Skipping pip install.');
  } else if (!fs.existsSync(path.join(root, 'requirements.txt'))) {
    log('requirements.txt not found. Skipping pip install.');
  } else {
    await runCommand(python, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
      cwd: root,
      onLine: log
    });
  }

  const env = loadEnv(root);
  log('=== Step 4/5 - Auto-start docker services ===');
  await maybeAutoStartChatmockStack({
    root,
    envVars: env,
    onLine: log
  });
  await maybeAutoStartSearxng({
    root,
    envVars: env,
    onLine: log
  });

  log('=== Step 5/5 - Service endpoint checks ===');
  const endpointResult = await runEndpointChecks({
    envVars: env,
    strictServices,
    onLine: log
  });
  if (strictServices && endpointResult.requiredFailures > 0) {
    throw new Error('Strict service checks failed. Start required endpoints and retry.');
  }

  return {
    ok: true,
    strict_services: strictServices,
    endpoint_required_failures: endpointResult.requiredFailures
  };
}
