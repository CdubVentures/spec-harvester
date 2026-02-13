import fs from 'node:fs/promises';
import path from 'node:path';
import { wait } from '../utils/common.js';
import {
  ingestIncomingCsvs,
  listImportCategories
} from '../ingest/csvIngestor.js';
import {
  reconcileDriftedProduct,
  scanAndEnqueueDriftedProducts
} from '../publish/driftScheduler.js';
import {
  loadQueueState,
  markStaleQueueProducts,
  recordQueueFailure,
  selectNextQueueProduct,
  syncQueueFromInputs,
  upsertQueueProduct
} from '../queue/queueState.js';
import { runUntilComplete } from '../runner/runUntilComplete.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { syncJobsFromActiveFiltering } from '../helperFiles/index.js';

async function listConfiguredCategories() {
  const dir = path.resolve('categories');
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function resolveCategories({
  category,
  all = false,
  importsRoot
}) {
  if (category) {
    return [category];
  }
  if (!all) {
    return ['mouse'];
  }

  const fromConfig = await listConfiguredCategories();
  const fromImports = await listImportCategories(importsRoot);
  return [...new Set([...fromConfig, ...fromImports])].sort();
}

export async function selectNextRunnableJob({
  storage,
  category
}) {
  await syncQueueFromInputs({ storage, category });
  const loaded = await loadQueueState({ storage, category });
  const next = selectNextQueueProduct(loaded.state);
  if (!next || !next.s3key) {
    return null;
  }
  await upsertQueueProduct({
    storage,
    category,
    productId: next.productId,
    s3key: next.s3key,
    patch: {
      status: 'in_progress',
      next_action_hint: 'claimed_by_daemon'
    }
  });
  return next;
}

async function runJobsWithConcurrency(jobs = [], concurrency = 1, worker) {
  const output = [];
  const count = Math.max(1, Number.parseInt(String(concurrency || 1), 10) || 1);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= jobs.length) {
        return;
      }
      output[current] = await worker(jobs[current], current);
    }
  }

  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return output;
}

function canUseDriftScheduler(storage) {
  return Boolean(
    storage &&
    typeof storage.listKeys === 'function' &&
    typeof storage.readJsonOrNull === 'function' &&
    typeof storage.readTextOrNull === 'function'
  );
}

export async function runWatchImports({
  storage,
  config,
  importsRoot = config.importsRoot || 'imports',
  category,
  all = false,
  once = false,
  logger = null
}) {
  let iteration = 0;
  const categories = await resolveCategories({
    category,
    all,
    importsRoot
  });

  if (!categories.length) {
    return {
      mode: 'watch-imports',
      imports_root: path.resolve(importsRoot),
      categories: [],
      iterations: 0,
      runs: []
    };
  }

  const runs = [];
  do {
    iteration += 1;
    for (const cat of categories) {
      const result = await ingestIncomingCsvs({
        storage,
        config,
        category: cat,
        importsRoot
      });
      runs.push(result);
      logger?.info?.('imports_ingested', {
        category: cat,
        discovered_csv_count: result.discovered_csv_count,
        processed_count: result.processed_count,
        failed_count: result.failed_count
      });
    }
    if (once) {
      break;
    }
    await wait(Math.max(1, Number(config.importsPollSeconds || 10)) * 1000);
  } while (true);

  return {
    mode: 'watch-imports',
    imports_root: path.resolve(importsRoot),
    categories,
    iterations: iteration,
    runs
  };
}

