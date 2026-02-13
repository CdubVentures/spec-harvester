function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class CortexCircuitBreaker {
  constructor({
    failureThreshold = 3,
    openMs = 30_000,
    now = () => Date.now()
  } = {}) {
    this.failureThreshold = Math.max(1, toInt(failureThreshold, 3));
    this.openMs = Math.max(1_000, toInt(openMs, 30_000));
    this.now = now;
    this.state = 'closed';
    this.failureCount = 0;
    this.openUntilMs = 0;
    this.lastFailure = '';
  }

  canRequest() {
    const nowMs = this.now();
    if (this.state === 'open') {
      if (nowMs >= this.openUntilMs) {
        this.state = 'half_open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.state = 'closed';
    this.failureCount = 0;
    this.openUntilMs = 0;
    this.lastFailure = '';
  }

  recordFailure(error = null) {
    this.failureCount += 1;
    this.lastFailure = String(error?.message || error || '');
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      this.openUntilMs = this.now() + this.openMs;
    } else if (this.state === 'half_open') {
      this.state = 'open';
      this.openUntilMs = this.now() + this.openMs;
    }
  }

  snapshot() {
    return {
      state: this.state,
      failure_count: this.failureCount,
      failure_threshold: this.failureThreshold,
      open_until_ms: this.openUntilMs || 0,
      remaining_open_ms: this.state === 'open'
        ? Math.max(0, this.openUntilMs - this.now())
        : 0,
      last_failure: this.lastFailure || null
    };
  }
}
