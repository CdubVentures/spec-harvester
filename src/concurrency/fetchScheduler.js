import { WorkerPool } from './workerPool.js';
import { HostPacer } from './hostPacer.js';
import { classifyFallbackAction, buildFallbackDecision } from './fallbackPolicy.js';

export function createFetchScheduler({
  concurrency = 2,
  perHostDelayMs = 300,
  maxRetries = 1,
  nowFn = Date.now,
  sleepFn
} = {}) {
  const pool = new WorkerPool({ concurrency, name: 'fetch' });
  const pacer = new HostPacer({ delayMs: perHostDelayMs, nowFn, sleepFn });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let fallbackAttempts = 0;

  async function drainQueue({
    sources,
    fetchFn,
    fetchWithMode,
    shouldSkip,
    shouldStop,
    onFetchResult,
    onFetchError,
    onSkipped,
    classifyOutcome,
    onFallbackAttempt,
    onFallbackExhausted,
    emitEvent,
    initialMode = 'crawlee',
    maxRetries: drainMaxRetries
  }) {
    const startMs = nowFn();
    const effectiveMaxRetries = drainMaxRetries !== undefined ? drainMaxRetries : maxRetries;
    const emit = typeof emitEvent === 'function' ? emitEvent : () => {};

    const tasks = [];

    while (sources.hasNext()) {
      if (typeof shouldStop === 'function' && shouldStop()) break;

      const source = sources.next();
      if (!source) continue;

      if (typeof shouldSkip === 'function' && shouldSkip(source)) {
        skipped++;
        if (typeof onSkipped === 'function') onSkipped(source, 'shouldSkip');
        continue;
      }

      const task = pool.run(async () => {
        if (typeof shouldStop === 'function' && shouldStop()) {
          skipped++;
          if (typeof onSkipped === 'function') onSkipped(source, 'stopped');
          return;
        }
        const host = source.host || '';
        const waitMs = pacer.remainingMs(host);
        if (waitMs > 0) {
          emit('scheduler_host_wait', { host, wait_ms: waitMs });
          await pacer.waitForSlot(host);
        }
        pacer.recordFetch(host);

        let currentMode = initialMode;
        let exhaustedModes = [];
        let retryCount = 0;
        let lastError = null;
        let previousMode = null;

        const doFetch = async (mode) => {
          if (typeof fetchWithMode === 'function') {
            return await fetchWithMode(source, mode);
          }
          return await fetchFn(source);
        };

        while (true) {
          try {
            const result = await doFetch(currentMode);
            processed++;
            if (retryCount > 0) {
              emit('scheduler_fallback_succeeded', {
                url: source.url,
                mode: currentMode,
                attempt: retryCount,
                from_mode: previousMode || initialMode
              });
            }
            if (typeof onFetchResult === 'function') onFetchResult(source, result);
            emit('scheduler_tick', { ...pool.stats(), skipped, host_count: pacer.stats().hostCount });
            return;
          } catch (err) {
            lastError = err;

            if (typeof classifyOutcome !== 'function' || typeof fetchWithMode !== 'function') {
              failed++;
              if (typeof onFetchError === 'function') onFetchError(source, err);
              emit('scheduler_tick', { ...pool.stats(), skipped, host_count: pacer.stats().hostCount });
              return;
            }

            const outcome = classifyOutcome(err);
            const decision = buildFallbackDecision({
              outcome,
              currentMode,
              exhaustedModes,
              retryCount,
              maxRetries: effectiveMaxRetries,
              waitMs: typeof sleepFn === 'function' ? 1000 : 60000
            });

            if (decision.action === 'none' || decision.action === 'skip' || decision.exhausted) {
              if (decision.exhausted) {
                fallbackAttempts++;
                emit('scheduler_fallback_exhausted', {
                  url: source.url,
                  modes_tried: [initialMode, ...exhaustedModes],
                  final_outcome: outcome
                });
                if (typeof onFallbackExhausted === 'function') {
                  onFallbackExhausted(source, {
                    modes_tried: [initialMode, ...exhaustedModes],
                    final_outcome: outcome
                  });
                }
              }
              failed++;
              if (typeof onFetchError === 'function') onFetchError(source, err);
              emit('scheduler_tick', { ...pool.stats(), skipped, host_count: pacer.stats().hostCount });
              return;
            }

            fallbackAttempts++;
            const fromMode = currentMode;
            previousMode = currentMode;
            exhaustedModes = [...exhaustedModes, currentMode];

            if (decision.shouldWait && decision.waitMs > 0) {
              emit('scheduler_host_wait', { host, wait_ms: decision.waitMs });
              if (typeof sleepFn === 'function') {
                await sleepFn(decision.waitMs);
              } else {
                await new Promise((r) => setTimeout(r, decision.waitMs));
              }
            }

            currentMode = decision.nextMode || currentMode;
            retryCount++;

            emit('scheduler_fallback_started', {
              url: source.url,
              from_mode: fromMode,
              to_mode: currentMode,
              outcome,
              attempt: retryCount
            });

            if (typeof onFallbackAttempt === 'function') {
              onFallbackAttempt(source, {
                fromMode,
                toMode: currentMode,
                outcome,
                attempt: retryCount
              });
            }
          }
        }
      });

      tasks.push(task.catch(() => {}));
    }

    await Promise.all(tasks);

    const summary = {
      processed,
      skipped,
      failed,
      fallback_attempts: fallbackAttempts,
      elapsed_ms: nowFn() - startMs
    };

    emit('scheduler_drain_completed', summary);

    return summary;
  }

  function stats() {
    const poolStats = pool.stats();
    return {
      active: poolStats.active,
      queued: poolStats.queued,
      completed: poolStats.completed,
      failed: poolStats.failed,
      skipped,
      processed
    };
  }

  return { drainQueue, stats };
}
