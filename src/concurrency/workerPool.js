/**
 * Worker Pool with concurrency limits (IP05-5A).
 *
 * Provides named pools for separate subsystems:
 *   - crawl/fetch pool
 *   - extraction pool
 *   - LLM pool
 *   - Cortex pool
 *
 * Each pool enforces a maximum concurrency limit and queues
 * excess tasks until a slot opens.
 */

export class WorkerPool {
  constructor({ concurrency = 4, name = 'default' } = {}) {
    this._concurrency = Math.max(1, Math.floor(concurrency) || 4);
    this._name = String(name || 'default');
    this._active = 0;
    this._queue = [];
    this._completed = 0;
    this._failed = 0;
  }

  /**
   * Submit a task (async function) to the pool.
   * Returns a promise that resolves with the task's return value.
   */
  run(taskFn) {
    return new Promise((resolve, reject) => {
      const wrapped = async () => {
        this._active += 1;
        try {
          const result = await taskFn();
          this._completed += 1;
          resolve(result);
        } catch (err) {
          this._failed += 1;
          reject(err);
        } finally {
          this._active -= 1;
          this._drain();
        }
      };

      if (this._active < this._concurrency) {
        wrapped();
      } else {
        this._queue.push(wrapped);
      }
    });
  }

  /**
   * Wait for all active and queued tasks to complete.
   * Tasks that reject will not prevent drain from finishing.
   */
  async drain() {
    while (this._active > 0 || this._queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  stats() {
    return {
      name: this._name,
      concurrency: this._concurrency,
      active: this._active,
      queued: this._queue.length,
      completed: this._completed,
      failed: this._failed
    };
  }

  _drain() {
    while (this._queue.length > 0 && this._active < this._concurrency) {
      const next = this._queue.shift();
      next();
    }
  }
}
