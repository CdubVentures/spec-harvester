const DEFAULT_DELAY_MS = 300;

export class HostPacer {
  constructor({ delayMs = DEFAULT_DELAY_MS, nowFn = Date.now, sleepFn } = {}) {
    this._delayMs = Math.max(0, Number(delayMs) || 0);
    this._nowFn = typeof nowFn === 'function' ? nowFn : Date.now;
    this._sleepFn = typeof sleepFn === 'function'
      ? sleepFn
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this._lastFetchByHost = new Map();
  }

  canProceed(host) {
    if (this._delayMs === 0) return true;
    const last = this._lastFetchByHost.get(host);
    if (last === undefined) return true;
    return (this._nowFn() - last) >= this._delayMs;
  }

  recordFetch(host) {
    this._lastFetchByHost.set(host, this._nowFn());
  }

  remainingMs(host) {
    if (this._delayMs === 0) return 0;
    const last = this._lastFetchByHost.get(host);
    if (last === undefined) return 0;
    const elapsed = this._nowFn() - last;
    return Math.max(0, this._delayMs - elapsed);
  }

  async waitForSlot(host) {
    const remaining = this.remainingMs(host);
    if (remaining > 0) {
      await this._sleepFn(remaining);
    }
  }

  stats() {
    const hosts = {};
    for (const [host, ts] of this._lastFetchByHost) {
      hosts[host] = ts;
    }
    return {
      hostCount: this._lastFetchByHost.size,
      hosts
    };
  }
}
