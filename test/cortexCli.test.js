import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('src/cli/spec.js');

async function runCli(args, { env = {} } = {}) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      }
    }
  );
  return JSON.parse(stdout);
}

test('cortex-route-plan CLI produces capped deep-tier assignments', async () => {
  const output = await runCli([
    'cortex-route-plan',
    '--tasks-json',
    JSON.stringify([
      { id: 't1', type: 'conflict_resolution', critical: true },
      { id: 't2', type: 'conflict_resolution', critical: true },
      { id: 't3', type: 'conflict_resolution', critical: true }
    ]),
    '--context-json',
    JSON.stringify({
      confidence: 0.7,
      critical_conflicts_remain: true
    }),
    '--local'
  ], {
    env: {
      CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT: '2'
    }
  });

  assert.equal(output.command, 'cortex-route-plan');
  assert.equal(output.deep_task_count, 2);
  assert.equal(Array.isArray(output.assignments), true);
});

test('cortex-run-pass CLI falls back immediately when sidecar is disabled', async () => {
  const output = await runCli([
    'cortex-run-pass',
    '--tasks-json',
    JSON.stringify([{ id: 'audit-1', type: 'evidence_audit', critical: true }]),
    '--local'
  ], {
    env: {
      CORTEX_ENABLED: 'false'
    }
  });

  assert.equal(output.command, 'cortex-run-pass');
  assert.equal(output.mode, 'disabled');
  assert.equal(output.fallback_to_non_sidecar, true);
});
