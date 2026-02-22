export const FETCH_OUTCOME_KEYS = [
  'ok',
  'not_found',
  'blocked',
  'bot_challenge',
  'rate_limited',
  'server_error',
  'network_timeout',
  'fetch_error',
  'bad_content',
  'login_wall'
];

export const FALLBACK_ACTIONS = [
  'none',
  'skip',
  'try_alternate_fetcher',
  'wait_and_retry_same'
];

export const FETCHER_MODES = ['crawlee', 'playwright', 'http'];

const OUTCOME_TO_ACTION = {
  ok: 'none',
  not_found: 'skip',
  blocked: 'try_alternate_fetcher',
  bot_challenge: 'try_alternate_fetcher',
  rate_limited: 'wait_and_retry_same',
  server_error: 'try_alternate_fetcher',
  network_timeout: 'try_alternate_fetcher',
  fetch_error: 'try_alternate_fetcher',
  bad_content: 'skip',
  login_wall: 'skip'
};

const MODE_LADDER = {
  crawlee: ['playwright', 'http'],
  playwright: ['http', 'crawlee'],
  http: ['crawlee', 'playwright']
};

export function classifyFallbackAction(outcome) {
  return OUTCOME_TO_ACTION[outcome] || 'skip';
}

export function resolveFallbackModes({ currentMode, exhaustedModes = [] }) {
  const ladder = MODE_LADDER[currentMode] || FETCHER_MODES.filter((m) => m !== currentMode);
  const exhaustedSet = new Set(exhaustedModes);
  return ladder.filter((m) => !exhaustedSet.has(m));
}

export function buildFallbackDecision({
  outcome,
  currentMode,
  exhaustedModes = [],
  retryCount = 0,
  maxRetries = 1,
  waitMs = 0
}) {
  const action = classifyFallbackAction(outcome);

  if (action === 'none' || action === 'skip') {
    return {
      action,
      nextMode: null,
      shouldWait: false,
      waitMs: 0,
      exhausted: false,
      reason: action === 'none' ? 'success' : `skip_${outcome}`
    };
  }

  if (retryCount >= maxRetries) {
    return {
      action,
      nextMode: null,
      shouldWait: false,
      waitMs: 0,
      exhausted: true,
      reason: `max_retries_reached (${retryCount}/${maxRetries})`
    };
  }

  if (action === 'wait_and_retry_same') {
    return {
      action,
      nextMode: currentMode,
      shouldWait: true,
      waitMs: Math.max(0, waitMs),
      exhausted: false,
      reason: `wait_and_retry_${outcome}`
    };
  }

  const available = resolveFallbackModes({ currentMode, exhaustedModes });
  if (available.length === 0) {
    return {
      action,
      nextMode: null,
      shouldWait: false,
      waitMs: 0,
      exhausted: true,
      reason: `all_modes_exhausted for ${outcome}`
    };
  }

  return {
    action,
    nextMode: available[0],
    shouldWait: false,
    waitMs: 0,
    exhausted: false,
    reason: `fallback_${currentMode}_to_${available[0]}`
  };
}
