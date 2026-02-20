/**
 * Runtime metrics jsonl writer.
 *
 * Appends timestamped JSON lines to a configurable storage key for
 * cross-run telemetry: LLM call timings, fetch outcomes, pipeline
 * stage durations, error rates.
 *
 * Each line is a self-contained JSON object with:
 *   { ts, metric, type, value, labels }
 */

function sanitizeMetricName(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

export class MetricsWriter {
  constructor({
    storage,
    metricsKey = '_runtime/metrics.jsonl',
    defaultLabels = {}
  } = {}) {
    this.storage = storage;
    this.metricsKey = String(metricsKey || '_runtime/metrics.jsonl').trim();
    this.defaultLabels = defaultLabels && typeof defaultLabels === 'object' ? defaultLabels : {};
    this._buffer = [];
    this._flushSize = 20;
  }

  _makeRow({ metric, type, value, labels = {} }) {
    return {
      ts: new Date().toISOString(),
      metric: sanitizeMetricName(metric),
      type: type || 'gauge',
      value: Number.isFinite(value) ? value : 0,
      labels: {
        ...this.defaultLabels,
        ...(labels && typeof labels === 'object' ? labels : {})
      }
    };
  }

  async _appendRow(row) {
    this._buffer.push(row);
    if (this._buffer.length >= this._flushSize) {
      await this.flush();
    }
  }

  async counter(metric, value = 1, labels = {}) {
    await this._appendRow(this._makeRow({ metric, type: 'counter', value, labels }));
  }

  async gauge(metric, value, labels = {}) {
    await this._appendRow(this._makeRow({ metric, type: 'gauge', value, labels }));
  }

  async timing(metric, durationMs, labels = {}) {
    await this._appendRow(this._makeRow({ metric, type: 'timing', value: durationMs, labels }));
  }

  async flush() {
    if (this._buffer.length === 0) return;
    const lines = this._buffer.map((row) => JSON.stringify(row)).join('\n') + '\n';
    this._buffer = [];
    if (this.storage && typeof this.storage.appendText === 'function') {
      await this.storage.appendText(this.metricsKey, lines, {
        contentType: 'application/x-ndjson'
      });
    }
  }

  snapshot() {
    return {
      metrics_key: this.metricsKey,
      buffered: this._buffer.length,
      default_labels: { ...this.defaultLabels }
    };
  }
}
