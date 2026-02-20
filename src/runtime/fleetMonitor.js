/**
 * Fleet Monitor (Phase 14).
 *
 * Aggregate metrics across all running product harvests.
 * Tracks throughput, cost, field counts, URL/LLM call volumes,
 * and per-product status for the runtime ops cockpit.
 */

export class FleetMonitor {
  constructor() {
    this._products = new Map();
    this._startedAt = Date.now();
    this._urlsFetched = 0;
    this._llmCalls = 0;
    this._highTierCalls = 0;
  }

  registerProduct({ productId, category } = {}) {
    this._products.set(String(productId), {
      productId: String(productId),
      category: String(category || ''),
      status: 'active',
      registeredAt: Date.now(),
      completedAt: null,
      fieldsExtracted: 0,
      costUsd: 0,
      runtimeMs: 0,
      error: null
    });
  }

  completeProduct({ productId, fieldsExtracted = 0, costUsd = 0, runtimeMs = 0 } = {}) {
    const p = this._products.get(String(productId));
    if (!p) return;
    p.status = 'completed';
    p.completedAt = Date.now();
    p.fieldsExtracted = Number(fieldsExtracted) || 0;
    p.costUsd = Number(costUsd) || 0;
    p.runtimeMs = Number(runtimeMs) || 0;
  }

  failProduct({ productId, error = '' } = {}) {
    const p = this._products.get(String(productId));
    if (!p) return;
    p.status = 'failed';
    p.completedAt = Date.now();
    p.error = String(error || 'unknown');
  }

  recordUrlFetched() {
    this._urlsFetched += 1;
  }

  recordLlmCall({ highTier = false } = {}) {
    this._llmCalls += 1;
    if (highTier) this._highTierCalls += 1;
  }

  getProduct(productId) {
    return this._products.get(String(productId)) || null;
  }

  listProducts() {
    return [...this._products.values()];
  }

  stats() {
    let active = 0;
    let completed = 0;
    let failed = 0;
    let totalCost = 0;
    let totalFields = 0;
    let totalRuntime = 0;

    for (const p of this._products.values()) {
      if (p.status === 'active') active += 1;
      else if (p.status === 'completed') {
        completed += 1;
        totalCost += p.costUsd;
        totalFields += p.fieldsExtracted;
        totalRuntime += p.runtimeMs;
      } else if (p.status === 'failed') {
        failed += 1;
      }
    }

    const elapsedHours = Math.max(0.001, (Date.now() - this._startedAt) / 3_600_000);
    const throughput = completed > 0
      ? Number((completed / elapsedHours).toFixed(2))
      : 0;

    return {
      total_products: this._products.size,
      active,
      completed,
      failed,
      total_cost_usd: Number(totalCost.toFixed(6)),
      mean_cost_per_product: completed > 0
        ? Number((totalCost / completed).toFixed(6))
        : 0,
      mean_fields_per_product: completed > 0
        ? Number((totalFields / completed).toFixed(2))
        : 0,
      mean_runtime_ms: completed > 0
        ? Math.round(totalRuntime / completed)
        : 0,
      throughput_per_hour: throughput,
      elapsed_hours: Number(elapsedHours.toFixed(3)),
      total_urls_fetched: this._urlsFetched,
      total_llm_calls: this._llmCalls,
      total_high_tier_calls: this._highTierCalls,
      high_tier_utilization_pct: this._llmCalls > 0
        ? Number(((this._highTierCalls / this._llmCalls) * 100).toFixed(2))
        : 0
    };
  }

  snapshot() {
    return {
      generated_at: new Date().toISOString(),
      stats: this.stats(),
      products: this.listProducts()
    };
  }
}
