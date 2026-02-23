const DEFAULT_LANE_CONFIG = {
  search: { concurrency: 2 },
  fetch: { concurrency: 4 },
  parse: { concurrency: 4 },
  llm: { concurrency: 2 }
};

const LANE_NAMES = ['search', 'fetch', 'parse', 'llm'];

class Lane {
  constructor({ name, concurrency }) {
    this._name = name;
    this._concurrency = Math.max(1, concurrency);
    this._active = 0;
    this._queue = [];
    this._completed = 0;
    this._failed = 0;
    this._budgetRejected = 0;
    this._paused = false;
    this._pauseWaiters = [];
  }

  run(taskFn) {
    return new Promise((resolve, reject) => {
      const wrapped = async () => {
        if (this._paused) {
          await new Promise((unpause) => { this._pauseWaiters.push(unpause); });
        }
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

      if (this._active < this._concurrency && !this._paused) {
        wrapped();
      } else {
        this._queue.push(wrapped);
      }
    });
  }

  pause() { this._paused = true; }

  resume() {
    this._paused = false;
    for (const waiter of this._pauseWaiters) waiter();
    this._pauseWaiters = [];
    this._drain();
  }

  setConcurrency(value) {
    this._concurrency = Math.max(1, Math.floor(value) || 1);
    this._drain();
  }

  recordBudgetRejection() { this._budgetRejected += 1; }

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
      failed: this._failed,
      budget_rejected: this._budgetRejected,
      paused: this._paused
    };
  }

  _drain() {
    while (this._queue.length > 0 && this._active < this._concurrency && !this._paused) {
      const next = this._queue.shift();
      next();
    }
  }
}

export class LaneManager {
  constructor(config = {}) {
    this._lanes = {};
    for (const name of LANE_NAMES) {
      const laneConfig = config[name] || DEFAULT_LANE_CONFIG[name];
      this._lanes[name] = new Lane({
        name,
        concurrency: laneConfig.concurrency
      });
    }
  }

  dispatch(laneName, taskFn) {
    const lane = this._lanes[laneName];
    if (!lane) return Promise.reject(new Error(`Unknown lane: ${laneName}`));
    return lane.run(taskFn);
  }

  async dispatchWithBudget(laneName, taskFn, { budgetEnforcer, budgetCheck }) {
    const lane = this._lanes[laneName];
    if (!lane) throw new Error(`Unknown lane: ${laneName}`);

    if (budgetEnforcer && budgetCheck && typeof budgetEnforcer[budgetCheck] === 'function') {
      if (!budgetEnforcer[budgetCheck]()) {
        lane.recordBudgetRejection();
        return null;
      }
    }

    return lane.run(taskFn);
  }

  pause(laneName) {
    const lane = this._lanes[laneName];
    if (lane) lane.pause();
  }

  resume(laneName) {
    const lane = this._lanes[laneName];
    if (lane) lane.resume();
  }

  setConcurrency(laneName, value) {
    const lane = this._lanes[laneName];
    if (lane) lane.setConcurrency(value);
  }

  async drain() {
    await Promise.all(LANE_NAMES.map((name) => this._lanes[name].drain()));
  }

  snapshot() {
    const out = {};
    for (const name of LANE_NAMES) {
      out[name] = this._lanes[name].stats();
    }
    return out;
  }
}