export async function runDaemon({
  storage,
  config,
  importsRoot = config.importsRoot || 'imports',
  category,
  all = false,
  mode = config.accuracyMode || 'balanced',
  once = false,
  logger = null,
  runtimeHooks = {}
}) {
  let iteration = 0;
  const categories = Array.isArray(runtimeHooks.categories) && runtimeHooks.categories.length > 0
    ? runtimeHooks.categories
    : await resolveCategories({
      category,
      all,
      importsRoot
    });
  if (!categories.length) {
    return {
      mode: 'daemon',
      categories: [],
      iterations: 0,
      runs: [],
      stop_reason: null
    };
  }

  const ingestIncomingCsvsFn = runtimeHooks.ingestIncomingCsvs || ingestIncomingCsvs;
  const selectNextRunnableJobFn = runtimeHooks.selectNextRunnableJob || selectNextRunnableJob;
  const runUntilCompleteFn = runtimeHooks.runUntilComplete || runUntilComplete;
  const waitFn = runtimeHooks.wait || wait;
  const markStaleQueueProductsFn = runtimeHooks.markStaleQueueProducts || markStaleQueueProducts;
  const scanAndEnqueueDriftFn = runtimeHooks.scanAndEnqueueDrift || scanAndEnqueueDriftedProducts;
  const reconcileDriftProductFn = runtimeHooks.reconcileDriftProduct || reconcileDriftedProduct;
  const signalTarget = runtimeHooks.signalTarget || process;
  const driftDetectionEnabled = Boolean(
    runtimeHooks.driftDetectionEnabled ??
    config.driftDetectionEnabled ??
    true
  );
  const driftPollSeconds = Math.max(
    1,
    Number.parseInt(
      String(runtimeHooks.driftPollSeconds || config.driftPollSeconds || 24 * 60 * 60),
      10
    ) || (24 * 60 * 60)
  );
  const driftScanMaxProducts = Math.max(
    1,
    Number.parseInt(
      String(runtimeHooks.driftScanMaxProducts || config.driftScanMaxProducts || 250),
      10
    ) || 250
  );
  const autoRepublishDrift = Boolean(
    runtimeHooks.driftAutoRepublish ??
    config.driftAutoRepublish ??
    true
  );
  const daemonConcurrency = Math.max(
    1,
    Number.parseInt(String(runtimeHooks.daemonConcurrency || config.daemonConcurrency || 3), 10) || 3
  );

  const runs = [];
  const nextDriftScanMsByCategory = new Map();
  let stopRequested = false;
  let stopReason = null;
  const daemonSignals = ['SIGTERM', 'SIGINT'];
  const signalHandlers = new Map();
  for (const signalName of daemonSignals) {
    const handler = () => {
      stopRequested = true;
      stopReason = `signal:${signalName}`;
      logger?.warn?.('daemon_signal_received', {
        signal: signalName,
        action: 'drain_and_exit'
      });
    };
    signalHandlers.set(signalName, handler);
    signalTarget?.on?.(signalName, handler);
  }

  try {
    do {
      if (stopRequested) {
        break;
      }
      iteration += 1;

      for (const cat of categories) {
        const ingest = await ingestIncomingCsvsFn({
          storage,
          config,
          category: cat,
          importsRoot
        });
        logger?.info?.('daemon_ingest_cycle', {
          category: cat,
          discovered_csv_count: ingest.discovered_csv_count,
          processed_count: ingest.processed_count,
          failed_count: ingest.failed_count
        });

        if (config.helperFilesEnabled && config.helperAutoSeedTargets) {
          try {
            const categoryConfig = await loadCategoryConfig(cat, { storage, config });
            const syncResult = await syncJobsFromActiveFiltering({
              storage,
              config,
              category: cat,
              categoryConfig,
              limit: Math.max(0, Number.parseInt(String(config.helperActiveSyncLimit || 0), 10) || 0),
              logger
            });
            logger?.info?.('daemon_helper_active_sync', {
              category: cat,
              active_rows: syncResult.active_rows,
              created: syncResult.created,
              skipped_existing: syncResult.skipped_existing,
              failed: syncResult.failed
            });
          } catch (error) {
            logger?.warn?.('daemon_helper_active_sync_failed', {
              category: cat,
              message: error.message
            });
          }
        }

        const staleScan = await markStaleQueueProductsFn({
          storage,
          category: cat,
          staleAfterDays: Math.max(1, Number.parseInt(String(config.reCrawlStaleAfterDays || 30), 10) || 30)
        });
        logger?.info?.('daemon_stale_scan', {
          category: cat,
          stale_marked: staleScan.stale_marked
        });

        if (driftDetectionEnabled && (runtimeHooks.scanAndEnqueueDrift || canUseDriftScheduler(storage))) {
          const nowMs = Date.now();
          const nextRunAtMs = nextDriftScanMsByCategory.get(cat) || 0;
          const shouldRunDriftScan = once || nowMs >= nextRunAtMs;
          if (shouldRunDriftScan) {
            try {
              const driftScan = await scanAndEnqueueDriftFn({
                storage,
                config,
                category: cat,
                maxProducts: driftScanMaxProducts,
                queueOnChange: true
              });
              nextDriftScanMsByCategory.set(cat, nowMs + (driftPollSeconds * 1000));
              logger?.info?.('daemon_drift_scan', {
                category: cat,
                scanned_count: driftScan.scanned_count,
                baseline_seeded_count: driftScan.baseline_seeded_count,
                drift_detected_count: driftScan.drift_detected_count,
                queued_count: driftScan.queued_count
              });
            } catch (error) {
              logger?.warn?.('daemon_drift_scan_failed', {
                category: cat,
                message: error.message
              });
            }
          }
        }
      }

      const claimedJobs = [];
      for (const cat of categories) {
        while (claimedJobs.length < daemonConcurrency) {
          const nextJob = await selectNextRunnableJobFn({
            storage,
            category: cat
          });
          if (!nextJob) {
            break;
          }
          claimedJobs.push({
            ...nextJob,
            category: cat
          });
        }
        if (claimedJobs.length >= daemonConcurrency) {
          break;
        }
      }

      const processedAny = claimedJobs.length > 0;
      if (processedAny) {
        const runRows = await runJobsWithConcurrency(
          claimedJobs,
          daemonConcurrency,
          async (nextJob) => {
            logger?.info?.('daemon_job_started', {
              category: nextJob.category,
              productId: nextJob.productId,
              s3key: nextJob.s3key
            });
            try {
              const run = await runUntilCompleteFn({
                storage,
                config: {
                  ...config,
                  accuracyMode: mode
                },
                s3key: nextJob.s3key,
                maxRounds: mode === 'aggressive' ? 8 : 4,
                mode
              });
              const nextHint = String(nextJob.next_action_hint || '').trim().toLowerCase();
              if (
                run.complete &&
                !run.exhausted &&
                nextHint.startsWith('drift_') &&
                (runtimeHooks.reconcileDriftProduct || canUseDriftScheduler(storage))
              ) {
                try {
                  const driftOutcome = await reconcileDriftProductFn({
                    storage,
                    config,
                    category: nextJob.category,
                    productId: nextJob.productId,
                    autoRepublish: autoRepublishDrift
                  });
                  run.drift_reconcile = {
                    action: driftOutcome.action,
                    changed_fields: (driftOutcome.changed_fields || []).length,
                    evidence_failures: (driftOutcome.evidence_failures || []).length
                  };
                  logger?.info?.('daemon_drift_reconcile', {
                    category: nextJob.category,
                    productId: nextJob.productId,
                    action: driftOutcome.action,
                    changed_fields: (driftOutcome.changed_fields || []).length,
                    evidence_failures: (driftOutcome.evidence_failures || []).length
                  });
                } catch (error) {
                  logger?.warn?.('daemon_drift_reconcile_failed', {
                    category: nextJob.category,
                    productId: nextJob.productId,
                    message: error.message
                  });
                }
              }
              logger?.info?.('daemon_job_completed', {
                category: nextJob.category,
                productId: nextJob.productId,
                complete: run.complete,
                exhausted: run.exhausted,
                stop_reason: run.stop_reason
              });
              return run;
            } catch (error) {
              const failure = await recordQueueFailure({
                storage,
                category: nextJob.category,
                productId: nextJob.productId,
                s3key: nextJob.s3key,
                error
              });
              logger?.error?.('daemon_job_failed', {
                category: nextJob.category,
                productId: nextJob.productId,
                s3key: nextJob.s3key,
                message: error.message,
                status: failure.product.status,
                retry_count: failure.product.retry_count,
                max_attempts: failure.product.max_attempts,
                next_retry_at: failure.product.next_retry_at || null
              });
              return {
                s3key: nextJob.s3key,
                productId: nextJob.productId,
                category: nextJob.category,
                complete: false,
                exhausted: true,
                needs_manual: failure.product.status === 'failed',
                stop_reason: failure.product.status === 'failed'
                  ? 'job_failed_max_attempts'
                  : 'job_failed_retry_scheduled',
                error: error.message
              };
            }
          }
        );
        runs.push(...runRows.filter(Boolean));
      }

      if (once) {
        break;
      }
      if (stopRequested) {
        break;
      }
      if (!processedAny) {
        await waitFn(Math.max(1, Number(config.importsPollSeconds || 10)) * 1000);
      }
    } while (true);
  } finally {
    for (const signalName of daemonSignals) {
      const handler = signalHandlers.get(signalName);
      if (!handler) {
        continue;
      }
      if (typeof signalTarget?.off === 'function') {
        signalTarget.off(signalName, handler);
      } else if (typeof signalTarget?.removeListener === 'function') {
        signalTarget.removeListener(signalName, handler);
      }
    }
  }

  return {
    mode: 'daemon',
    imports_root: path.resolve(importsRoot),
    categories,
    iterations: iteration,
    run_count: runs.length,
    stop_reason: stopReason,
    runs
  };
}
