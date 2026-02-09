import { extractRootDomain } from '../utils/common.js';
import {
  inferRoleForHost,
  isApprovedHost,
  isDeniedHost,
  resolveTierForHost,
  resolveTierNameForHost
} from '../categories/loader.js';

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/^www\./, '');
}

function getHost(url) {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
}

function hostInSet(host, hostSet) {
  if (hostSet.has(host)) {
    return true;
  }
  for (const candidate of hostSet) {
    if (host.endsWith(`.${candidate}`)) {
      return true;
    }
  }
  return false;
}

function normalizeRequiredFieldName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('fields.')) {
    return raw.slice('fields.'.length);
  }
  if (raw.startsWith('specs.')) {
    return raw.slice('specs.'.length);
  }
  if (raw.startsWith('identity.')) {
    return '';
  }
  return raw.includes('.') ? '' : raw;
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class SourcePlanner {
  constructor(job, config, categoryConfig, options = {}) {
    this.job = job;
    this.config = config;
    this.categoryConfig = categoryConfig;
    this.preferred = job.preferredSources || {};
    this.fetchCandidateSources = Boolean(config.fetchCandidateSources);

    const requiredFieldsRaw = options.requiredFields || [];
    this.requiredFields = requiredFieldsRaw
      .map((field) => normalizeRequiredFieldName(field))
      .filter(Boolean);
    this.sourceIntelDomains = options.sourceIntel?.domains || {};
    this.brandKey = slug(job.identityLock?.brand || '');

    this.maxUrls = config.maxUrlsPerProduct;
    this.maxCandidateUrls = config.maxCandidateUrls;
    this.maxPagesPerDomain = config.maxPagesPerDomain;

    this.queue = [];
    this.candidateQueue = [];

    this.visitedUrls = new Set();
    this.approvedVisitedCount = 0;
    this.candidateVisitedCount = 0;
    this.filledFields = new Set();
    this.hostCounts = new Map();
    this.candidateHostCounts = new Map();

    this.allowlistHosts = new Set();
    for (const sourceHost of categoryConfig.sourceHosts || []) {
      this.allowlistHosts.add(normalizeHost(sourceHost.host));
    }
    for (const arr of [
      this.preferred.manufacturerHosts || [],
      this.preferred.reviewHosts || [],
      this.preferred.retailerHosts || []
    ]) {
      for (const host of arr) {
        this.allowlistHosts.add(normalizeHost(host));
      }
    }

    this.brandTokens = [...new Set(tokenize(job.identityLock?.brand))];
    const genericModelTokens = new Set([
      'gaming',
      'mouse',
      'wireless',
      'wired',
      'edition',
      'black',
      'white',
      'mini',
      'ultra',
      'superlight',
      'pro'
    ]);
    this.modelTokens = [...new Set([
      ...tokenize(job.identityLock?.model),
      ...tokenize(job.identityLock?.variant),
      ...tokenize(job.productId)
    ])].filter((token) => !this.brandTokens.includes(token) && !genericModelTokens.has(token));

    this.seed(job.seedUrls || []);
  }

  seed(urls) {
    for (const url of urls) {
      const host = getHost(url);
      if (host) {
        this.allowlistHosts.add(host);
      }
      this.enqueue(url, 'seed', { forceApproved: true });
    }
  }

  seedCandidates(urls) {
    if (!this.fetchCandidateSources) {
      return;
    }
    for (const url of urls || []) {
      this.enqueueCandidate(url, 'discovery');
    }
  }

  enqueueCandidate(url, discoveredFrom = 'candidate') {
    this.enqueue(url, discoveredFrom, { forceCandidate: true });
  }

  shouldUseApprovedQueue(host, forceApproved = false, forceCandidate = false) {
    if (forceCandidate) {
      return false;
    }
    if (forceApproved) {
      return true;
    }
    if (isApprovedHost(host, this.categoryConfig)) {
      return true;
    }
    return hostInSet(host, this.allowlistHosts);
  }

  enqueue(url, discoveredFrom = 'unknown', options = {}) {
    const { forceApproved = false, forceCandidate = false } = options;

    if (!url) {
      return;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return;
    }

    const normalizedUrl = parsed.toString();
    if (this.visitedUrls.has(normalizedUrl)) {
      return;
    }

    if (this.queue.find((item) => item.url === normalizedUrl)) {
      return;
    }

    if (this.candidateQueue.find((item) => item.url === normalizedUrl)) {
      return;
    }

    const host = normalizeHost(parsed.hostname);
    if (!host || isDeniedHost(host, this.categoryConfig)) {
      return;
    }

    const approvedDomain = this.shouldUseApprovedQueue(host, forceApproved, forceCandidate);
    const rootDomain = extractRootDomain(host);
    const priorityScore = this.domainPriority(rootDomain);

    if (approvedDomain) {
      if (this.queue.length + this.approvedVisitedCount >= this.maxUrls) {
        return;
      }

      const domainCount = this.hostCounts.get(host) || 0;
      if (domainCount >= this.maxPagesPerDomain) {
        return;
      }

      const tier = resolveTierForHost(host, this.categoryConfig);
      const tierName = resolveTierNameForHost(host, this.categoryConfig);
      const role = inferRoleForHost(host, this.categoryConfig);

      this.queue.push({
        url: normalizedUrl,
        host,
        rootDomain,
        tier,
        tierName,
        role,
        priorityScore,
        approvedDomain: true,
        discoveredFrom,
        candidateSource: false
      });

      this.sortApprovedQueue();
      return;
    }

    if (!this.fetchCandidateSources) {
      return;
    }

    if (this.candidateQueue.length + this.candidateVisitedCount >= this.maxCandidateUrls) {
      return;
    }

    const domainCount = this.candidateHostCounts.get(host) || 0;
    if (domainCount >= this.maxPagesPerDomain) {
      return;
    }

    this.candidateQueue.push({
      url: normalizedUrl,
      host,
      rootDomain,
      tier: 4,
      tierName: 'candidate',
      role: 'other',
      priorityScore,
      approvedDomain: false,
      discoveredFrom,
      candidateSource: true
    });

    this.sortCandidateQueue();
  }

  hasNext() {
    return this.queue.length > 0 || this.candidateQueue.length > 0;
  }

  next() {
    const source = this.queue.length > 0 ? this.queue.shift() : this.candidateQueue.shift();
    if (!source) {
      return null;
    }

    this.visitedUrls.add(source.url);
    if (source.candidateSource) {
      this.candidateVisitedCount += 1;
      this.candidateHostCounts.set(
        source.host,
        (this.candidateHostCounts.get(source.host) || 0) + 1
      );
    } else {
      this.approvedVisitedCount += 1;
      this.hostCounts.set(source.host, (this.hostCounts.get(source.host) || 0) + 1);
    }
    return source;
  }

  discoverFromHtml(baseUrl, html) {
    if (!html) {
      return;
    }

    const baseHost = getHost(baseUrl);
    const matches = html.matchAll(/href\s*=\s*["']([^"']+)["']/gi);
    for (const match of matches) {
      const href = match[1];
      try {
        const parsed = new URL(href, baseUrl);
        const host = normalizeHost(parsed.hostname);
        if (!host) {
          continue;
        }
        if (!isApprovedHost(host, this.categoryConfig) && !hostInSet(host, this.allowlistHosts)) {
          continue;
        }
        if (baseHost && host !== baseHost && !host.endsWith(`.${baseHost}`) && !baseHost.endsWith(`.${host}`)) {
          if (!isApprovedHost(host, this.categoryConfig)) {
            continue;
          }
        }
        if (!this.isRelevantDiscoveredUrl(parsed)) {
          continue;
        }
        this.enqueue(parsed.toString(), baseUrl);
      } catch {
        // ignore invalid href
      }
    }
  }

  isRelevantDiscoveredUrl(parsed) {
    const pathAndQuery = `${parsed.pathname || ''} ${parsed.search || ''}`.toLowerCase();
    if (/^\/[a-z]{2}-[a-z]{2}\//.test(parsed.pathname.toLowerCase())) {
      return false;
    }
    if (!pathAndQuery || pathAndQuery === '/') {
      return false;
    }

    const hasModelToken = this.modelTokens.some((token) => pathAndQuery.includes(token));
    if (hasModelToken) {
      return true;
    }

    const highSignalKeywords = [
      'manual',
      'support',
      'spec',
      'datasheet',
      'technical',
      'download',
      'pdf'
    ];
    if (highSignalKeywords.some((keyword) => pathAndQuery.includes(keyword))) {
      if (hasModelToken) {
        return true;
      }
      if (this.modelTokens.length === 0) {
        return this.brandTokens.some((token) => pathAndQuery.includes(token));
      }
    }

    return false;
  }

  markFieldsFilled(fields) {
    let changed = false;
    for (const field of fields || []) {
      if (!field) {
        continue;
      }
      if (!this.filledFields.has(field)) {
        this.filledFields.add(field);
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    for (const row of this.queue) {
      row.priorityScore = this.domainPriority(row.rootDomain);
    }
    for (const row of this.candidateQueue) {
      row.priorityScore = this.domainPriority(row.rootDomain);
    }
    this.sortApprovedQueue();
    this.sortCandidateQueue();
  }

  sortApprovedQueue() {
    this.queue.sort((a, b) => a.tier - b.tier || b.priorityScore - a.priorityScore || a.url.localeCompare(b.url));
  }

  sortCandidateQueue() {
    this.candidateQueue.sort((a, b) => b.priorityScore - a.priorityScore || a.url.localeCompare(b.url));
  }

  domainPriority(rootDomain) {
    const intel = this.sourceIntelDomains[rootDomain];
    if (!intel) {
      return 0;
    }

    const brandIntel =
      this.brandKey && intel.per_brand && intel.per_brand[this.brandKey]
        ? intel.per_brand[this.brandKey]
        : null;

    const activeIntel = brandIntel || intel;
    const baseScore = Number.isFinite(activeIntel.planner_score)
      ? activeIntel.planner_score
      : Number.isFinite(intel.planner_score)
        ? intel.planner_score
        : 0;
    const helpfulness =
      activeIntel.per_field_helpfulness || intel.per_field_helpfulness || {};
    const missingRequiredFields = this.requiredFields.filter((field) => !this.filledFields.has(field));
    const requiredBoost = missingRequiredFields.reduce((acc, field) => {
      const count = Number.parseFloat(helpfulness[field] || 0);
      if (!Number.isFinite(count) || count <= 0) {
        return acc;
      }
      return acc + Math.min(0.01, count / 500);
    }, 0);

    return Number.parseFloat((baseScore + Math.min(0.2, requiredBoost)).toFixed(6));
  }
}

export function buildSourceSummary(sources) {
  return {
    urls: sources.map((source) => source.url),
    used: sources.map((source) => ({
      url: source.url,
      host: source.host,
      tier: source.tier,
      tier_name: source.tierName,
      role: source.role,
      approved_domain: Boolean(source.approvedDomain),
      candidate_source: Boolean(source.candidateSource),
      anchor_check_status: source.anchorStatus,
      identity: source.identity
    }))
  };
}
