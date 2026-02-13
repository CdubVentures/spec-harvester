function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function stripComment(line) {
  const raw = String(line || '');
  const index = raw.indexOf('#');
  if (index < 0) {
    return raw.trim();
  }
  return raw.slice(0, index).trim();
}

function parseDirective(line) {
  const clean = stripComment(line);
  if (!clean) {
    return null;
  }
  const index = clean.indexOf(':');
  if (index <= 0) {
    return null;
  }
  const key = normalizeToken(clean.slice(0, index));
  const value = clean.slice(index + 1).trim();
  if (!key) {
    return null;
  }
  return { key, value };
}

function normalizeRulePath(value) {
  const token = String(value || '').trim();
  if (!token) {
    return '';
  }
  if (token.startsWith('/')) {
    return token;
  }
  return `/${token}`;
}

function escapeRegex(value) {
  return String(value || '').replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function matchesRule(pathAndQuery, rulePath) {
  const value = normalizeRulePath(rulePath);
  if (!value) {
    return false;
  }
  if (value.includes('*') || value.includes('$')) {
    const anchoredEnd = value.endsWith('$');
    const core = anchoredEnd ? value.slice(0, -1) : value;
    const pattern = escapeRegex(core).replace(/\\\*/g, '.*');
    const regex = new RegExp(`^${pattern}${anchoredEnd ? '$' : ''}`);
    return regex.test(pathAndQuery);
  }
  return pathAndQuery.startsWith(value);
}

function parseRobotsTxt(text) {
  const lines = String(text || '').split(/\r?\n/);
  const groups = [];
  let currentAgents = [];
  let currentRules = [];

  function flushGroup() {
    if (!currentAgents.length) {
      currentRules = [];
      return;
    }
    groups.push({
      userAgents: [...new Set(currentAgents)],
      rules: [...currentRules]
    });
    currentAgents = [];
    currentRules = [];
  }

  for (const line of lines) {
    const directive = parseDirective(line);
    if (!directive) {
      continue;
    }

    if (directive.key === 'user-agent') {
      if (currentRules.length > 0) {
        flushGroup();
      }
      const userAgent = normalizeToken(directive.value);
      if (userAgent) {
        currentAgents.push(userAgent);
      }
      continue;
    }

    if (directive.key !== 'allow' && directive.key !== 'disallow') {
      continue;
    }

    if (!currentAgents.length) {
      currentAgents.push('*');
    }

    const path = normalizeRulePath(directive.value);
    if (!path) {
      continue;
    }

    currentRules.push({
      type: directive.key,
      path
    });
  }

  flushGroup();
  return groups;
}

function matchingAgentLength(userAgent, ruleAgent) {
  if (!ruleAgent) {
    return -1;
  }
  if (ruleAgent === '*') {
    return 1;
  }
  if (userAgent.includes(ruleAgent)) {
    return ruleAgent.length;
  }
  return -1;
}

function collectRulesForAgent(parsedGroups, userAgent) {
  const token = normalizeToken(userAgent || '*');
  let bestLength = -1;
  let selected = [];

  for (const group of parsedGroups || []) {
    let groupBest = -1;
    for (const agent of group.userAgents || []) {
      const length = matchingAgentLength(token, normalizeToken(agent));
      if (length > groupBest) {
        groupBest = length;
      }
    }
    if (groupBest < 0) {
      continue;
    }
    if (groupBest > bestLength) {
      bestLength = groupBest;
      selected = [...(group.rules || [])];
    } else if (groupBest === bestLength) {
      selected.push(...(group.rules || []));
    }
  }

  return selected;
}

function evaluateRules({ pathAndQuery, rules = [] }) {
  let winner = null;
  for (const rule of rules) {
    if (!matchesRule(pathAndQuery, rule.path)) {
      continue;
    }
    const length = normalizeRulePath(rule.path).length;
    if (!winner || length > winner.length || (length === winner.length && rule.type === 'allow')) {
      winner = { type: rule.type, path: rule.path, length };
    }
  }
  if (!winner) {
    return {
      allowed: true,
      matched_rule: null
    };
  }
  return {
    allowed: winner.type !== 'disallow',
    matched_rule: winner
  };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 6000)));
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildRobotsUrl(targetUrl) {
  const parsed = new URL(targetUrl);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

function toPathAndQuery(targetUrl) {
  const parsed = new URL(targetUrl);
  return `${parsed.pathname || '/'}${parsed.search || ''}`;
}

export class RobotsPolicyCache {
  constructor({
    fetchImpl = fetch,
    timeoutMs = 6000,
    logger = null
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.cache = new Map();
  }

  async loadPolicyForUrl(targetUrl) {
    const robotsUrl = buildRobotsUrl(targetUrl);
    const cacheKey = robotsUrl;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const loader = (async () => {
      try {
        const response = await fetchWithTimeout(this.fetchImpl, robotsUrl, this.timeoutMs);
        const status = Number(response?.status || 0);
        if (status < 200 || status >= 400) {
          return {
            robotsUrl,
            available: false,
            status,
            groups: []
          };
        }
        const body = await response.text();
        return {
          robotsUrl,
          available: true,
          status,
          groups: parseRobotsTxt(body)
        };
      } catch (error) {
        this.logger?.warn?.('robots_policy_fetch_failed', {
          url: robotsUrl,
          message: error.message
        });
        return {
          robotsUrl,
          available: false,
          status: 0,
          error: error.message,
          groups: []
        };
      }
    })();

    this.cache.set(cacheKey, loader);
    return loader;
  }

  async canFetch({
    url,
    userAgent = '*'
  }) {
    const parsed = new URL(url);
    if (parsed.pathname.toLowerCase().endsWith('/robots.txt')) {
      return {
        allowed: true,
        reason: 'robots_file',
        robots_url: buildRobotsUrl(url),
        matched_rule: null
      };
    }

    const policy = await this.loadPolicyForUrl(url);
    if (!policy.available) {
      return {
        allowed: true,
        reason: 'robots_missing_or_unavailable',
        robots_url: policy.robotsUrl,
        matched_rule: null,
        status: policy.status || 0
      };
    }

    const rules = collectRulesForAgent(policy.groups, userAgent);
    const evaluated = evaluateRules({
      pathAndQuery: toPathAndQuery(url),
      rules
    });

    return {
      allowed: evaluated.allowed,
      reason: evaluated.allowed ? 'allowed' : 'blocked_by_robots',
      robots_url: policy.robotsUrl,
      matched_rule: evaluated.matched_rule,
      status: policy.status || 200
    };
  }
}

export const __private = {
  parseRobotsTxt,
  collectRulesForAgent,
  evaluateRules
};
