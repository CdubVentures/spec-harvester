import { planUberQueries } from './queryPlanner.js';
import { rerankSerpResults } from './serpReranker.js';
import { resolveDeepeningTier } from './frontierScheduler.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function knownFieldCount(spec = {}, fieldOrder = []) {
  let count = 0;
  for (const field of fieldOrder || []) {
    const token = String(spec?.[field] || '').trim().toLowerCase();
    if (token && token !== 'unk' && token !== 'n/a' && token !== 'null') {
      count += 1;
    }
  }
  return count;
}

export class UberAggressiveOrchestrator {
  constructor({
    config,
    logger,
    frontier
  } = {}) {
    this.config = config || {};
    this.logger = logger || null;
    this.frontier = frontier || null;
  }

  isEnabled(mode = '') {
    const token = String(mode || '').trim().toLowerCase();
    return token === 'uber_aggressive';
  }

  async buildSearchPlan({
    llmContext = {},
    identity = {},
    missingFields = [],
    baseQueries = [],
    previousSummary = {},
    round = 0
  } = {}) {
    const tier = resolveDeepeningTier({
      round,
      mode: 'uber_aggressive',
      previousSummary
    });
    const frontierSummary = this.frontier?.snapshotForProduct?.(identity?.productId || '') || {};
    const planned = await planUberQueries({
      config: this.config,
      logger: this.logger,
      llmContext,
      identity,
      missingFields,
      baseQueries,
      frontierSummary,
      cap: Math.max(4, Number(this.config.discoveryMaxQueries || 8) * 2)
    });
    return {
      tier,
      ...planned
    };
  }

  async rerankSerp({
    llmContext = {},
    identity = {},
    missingFields = [],
    serpResults = [],
    topK = 20
  } = {}) {
    return rerankSerpResults({
      config: this.config,
      logger: this.logger,
      llmContext,
      identity,
      missingFields,
      serpResults,
      frontier: this.frontier,
      topK
    });
  }

  buildCoverageDelta({
    previousSpec = {},
    currentSpec = {},
    fieldOrder = []
  } = {}) {
    const previousKnown = knownFieldCount(previousSpec, fieldOrder);
    const currentKnown = knownFieldCount(currentSpec, fieldOrder);
    const gained = [];
    const lost = [];
    for (const field of fieldOrder || []) {
      const prev = String(previousSpec?.[field] || '').trim().toLowerCase();
      const next = String(currentSpec?.[field] || '').trim().toLowerCase();
      const prevKnown = prev && prev !== 'unk' && prev !== 'n/a' && prev !== 'null';
      const nextKnown = next && next !== 'unk' && next !== 'n/a' && next !== 'null';
      if (!prevKnown && nextKnown) {
        gained.push(field);
      } else if (prevKnown && !nextKnown) {
        lost.push(field);
      }
    }
    return {
      previous_known_count: previousKnown,
      current_known_count: currentKnown,
      delta_known: currentKnown - previousKnown,
      gained_fields: toArray(gained),
      lost_fields: toArray(lost)
    };
  }
}
