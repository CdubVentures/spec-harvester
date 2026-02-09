import { extractRootDomain } from '../utils/common.js';

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

function getTierAndRole(host, preferred) {
  const manufacturerHosts = new Set((preferred?.manufacturerHosts || []).map(normalizeHost));
  const reviewHosts = new Set((preferred?.reviewHosts || []).map(normalizeHost));
  const retailerHosts = new Set((preferred?.retailerHosts || []).map(normalizeHost));

  if (hostInSet(host, manufacturerHosts)) {
    return { tier: 1, role: 'manufacturer' };
  }
  if (hostInSet(host, reviewHosts)) {
    return { tier: 2, role: 'review' };
  }
  if (hostInSet(host, retailerHosts)) {
    return { tier: 3, role: 'retailer' };
  }
  return { tier: 2, role: 'other' };
}

export class SourcePlanner {
  constructor(job, config) {
    this.job = job;
    this.config = config;
    this.preferred = job.preferredSources || {};
    this.maxUrls = config.maxUrlsPerProduct;
    this.maxPagesPerDomain = config.maxPagesPerDomain;
    this.visitedUrls = new Set();
    this.hostCounts = new Map();
    this.queue = [];

    this.allowlistHosts = new Set();
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
    if (!hostInSet(host, this.allowlistHosts)) {
      return;
    }

    const domainCount = this.hostCounts.get(host) || 0;
    if (domainCount >= this.maxPagesPerDomain) {
      return;
    }

    const { tier, role } = getTierAndRole(host, this.preferred);

    this.queue.push({
      url: parsed.toString(),
      host,
      rootDomain: extractRootDomain(host),
      tier,
      role,
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
      role: s.role,
      anchor_check_status: s.anchorStatus,
      identity: s.identity
    }))
  };
}
