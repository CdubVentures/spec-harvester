import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runDaemon } from '../src/daemon/daemon.js';

function makeJob(id) {
  return {
    productId: id,
    s3key: `specs/inputs/mouse/products/${id}.json`
  };
}

test('runDaemon respects daemon concurrency cap per iteration', async () => {
  const jobs = [
    makeJob('mouse-a'),
    makeJob('mouse-b'),
    makeJob('mouse-c'),
    makeJob('mouse-d'),
    makeJob('mouse-e')
  ];
  let active = 0;
  let maxActive = 0;

  const result = await runDaemon({
    storage: {},
    config: {
      importsPollSeconds: 1,
      helperFilesEnabled: false,
      daemonConcurrency: 3
    },
    once: true,
    runtimeHooks: {
      categories: ['mouse'],
      ingestIncomingCsvs: async () => ({
        discovered_csv_count: 0,
        processed_count: 0,
        failed_count: 0
      }),
      selectNextRunnableJob: async () => jobs.shift() || null,
      markStaleQueueProducts: async () => ({ stale_marked: 0, products: [] }),
      runUntilComplete: async ({ s3key }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        return {
          s3key,
          productId: s3key.split('/').pop().replace('.json', ''),
          complete: true,
          exhausted: false,
          stop_reason: 'complete'
        };
      },
      wait: async () => {}
    }
  });

  assert.equal(maxActive <= 3, true);
  assert.equal(result.run_count, 3);
});

test('runDaemon exits after SIGTERM with graceful drain of active work', async () => {
  const signalTarget = new EventEmitter();
  const jobs = [
    makeJob('mouse-a'),
    makeJob('mouse-b')
  ];
  let runCount = 0;

  const result = await runDaemon({
    storage: {},
    config: {
      importsPollSeconds: 1,
      helperFilesEnabled: false,
      daemonConcurrency: 1
    },
    once: false,
    runtimeHooks: {
      categories: ['mouse'],
      signalTarget,
      ingestIncomingCsvs: async () => ({
        discovered_csv_count: 0,
        processed_count: 0,
        failed_count: 0
      }),
      selectNextRunnableJob: async () => jobs.shift() || null,
      markStaleQueueProducts: async () => ({ stale_marked: 0, products: [] }),
      runUntilComplete: async ({ s3key }) => {
        runCount += 1;
        signalTarget.emit('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          s3key,
          productId: s3key.split('/').pop().replace('.json', ''),
          complete: true,
          exhausted: false,
          stop_reason: 'complete'
        };
      },
      wait: async () => {}
    }
  });

  assert.equal(runCount, 1);
  assert.equal(result.run_count, 1);
  assert.equal(result.stop_reason, 'signal:SIGTERM');
});

test('runDaemon performs drift scan and drift reconcile for drift re-extract jobs', async () => {
  const jobs = [
    {
      productId: 'mouse-drift-case',
      s3key: 'specs/inputs/mouse/products/mouse-drift-case.json',
      next_action_hint: 'drift_reextract'
    }
  ];
  let scanCalls = 0;
  let reconcileCalls = 0;

  const result = await runDaemon({
    storage: {},
    config: {
      importsPollSeconds: 1,
      helperFilesEnabled: false,
      daemonConcurrency: 1,
      driftDetectionEnabled: true,
      driftPollSeconds: 1
    },
    once: true,
    runtimeHooks: {
      categories: ['mouse'],
      ingestIncomingCsvs: async () => ({
        discovered_csv_count: 0,
        processed_count: 0,
        failed_count: 0
      }),
      selectNextRunnableJob: async () => jobs.shift() || null,
      markStaleQueueProducts: async () => ({ stale_marked: 0, products: [] }),
      scanAndEnqueueDrift: async () => {
        scanCalls += 1;
        return {
          scanned_count: 1,
          baseline_seeded_count: 0,
          drift_detected_count: 1,
          queued_count: 1
        };
      },
      runUntilComplete: async ({ s3key }) => ({
        s3key,
        productId: 'mouse-drift-case',
        complete: true,
        exhausted: false,
        stop_reason: 'complete'
      }),
      reconcileDriftProduct: async () => {
        reconcileCalls += 1;
        return {
          action: 'queued_for_review',
          changed_fields: [{ field: 'weight' }],
          evidence_failures: []
        };
      },
      wait: async () => {}
    }
  });

  assert.equal(scanCalls, 1);
  assert.equal(reconcileCalls, 1);
  assert.equal(result.run_count, 1);
});
