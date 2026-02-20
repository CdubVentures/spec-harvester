/**
 * Budget Enforcer (IP05-5E).
 *
 * Per-product budget enforcement:
 *   - max URLs fetched
 *   - max search queries
 *   - max time elapsed
 *   - max LLM calls (total + high-tier)
 *   - max cost USD
 *
 * Exposes metrics: products/hour, cost/product, urls/product, high-tier utilization.
 */

export const DEFAULT_BUDGETS = {
  max_urls_per_product: 50,
  max_queries_per_product: 15,
  max_time_per_product_ms: 300_000,
  max_llm_calls_per_product: 40,
  max_high_tier_calls_per_product: 5,
  max_cost_per_product_usd: 0.50
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class BudgetEnforcer {
  constructor(budgets = {}) {
    this._budgets = { ...DEFAULT_BUDGETS };
    for (const [key, value] of Object.entries(budgets)) {
      if (key in this._budgets && Number.isFinite(Number(value))) {
        this._budgets[key] = Number(value);
      }
    }
    this._urls = 0;
    this._queries = 0;
    this._llmCalls = 0;
    this._highTierCalls = 0;
    this._costUsd = 0;
    this._startedAt = Date.now();
  }

  recordUrl() { this._urls += 1; }
  recordQuery() { this._queries += 1; }

  recordLlmCall({ highTier = false } = {}) {
    this._llmCalls += 1;
    if (highTier) this._highTierCalls += 1;
  }

  recordCost(usd) {
    this._costUsd += num(usd);
  }

  canFetchUrl() {
    return this._urls < this._budgets.max_urls_per_product;
  }

  canQuery() {
    return this._queries < this._budgets.max_queries_per_product;
  }

  canCallLlm() {
    return this._llmCalls < this._budgets.max_llm_calls_per_product;
  }

  canCallHighTier() {
    return this._highTierCalls < this._budgets.max_high_tier_calls_per_product;
  }

  isOverBudget() {
    return this._costUsd > this._budgets.max_cost_per_product_usd;
  }

  isTimeExceeded() {
    return (Date.now() - this._startedAt) > this._budgets.max_time_per_product_ms;
  }

  highTierUtilization() {
    if (this._llmCalls === 0) return 0;
    return Number(((this._highTierCalls / this._llmCalls) * 100).toFixed(2));
  }

  violations() {
    const v = [];
    if (this._urls > this._budgets.max_urls_per_product) {
      v.push({ budget: 'max_urls_per_product', limit: this._budgets.max_urls_per_product, actual: this._urls });
    }
    if (this._queries > this._budgets.max_queries_per_product) {
      v.push({ budget: 'max_queries_per_product', limit: this._budgets.max_queries_per_product, actual: this._queries });
    }
    if (this._llmCalls > this._budgets.max_llm_calls_per_product) {
      v.push({ budget: 'max_llm_calls_per_product', limit: this._budgets.max_llm_calls_per_product, actual: this._llmCalls });
    }
    if (this._highTierCalls > this._budgets.max_high_tier_calls_per_product) {
      v.push({ budget: 'max_high_tier_calls_per_product', limit: this._budgets.max_high_tier_calls_per_product, actual: this._highTierCalls });
    }
    if (this._costUsd > this._budgets.max_cost_per_product_usd) {
      v.push({ budget: 'max_cost_per_product_usd', limit: this._budgets.max_cost_per_product_usd, actual: this._costUsd });
    }
    const elapsed = Date.now() - this._startedAt;
    if (elapsed > this._budgets.max_time_per_product_ms) {
      v.push({ budget: 'max_time_per_product_ms', limit: this._budgets.max_time_per_product_ms, actual: elapsed });
    }
    return v;
  }

  reset() {
    this._urls = 0;
    this._queries = 0;
    this._llmCalls = 0;
    this._highTierCalls = 0;
    this._costUsd = 0;
    this._startedAt = Date.now();
  }

  snapshot() {
    return {
      urls: this._urls,
      queries: this._queries,
      llm_calls: this._llmCalls,
      high_tier_calls: this._highTierCalls,
      cost_usd: this._costUsd,
      elapsed_ms: Date.now() - this._startedAt,
      high_tier_utilization_pct: this.highTierUtilization(),
      budgets: { ...this._budgets }
    };
  }
}
