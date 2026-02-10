function round(value, digits = 8) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createBudgetGuard({
  config = {},
  monthlySpentUsd = 0,
  productSpentUsd = 0,
  productCallsTotal = 0
}) {
  const state = {
    monthlySpentUsd: toNumber(monthlySpentUsd, 0),
    productSpentUsd: toNumber(productSpentUsd, 0),
    productCallsTotal: toInt(productCallsTotal, 0),
    roundCalls: 0,
    blockedReason: ''
  };

  const limits = {
    monthlyBudgetUsd: toNumber(config.llmMonthlyBudgetUsd, 0),
    productBudgetUsd: toNumber(config.llmPerProductBudgetUsd, 0),
    maxCallsPerProductTotal: toInt(config.llmMaxCallsPerProductTotal, 0),
    maxCallsPerRound: toInt(config.llmMaxCallsPerRound, 0)
  };

  function canCall(options = {}) {
    const essential = Boolean(options.essential);
    const reason = String(options.reason || 'extract');

    if (limits.maxCallsPerRound > 0 && state.roundCalls >= limits.maxCallsPerRound) {
      return {
        allowed: false,
        reason: 'budget_max_calls_per_round_reached',
        essential_allowed: false
      };
    }

    if (limits.maxCallsPerProductTotal > 0 && state.productCallsTotal >= limits.maxCallsPerProductTotal) {
      return {
        allowed: false,
        reason: 'budget_max_calls_per_product_reached',
        essential_allowed: false
      };
    }

    if (limits.productBudgetUsd > 0 && state.productSpentUsd >= limits.productBudgetUsd) {
      return {
        allowed: false,
        reason: 'budget_per_product_exhausted',
        essential_allowed: false
      };
    }

    if (limits.monthlyBudgetUsd > 0 && state.monthlySpentUsd >= limits.monthlyBudgetUsd) {
      if (!essential) {
        return {
          allowed: false,
          reason: 'budget_monthly_exhausted_nonessential_disabled',
          essential_allowed: true
        };
      }
      return {
        allowed: true,
        reason: `${reason}_monthly_budget_exceeded_essential_only`,
        essential_allowed: true
      };
    }

    return {
      allowed: true,
      reason: 'ok',
      essential_allowed: true
    };
  }

  function recordCall({ costUsd = 0 }) {
    const safeCost = toNumber(costUsd, 0);
    state.roundCalls += 1;
    state.productCallsTotal += 1;
    state.productSpentUsd = round(state.productSpentUsd + safeCost, 8);
    state.monthlySpentUsd = round(state.monthlySpentUsd + safeCost, 8);
  }

  function startRound() {
    state.roundCalls = 0;
    state.blockedReason = '';
  }

  function block(reason) {
    state.blockedReason = String(reason || '');
  }

  function snapshot() {
    return {
      limits: { ...limits },
      state: {
        monthlySpentUsd: round(state.monthlySpentUsd, 8),
        productSpentUsd: round(state.productSpentUsd, 8),
        productCallsTotal: state.productCallsTotal,
        roundCalls: state.roundCalls,
        blockedReason: state.blockedReason
      }
    };
  }

  return {
    canCall,
    recordCall,
    startRound,
    block,
    snapshot
  };
}
