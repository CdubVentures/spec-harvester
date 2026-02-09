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

export class SourcePlanner {
  constructor(job, config, categoryConfig) {
    this.job = job;
    this.config = config;
    this.categoryConfig = categoryConfig;
    this.preferred = job.preferredSources || {};

    this.maxUrls = config.maxUrlsPerProduct;
    this.maxCandidateUrls = config.maxCandidateUrls;
    this.maxPagesPerDomain = config.maxPagesPerDomain;

    this.queue = [];
    this.candidateQueue = [];

    this.visitedUrls = new Set();
    this.approvedVisitedCount = 0;
    this.candidateVisitedCount = 0;
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
    for (const url of urls || []) {
      this.enqueue(url, 'discovery', { forceCandidate: true });
    }
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
        rootDomain: extractRootDomain(host),
        tier,
        tierName,
        role,
        approvedDomain: true,
        discoveredFrom,
        candidateSource: false
      });

      this.queue.sort((a, b) => a.tier - b.tier || a.url.localeCompare(b.url));
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
      rootDomain: extractRootDomain(host),
      tier: 99,
      tierName: 'candidate',
      role: 'other',
      approvedDomain: false,
      discoveredFrom,
      candidateSource: true
    });

    this.candidateQueue.sort((a, b) => a.url.localeCompare(b.url));
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

    const matches = html.matchAll(/href\s*=\s*["']([^"']+)["']/gi);
    for (const match of matches) {
      const href = match[1];
      try {
        const absolute = new URL(href, baseUrl).toString();
        this.enqueue(absolute, baseUrl);
      } catch {
        // ignore invalid href
      }
    }
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
