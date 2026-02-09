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

function countQueueHost(queue, host) {
  let count = 0;
  for (const row of queue || []) {
    if (row.host === host) {
      count += 1;
    }
  }
  return count;
}

function urlPath(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function isSitemapLikePath(pathname) {
  const token = String(pathname || '').toLowerCase();
  return token.includes('sitemap') || token.endsWith('.xml');
}

function stripLocalePrefix(pathname) {
  const raw = String(pathname || '').toLowerCase();
  const match = raw.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\/(.+)$/);
  if (!match) {
    return {
      pathname: raw,
      hadLocalePrefix: false
    };
  }
  return {
    pathname: `/${match[2]}`,
    hadLocalePrefix: true
  };
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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
    this.manufacturerDeepResearchEnabled = config.manufacturerDeepResearchEnabled !== false;
    this.maxManufacturerUrls = Math.max(
      1,
      Math.min(this.maxUrls, Number(config.maxManufacturerUrlsPerProduct || this.maxUrls))
    );
    this.maxManufacturerPagesPerDomain = Math.max(
      this.maxPagesPerDomain,
      Number(config.maxManufacturerPagesPerDomain || this.maxPagesPerDomain)
    );
    this.manufacturerReserveUrls = this.manufacturerDeepResearchEnabled
      ? Math.max(0, Math.min(this.maxUrls, Number(config.manufacturerReserveUrls || 0)))
      : 0;

    this.manufacturerQueue = [];
    this.queue = [];
    this.candidateQueue = [];

    this.visitedUrls = new Set();
    this.approvedVisitedCount = 0;
    this.manufacturerVisitedCount = 0;
    this.nonManufacturerVisitedCount = 0;
    this.candidateVisitedCount = 0;
    this.filledFields = new Set();
    this.hostCounts = new Map();
    this.manufacturerHostCounts = new Map();
    this.candidateHostCounts = new Map();
    this.robotsSitemapsDiscovered = 0;
    this.sitemapUrlsDiscovered = 0;

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
    this.seedManufacturerDeepUrls();
  }

  seedManufacturerDeepUrls() {
    if (!this.manufacturerDeepResearchEnabled) {
      return;
    }

    const queryText = [
      this.job.identityLock?.brand || '',
      this.job.identityLock?.model || '',
      this.job.identityLock?.variant || ''
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!queryText) {
      return;
    }

    const encodedQuery = encodeURIComponent(queryText);
    const modelSlug = slug(this.job.identityLock?.model || this.job.productId || '');

    const manufacturerHosts = new Set();
    for (const sourceHost of this.categoryConfig.sourceHosts || []) {
      if (sourceHost.tierName === 'manufacturer') {
        manufacturerHosts.add(normalizeHost(sourceHost.host));
      }
    }
    for (const host of this.preferred.manufacturerHosts || []) {
      manufacturerHosts.add(normalizeHost(host));
    }
    for (const seedUrl of this.job.seedUrls || []) {
      const host = getHost(seedUrl);
      if (host && resolveTierNameForHost(host, this.categoryConfig) === 'manufacturer') {
        manufacturerHosts.add(host);
      }
    }

    for (const host of manufacturerHosts) {
      if (!host) {
        continue;
      }

      const seeds = [
        `https://${host}/search?q=${encodedQuery}`,
        `https://${host}/support/search?query=${encodedQuery}`,
        `https://${host}/support/${modelSlug}`,
        `https://${host}/downloads/${modelSlug}`,
        `https://${host}/manual/${modelSlug}`,
        `https://${host}/specs/${modelSlug}`,
        `https://${host}/robots.txt`,
        `https://${host}/sitemap.xml`,
        `https://${host}/sitemap_index.xml`,
        `https://${host}/sitemaps.xml`
      ];

      for (const url of seeds) {
        this.enqueue(url, 'manufacturer_deep_seed', { forceApproved: true });
      }
    }
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

    if (this.manufacturerQueue.find((item) => item.url === normalizedUrl)) {
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
    const tier = resolveTierForHost(host, this.categoryConfig);
    const tierName = resolveTierNameForHost(host, this.categoryConfig);
    const role = inferRoleForHost(host, this.categoryConfig);
    const totalApprovedPlanned =
      this.manufacturerQueue.length +
      this.queue.length +
      this.manufacturerVisitedCount +
      this.nonManufacturerVisitedCount;
    const isManufacturerSource = role === 'manufacturer';

    if (approvedDomain) {
      if (totalApprovedPlanned >= this.maxUrls) {
        return;
      }

      if (isManufacturerSource) {
        const plannedCount =
          countQueueHost(this.manufacturerQueue, host) + (this.manufacturerHostCounts.get(host) || 0);
        if (plannedCount >= this.maxManufacturerPagesPerDomain) {
          return;
        }
        const manufacturerPlanned = this.manufacturerQueue.length + this.manufacturerVisitedCount;
        if (manufacturerPlanned >= this.maxManufacturerUrls) {
          return;
        }
      } else {
        const plannedCount = countQueueHost(this.queue, host) + (this.hostCounts.get(host) || 0);
        if (plannedCount >= this.maxPagesPerDomain) {
          return;
        }
        if (this.manufacturerReserveUrls > 0) {
          const reservedRemaining = Math.max(
            0,
            this.manufacturerReserveUrls -
              (this.manufacturerQueue.length + this.manufacturerVisitedCount)
          );
          const maxNonManufacturerPlan = this.maxUrls - reservedRemaining;
          const currentNonManufacturerPlan =
            this.queue.length + this.nonManufacturerVisitedCount;
          if (currentNonManufacturerPlan >= maxNonManufacturerPlan) {
            return;
          }
        }
      }

      const row = {
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
      };

      if (isManufacturerSource) {
        this.manufacturerQueue.push(row);
        this.sortManufacturerQueue();
      } else {
        this.queue.push(row);
      }
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
    return (
      this.manufacturerQueue.length > 0 ||
      this.queue.length > 0 ||
      this.candidateQueue.length > 0
    );
  }

  next() {
    const source =
      this.manufacturerQueue.length > 0
        ? this.manufacturerQueue.shift()
        : this.queue.length > 0
          ? this.queue.shift()
          : this.candidateQueue.shift();
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
      if (source.role === 'manufacturer') {
        this.manufacturerVisitedCount += 1;
        this.manufacturerHostCounts.set(
          source.host,
          (this.manufacturerHostCounts.get(source.host) || 0) + 1
        );
      } else {
        this.nonManufacturerVisitedCount += 1;
        this.hostCounts.set(source.host, (this.hostCounts.get(source.host) || 0) + 1);
      }
    }
    return source;
  }

  discoverFromHtml(baseUrl, html) {
    if (!html) {
      return;
    }

    const baseHost = getHost(baseUrl);
    const manufacturerContext =
      baseHost && resolveTierNameForHost(baseHost, this.categoryConfig) === 'manufacturer';
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
        if (!this.isRelevantDiscoveredUrl(parsed, { manufacturerContext })) {
          continue;
        }
        this.enqueue(parsed.toString(), baseUrl);
      } catch {
        // ignore invalid href
      }
    }
  }

  discoverFromRobots(baseUrl, body) {
    if (!body) {
      return 0;
    }

    const matches = String(body).matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim);
    let discovered = 0;
    for (const match of matches) {
      const raw = decodeXmlEntities(match[1] || '');
      if (!raw) {
        continue;
      }
      try {
        const sitemapUrl = new URL(raw, baseUrl).toString();
        const before =
          this.queue.length + this.manufacturerQueue.length + this.candidateQueue.length;
        this.enqueue(sitemapUrl, `robots:${baseUrl}`, { forceApproved: true });
        const after =
          this.queue.length + this.manufacturerQueue.length + this.candidateQueue.length;
        if (after > before) {
          discovered += 1;
        }
      } catch {
        // ignore invalid sitemap URL
      }
    }

    this.robotsSitemapsDiscovered += discovered;
    return discovered;
  }

  discoverFromSitemap(baseUrl, body) {
    if (!body) {
      return 0;
    }

    const baseHost = getHost(baseUrl);
    const manufacturerContext =
      baseHost && resolveTierNameForHost(baseHost, this.categoryConfig) === 'manufacturer';
    if (!manufacturerContext) {
      return 0;
    }

    const locRegex = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
    const seen = new Set();
    let discovered = 0;
    let scanned = 0;
    for (const match of String(body).matchAll(locRegex)) {
      if (scanned >= 3000) {
        break;
      }
      scanned += 1;

      const decoded = decodeXmlEntities(match[1] || '').trim();
      if (!decoded || seen.has(decoded)) {
        continue;
      }
      seen.add(decoded);

      let parsed;
      try {
        parsed = new URL(decoded, baseUrl);
      } catch {
        continue;
      }

      const host = normalizeHost(parsed.hostname);
      if (!host) {
        continue;
      }

      if (baseHost && host !== baseHost && !host.endsWith(`.${baseHost}`) && !baseHost.endsWith(`.${host}`)) {
        if (!isApprovedHost(host, this.categoryConfig)) {
          continue;
        }
      }

      if (!isSitemapLikePath(parsed.pathname)) {
        if (!this.isRelevantDiscoveredUrl(parsed, { manufacturerContext, sitemapContext: true })) {
          continue;
        }
      }

      const before = this.queue.length + this.manufacturerQueue.length + this.candidateQueue.length;
      this.enqueue(parsed.toString(), `sitemap:${baseUrl}`, { forceApproved: true });
      const after = this.queue.length + this.manufacturerQueue.length + this.candidateQueue.length;
      if (after > before) {
        discovered += 1;
      }
    }

    this.sitemapUrlsDiscovered += discovered;
    return discovered;
  }

  isRelevantDiscoveredUrl(parsed, context = {}) {
    const localizedPath = stripLocalePrefix(parsed.pathname || '');
    const hasLocalePrefix = localizedPath.hadLocalePrefix;
    const effectivePath = localizedPath.pathname;
    const pathAndQuery = `${effectivePath || ''} ${parsed.search || ''}`.toLowerCase();
    const pathname = effectivePath.toLowerCase();
    if (/\.(css|js|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|map|json)$/i.test(pathname)) {
      return false;
    }

    if (hasLocalePrefix && !context.manufacturerContext && !context.sitemapContext) {
      return false;
    }

    if (!pathAndQuery || pathAndQuery === '/') {
      return false;
    }

    const negativeKeywords = [
      '/cart',
      '/checkout',
      '/account',
      '/community',
      '/blog',
      '/newsroom',
      '/store-locator',
      '/gift-card',
      '/forum',
      '/forums'
    ];
    if (negativeKeywords.some((keyword) => pathAndQuery.includes(keyword))) {
      return false;
    }

    if (isSitemapLikePath(pathname)) {
      return true;
    }

    const hasModelToken = this.modelTokens.some((token) => pathAndQuery.includes(token));
    if (hasModelToken) {
      return true;
    }

    const highSignalKeywords = [
      'manual',
      'support',
      'spec',
      'product',
      'products',
      'gaming-mice',
      'mice',
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

    if (context.manufacturerContext) {
      const manufacturerSignals = [
        'support',
        'manual',
        'spec',
        'product',
        'products',
        'datasheet',
        'technical',
        'download'
      ];
      return (
        manufacturerSignals.some((token) => pathAndQuery.includes(token)) &&
        (
          hasModelToken ||
          this.brandTokens.some((token) => pathAndQuery.includes(token)) ||
          this.modelTokens.length === 0
        )
      );
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
    for (const row of this.manufacturerQueue) {
      row.priorityScore = this.domainPriority(row.rootDomain);
    }
    for (const row of this.candidateQueue) {
      row.priorityScore = this.domainPriority(row.rootDomain);
    }
    this.sortManufacturerQueue();
    this.sortApprovedQueue();
    this.sortCandidateQueue();
  }

  sortManufacturerQueue() {
    this.manufacturerQueue.sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        urlPath(a.url).localeCompare(urlPath(b.url)) ||
        a.url.localeCompare(b.url)
    );
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

  getStats() {
    return {
      manufacturer_queue_count: this.manufacturerQueue.length,
      non_manufacturer_queue_count: this.queue.length,
      candidate_queue_count: this.candidateQueue.length,
      manufacturer_visited_count: this.manufacturerVisitedCount,
      non_manufacturer_visited_count: this.nonManufacturerVisitedCount,
      candidate_visited_count: this.candidateVisitedCount,
      robots_sitemaps_discovered: this.robotsSitemapsDiscovered,
      sitemap_urls_discovered: this.sitemapUrlsDiscovered,
      max_manufacturer_urls: this.maxManufacturerUrls,
      max_urls: this.maxUrls,
      manufacturer_reserve_urls: this.manufacturerReserveUrls
    };
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
