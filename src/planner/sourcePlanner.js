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
    this.maxPagesPerDomain = config.maxPagesPerDomain;
    this.visitedUrls = new Set();
    this.hostCounts = new Map();
    this.queue = [];

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
      this.enqueue(url, 'seed');
    }
  }

  hostAllowed(host) {
    if (!host) {
      return false;
    }
    if (isDeniedHost(host, this.categoryConfig)) {
      return false;
    }
    return hostInSet(host, this.allowlistHosts);
  }

  enqueue(url, discoveredFrom = 'unknown') {
    if (!url || this.visitedUrls.has(url) || this.queue.find((s) => s.url === url)) {
      return;
    }

    if (this.queue.length + this.visitedUrls.size >= this.maxUrls) {
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

    const host = normalizeHost(parsed.hostname);
    if (!this.hostAllowed(host)) {
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
      url: parsed.toString(),
      host,
      rootDomain: extractRootDomain(host),
      tier,
      tierName,
      role,
      approvedDomain: isApprovedHost(host, this.categoryConfig),
      discoveredFrom
    });

    this.queue.sort((a, b) => a.tier - b.tier || a.url.localeCompare(b.url));
  }

  hasNext() {
    return this.queue.length > 0;
  }

  next() {
    const source = this.queue.shift();
    if (!source) {
      return null;
    }
    this.visitedUrls.add(source.url);
    this.hostCounts.set(source.host, (this.hostCounts.get(source.host) || 0) + 1);
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
    urls: sources.map((s) => s.url),
    used: sources.map((s) => ({
      url: s.url,
      host: s.host,
      tier: s.tier,
      tier_name: s.tierName,
      role: s.role,
      approved_domain: Boolean(s.approvedDomain),
      anchor_check_status: s.anchorStatus,
      identity: s.identity
    }))
  };
}
