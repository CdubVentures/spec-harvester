import { extractRootDomain } from '../utils/common.js';
import { toRawFieldKey } from '../utils/fieldKeys.js';
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

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getHost(url) {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
}

function canonicalizeQueueUrl(parsedUrl) {
  const normalized = new URL(parsedUrl.toString());
  // Fragments are client-side only and should not create distinct fetch jobs.
  normalized.hash = '';
  return normalized.toString();
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

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

const BRAND_HOST_HINTS = {
  logitech: ['logitech', 'logitechg', 'logi'],
  razer: ['razer'],
  steelseries: ['steelseries'],
  zowie: ['zowie', 'benq'],
  benq: ['benq', 'zowie'],
  finalmouse: ['finalmouse'],
  lamzu: ['lamzu'],
  pulsar: ['pulsar'],
  corsair: ['corsair'],
  glorious: ['glorious'],
  endgame: ['endgamegear', 'endgame-gear']
};

const BRAND_DOMAIN_OVERRIDES = {
  alienware: ['alienware.com', 'dell.com'],
  logitech: ['logitechg.com', 'logitech.com'],
  steelseries: ['steelseries.com'],
  razer: ['razer.com']
};

function manufacturerHostHintsForBrand(brand) {
  const hints = new Set(tokenize(brand));
  const brandSlug = slug(brand);
  for (const [key, aliases] of Object.entries(BRAND_HOST_HINTS)) {
    if (brandSlug.includes(key) || hints.has(key)) {
      for (const alias of aliases) {
        hints.add(alias);
      }
    }
  }
  return [...hints];
}

function manufacturerSeedHostsForBrand(brand = '', hints = []) {
  const seeds = new Set();
  const brandSlug = slug(brand);
  for (const [token, domains] of Object.entries(BRAND_DOMAIN_OVERRIDES)) {
    if (brandSlug.includes(token)) {
      for (const domain of domains || []) {
        const normalized = normalizeHost(domain);
        if (normalized) {
          seeds.add(normalized);
        }
      }
    }
  }

  for (const hint of hints || []) {
    const token = String(hint || '').trim().toLowerCase();
    if (!token || token.length < 3 || !/^[a-z0-9-]+$/.test(token)) {
      continue;
    }
    if (['logi', 'mice', 'mouse', 'gaming', 'wireless', 'wired'].includes(token)) {
      continue;
    }
    seeds.add(`${token}.com`);
  }

  return [...seeds];
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

function normalizeSourcePath(url) {
  try {
    const parsed = new URL(url);
    const rawPath = String(parsed.pathname || '/')
      .toLowerCase()
      .replace(/\/+/g, '/');
    if (!rawPath || rawPath === '/') {
      return '/';
    }
    return rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  } catch {
    return '/';
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

function countTokenHits(text, tokens) {
  const haystack = String(text || '').toLowerCase();
  let hits = 0;
  for (const token of tokens || []) {
    const norm = String(token || '').toLowerCase().trim();
    if (!norm) {
      continue;
    }
    if (haystack.includes(norm)) {
      hits += 1;
    }
  }
  return hits;
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
      .map((field) => toRawFieldKey(field, { fieldOrder: categoryConfig.fieldOrder || [] }))
      .filter(Boolean);
    this.sourceIntelDomains = options.sourceIntel?.domains || {};
    this.brandKey = slug(job.identityLock?.brand || '');
    this.brandHostHints = manufacturerHostHintsForBrand(job.identityLock?.brand || '');

    this.maxUrls = config.maxUrlsPerProduct;
    this.maxCandidateUrls = config.maxCandidateUrls;
    this.maxPagesPerDomain = config.maxPagesPerDomain;
    this.manufacturerDeepResearchEnabled = config.manufacturerDeepResearchEnabled !== false;
    this.manufacturerSeedSearchUrls = Boolean(config.manufacturerSeedSearchUrls);
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
    this.blockedHosts = new Set();
    this.blockedHostReasons = {};
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
    this.sourceHostMap =
      categoryConfig.sourceHostMap instanceof Map
        ? categoryConfig.sourceHostMap
        : new Map((categoryConfig.sourceHosts || []).map((row) => [normalizeHost(row.host), row]));
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

    this.brandManufacturerHostSet = this.selectManufacturerHostsForBrand();

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
      'pro',
      'plus',
      'max'
    ]);
    this.modelTokens = [...new Set([
      ...tokenize(job.identityLock?.model),
      ...tokenize(job.identityLock?.variant),
      ...tokenize(job.productId)
    ])].filter((token) => !this.brandTokens.includes(token) && !genericModelTokens.has(token));

    this.seed(job.seedUrls || []);
    this.seedManufacturerDeepUrls();
  }

  manufacturerHostsFromConfig() {
    const hosts = new Set();
    for (const sourceHost of this.categoryConfig.sourceHosts || []) {
      if (sourceHost.tierName === 'manufacturer') {
        hosts.add(normalizeHost(sourceHost.host));
      }
    }
    for (const host of this.preferred.manufacturerHosts || []) {
      hosts.add(normalizeHost(host));
    }
    return hosts;
  }

  manufacturerHostScore(host) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) {
      return 0;
    }

    let score = 0;
    for (const hint of this.brandHostHints || []) {
      if (!hint) {
        continue;
      }
      if (normalizedHost.includes(hint)) {
        score += 1.2;
      }
    }

    const rootDomain = extractRootDomain(normalizedHost);
    const domainIntel = this.sourceIntelDomains[rootDomain];
    const brandIntel =
      this.brandKey && domainIntel?.per_brand?.[this.brandKey]
        ? domainIntel.per_brand[this.brandKey]
        : null;
    if (brandIntel) {
      score += Math.max(0, Number.parseFloat(String(brandIntel.identity_match_rate || 0)) * 1.5);
      score += Math.max(0, Number.parseFloat(String(brandIntel.fields_accepted_count || 0)) / 30);
    }
    return score;
  }

  selectManufacturerHostsForBrand() {
    const candidates = [...this.manufacturerHostsFromConfig()].filter(Boolean);
    if (!candidates.length) {
      return new Set();
    }
    if (!this.brandHostHints.length) {
      return new Set(candidates);
    }

    const strictMatches = candidates.filter((host) =>
      this.brandHostHints.some((hint) => hint && host.includes(hint))
    );
    if (strictMatches.length > 0) {
      return new Set(strictMatches);
    }

    const scored = candidates
      .map((host) => ({ host, score: this.manufacturerHostScore(host) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.host.localeCompare(b.host));

    if (!scored.length) {
      return new Set();
    }

    const topScore = scored[0].score;
    const selected = scored
      .filter((row) => row.score >= Math.max(0.1, topScore * 0.45))
      .slice(0, 5)
      .map((row) => row.host);
    return new Set(selected);
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

    const fallbackBrandSeeds = manufacturerSeedHostsForBrand(
      this.job.identityLock?.brand || '',
      this.brandHostHints
    );
    const manufacturerHosts = new Set(
      this.brandManufacturerHostSet.size
        ? [...this.brandManufacturerHostSet]
        : (this.brandHostHints.length > 0
          ? fallbackBrandSeeds
          : [...this.manufacturerHostsFromConfig()])
    );
    for (const seedUrl of this.job.seedUrls || []) {
      const host = getHost(seedUrl);
      if (host && resolveTierNameForHost(host, this.categoryConfig) === 'manufacturer') {
        if (!this.brandManufacturerHostSet.size || hostInSet(host, this.brandManufacturerHostSet)) {
          manufacturerHosts.add(host);
        }
      }
    }

    for (const host of manufacturerHosts) {
      if (!host) {
        continue;
      }

      const seeds = [
        `https://${host}/products/${modelSlug}`,
        `https://${host}/product/${modelSlug}`,
        `https://${host}/gaming-mice/${modelSlug}`,
        `https://${host}/support/${modelSlug}`,
        `https://${host}/downloads/${modelSlug}`,
        `https://${host}/manual/${modelSlug}`,
        `https://${host}/specs/${modelSlug}`,
        `https://${host}/robots.txt`,
        `https://${host}/sitemap.xml`,
        `https://${host}/sitemap_index.xml`,
        `https://${host}/sitemaps.xml`
      ];
      if (this.manufacturerSeedSearchUrls) {
        seeds.unshift(
          `https://${host}/support/search?query=${encodedQuery}`,
          `https://${host}/shop/search?q=${encodedQuery}`,
          `https://${host}/search?query=${encodedQuery}`,
          `https://${host}/search?q=${encodedQuery}`
        );
      }

      for (const url of seeds) {
        this.enqueue(url, 'manufacturer_deep_seed', { forceApproved: true });
      }
    }
  }

  seed(urls, options = {}) {
    const { forceBrandBypass = false } = options;
    for (const url of urls) {
      const host = getHost(url);
      if (host) {
        this.allowlistHosts.add(host);
      }
      this.enqueue(url, 'seed', { forceApproved: true, forceBrandBypass });
    }
  }

  seedLearning(urls) {
    for (const url of urls || []) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }

      const haystack = `${parsed.hostname || ''} ${parsed.pathname || ''} ${parsed.search || ''}`.toLowerCase();
      const modelHits = countTokenHits(haystack, this.modelTokens);
      const brandHits = countTokenHits(haystack, this.brandTokens);

      const modelThreshold = this.modelTokens.length >= 3 ? 2 : 1;
      const modelMatch = this.modelTokens.length > 0 && modelHits >= modelThreshold;
      const brandMatch = this.brandTokens.length > 0 && brandHits >= 1;

      if (this.modelTokens.length > 0) {
        // When model tokens exist, avoid broad cross-brand URLs.
        if (!modelMatch || (this.brandTokens.length > 0 && !brandMatch)) {
          continue;
        }
      } else if (!brandMatch) {
        continue;
      }
      this.enqueue(url, 'learning_seed', { forceApproved: true, forceBrandBypass: false });
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
    const { forceApproved = false, forceCandidate = false, forceBrandBypass = false } = options;

    if (!url) {
      return false;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const normalizedUrl = canonicalizeQueueUrl(parsed);
    if (this.visitedUrls.has(normalizedUrl)) {
      return false;
    }

    if (this.queue.find((item) => item.url === normalizedUrl)) {
      return false;
    }

    if (this.manufacturerQueue.find((item) => item.url === normalizedUrl)) {
      return false;
    }

    if (this.candidateQueue.find((item) => item.url === normalizedUrl)) {
      return false;
    }

    const host = normalizeHost(parsed.hostname);
    if (!host || isDeniedHost(host, this.categoryConfig)) {
      return false;
    }
    if (hostInSet(host, this.blockedHosts)) {
      return false;
    }

    const approvedDomain = this.shouldUseApprovedQueue(host, forceApproved, forceCandidate);
    const rootDomain = extractRootDomain(host);
    const hostMeta = this.sourceHostMap.get(host) || null;
    const tier = Number.isFinite(Number(hostMeta?.tier))
      ? Number(hostMeta.tier)
      : resolveTierForHost(host, this.categoryConfig);
    const tierName = String(hostMeta?.tierName || resolveTierNameForHost(host, this.categoryConfig));
    const role = String(hostMeta?.role || inferRoleForHost(host, this.categoryConfig));
    const manufacturerBrandRestricted =
      role === 'manufacturer' &&
      this.brandManufacturerHostSet.size > 0 &&
      !hostInSet(host, this.brandManufacturerHostSet);
    if (manufacturerBrandRestricted && !forceBrandBypass) {
      return false;
    }
    const totalApprovedPlanned =
      this.manufacturerQueue.length +
      this.queue.length +
      this.manufacturerVisitedCount +
      this.nonManufacturerVisitedCount;
    const isManufacturerSource = role === 'manufacturer';

    if (approvedDomain) {
      if (totalApprovedPlanned >= this.maxUrls) {
        return false;
      }

      if (isManufacturerSource) {
        const plannedCount =
          countQueueHost(this.manufacturerQueue, host) + (this.manufacturerHostCounts.get(host) || 0);
        if (plannedCount >= this.maxManufacturerPagesPerDomain) {
          return false;
        }
        const manufacturerPlanned = this.manufacturerQueue.length + this.manufacturerVisitedCount;
        if (manufacturerPlanned >= this.maxManufacturerUrls) {
          return false;
        }
      } else {
        const plannedCount = countQueueHost(this.queue, host) + (this.hostCounts.get(host) || 0);
        if (plannedCount >= this.maxPagesPerDomain) {
          return false;
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
            return false;
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
        priorityScore: 0,
        approvedDomain: true,
        discoveredFrom,
        candidateSource: false,
        sourceId: String(hostMeta?.sourceId || ''),
        displayName: String(hostMeta?.displayName || ''),
        crawlConfig: isObject(hostMeta?.crawlConfig) ? hostMeta.crawlConfig : null,
        fieldCoverage: isObject(hostMeta?.fieldCoverage) ? hostMeta.fieldCoverage : null,
        robotsTxtCompliant: hostMeta?.robotsTxtCompliant === null || hostMeta?.robotsTxtCompliant === undefined
          ? null
          : Boolean(hostMeta.robotsTxtCompliant)
      };
      row.priorityScore = this.sourcePriority(row);

      if (isManufacturerSource) {
        this.manufacturerQueue.push(row);
        this.sortManufacturerQueue();
      } else {
        this.queue.push(row);
      }
      this.sortApprovedQueue();
      return true;
    }

    if (!this.fetchCandidateSources) {
      return false;
    }

    if (this.candidateQueue.length + this.candidateVisitedCount >= this.maxCandidateUrls) {
      return false;
    }

    const domainCount = this.candidateHostCounts.get(host) || 0;
    if (domainCount >= this.maxPagesPerDomain) {
      return false;
    }

    this.candidateQueue.push({
      url: normalizedUrl,
      host,
      rootDomain,
      tier: 4,
      tierName: 'candidate',
      role: 'other',
      priorityScore: this.sourcePriority({
        url: normalizedUrl,
        host,
        rootDomain,
        tier: 4,
        tierName: 'candidate',
        role: 'other',
        approvedDomain: false,
        discoveredFrom,
        candidateSource: true
      }),
      approvedDomain: false,
      discoveredFrom,
      candidateSource: true
    });

    this.sortCandidateQueue();
    return true;
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
    const modelTokenHits = countTokenHits(pathAndQuery, this.modelTokens);
    const minModelHits = this.modelTokens.length >= 3 ? 2 : 1;
    const hasModelToken = this.modelTokens.length > 0 && modelTokenHits >= minModelHits;
    const hasBrandToken = this.brandTokens.some((token) => pathAndQuery.includes(token));

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
      '/forums',
      '/shop/c/',
      '/category/',
      '/collections/'
    ];
    if (negativeKeywords.some((keyword) => pathAndQuery.includes(keyword)) && !hasModelToken) {
      return false;
    }

    if (isSitemapLikePath(pathname)) {
      return true;
    }
    if (hasModelToken) {
      return true;
    }

    const highSignalKeywords = [
      'manual',
      'support',
      'spec',
      'product',
      'products',
      'datasheet',
      'technical',
      'download',
      'pdf'
    ];
    if (highSignalKeywords.some((keyword) => pathAndQuery.includes(keyword))) {
      if (hasModelToken) {
        return true;
      }
      if (this.config.manufacturerBroadDiscovery && context.manufacturerContext) {
        if (/\/products?\//.test(pathname) && !/\/shop\/c\//.test(pathname)) {
          return true;
        }
      }
      if (this.modelTokens.length === 0) {
        return hasBrandToken;
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
      const hasManufacturerSignal = manufacturerSignals.some((token) => pathAndQuery.includes(token));
      if (!hasManufacturerSignal) {
        return false;
      }

      if (hasModelToken) {
        return true;
      }

      if (this.modelTokens.length === 0) {
        if (hasBrandToken) {
          return true;
        }
        if (this.config.manufacturerBroadDiscovery) {
          return (
            pathAndQuery.includes('support') ||
            pathAndQuery.includes('manual') ||
            pathAndQuery.includes('spec') ||
            pathAndQuery.includes('download')
          );
        }
      }

      if (this.config.manufacturerBroadDiscovery) {
        return (
          /\/products?\//.test(pathname) &&
          !/\/shop\/c\//.test(pathname)
        );
      }
      return false;
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
      row.priorityScore = this.sourcePriority(row);
    }
    for (const row of this.manufacturerQueue) {
      row.priorityScore = this.sourcePriority(row);
    }
    for (const row of this.candidateQueue) {
      row.priorityScore = this.sourcePriority(row);
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

  blockHost(host, reason = 'blocked') {
    const normalized = normalizeHost(host);
    if (!normalized) {
      return 0;
    }

    this.blockedHosts.add(normalized);
    this.blockedHostReasons[normalized] = reason;

    let removed = 0;
    const filterFn = (row) => {
      const shouldKeep = !hostInSet(row.host, this.blockedHosts);
      if (!shouldKeep) {
        removed += 1;
      }
      return shouldKeep;
    };

    this.manufacturerQueue = this.manufacturerQueue.filter(filterFn);
    this.queue = this.queue.filter(filterFn);
    this.candidateQueue = this.candidateQueue.filter(filterFn);
    return removed;
  }

  getIntelBundle(rootDomain) {
    const intel = this.sourceIntelDomains[rootDomain];
    if (!intel) {
      return {
        domainIntel: null,
        activeIntel: null
      };
    }

    const brandIntel =
      this.brandKey && intel.per_brand && intel.per_brand[this.brandKey]
        ? intel.per_brand[this.brandKey]
        : null;

    return {
      domainIntel: intel,
      activeIntel: brandIntel || intel
    };
  }

  scoreRequiredFieldBoost(activeIntel, domainIntel, missingRequiredFields) {
    const helpfulness =
      activeIntel?.per_field_helpfulness || domainIntel?.per_field_helpfulness || {};
    const requiredBoost = missingRequiredFields.reduce((acc, field) => {
      const count = Number.parseFloat(helpfulness[field] || 0);
      if (!Number.isFinite(count) || count <= 0) {
        return acc;
      }
      return acc + Math.min(0.01, count / 500);
    }, 0);
    return Math.min(0.2, requiredBoost);
  }

  readRewardScoreFromMethodMap(map, field) {
    const prefix = `${field}::`;
    let best = null;
    for (const [key, row] of Object.entries(map || {})) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const score = Number.parseFloat(String(row?.reward_score ?? row?.score ?? 0));
      if (!Number.isFinite(score)) {
        continue;
      }
      if (best === null || score > best) {
        best = score;
      }
    }
    return best;
  }

  scoreFieldRewardBoost(row, domainIntel, activeIntel, missingRequiredFields) {
    if (!missingRequiredFields.length || !domainIntel) {
      return 0;
    }

    const pathKey = normalizeSourcePath(row?.url || '');
    const pathIntel = domainIntel.per_path?.[pathKey] || null;
    const domainFieldReward = activeIntel?.per_field_reward || domainIntel?.per_field_reward || {};
    const domainMethodReward = activeIntel?.field_method_reward || domainIntel?.field_method_reward || {};
    const pathFieldReward = pathIntel?.per_field_reward || {};
    const pathMethodReward = pathIntel?.field_method_reward || {};

    let total = 0;
    let fieldCount = 0;
    for (const field of missingRequiredFields) {
      const pathFieldScore = Number.parseFloat(String(pathFieldReward?.[field]?.score ?? ''));
      const domainFieldScore = Number.parseFloat(String(domainFieldReward?.[field]?.score ?? ''));
      const pathMethodScore = this.readRewardScoreFromMethodMap(pathMethodReward, field);
      const domainMethodScore = this.readRewardScoreFromMethodMap(domainMethodReward, field);

      const pathBest = [pathFieldScore, pathMethodScore]
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0];
      const domainBest = [domainFieldScore, domainMethodScore]
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0];

      if (!Number.isFinite(pathBest) && !Number.isFinite(domainBest)) {
        continue;
      }

      const weighted = (
        (Number.isFinite(pathBest) ? pathBest * 0.7 : 0) +
        (Number.isFinite(domainBest) ? domainBest * 0.3 : 0)
      );
      total += Math.max(-0.25, Math.min(0.35, weighted));
      fieldCount += 1;
    }

    if (!fieldCount) {
      return 0;
    }
    const avg = total / fieldCount;
    return Number.parseFloat((Math.max(-0.2, Math.min(0.2, avg * 0.35))).toFixed(6));
  }

  sourcePathHeuristicBoost(row) {
    const rawUrl = String(row?.url || '');
    if (!rawUrl) {
      return 0;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return 0;
    }

    const path = String(parsed.pathname || '/').toLowerCase();
    const query = String(parsed.search || '').toLowerCase();
    const role = String(row?.role || '').toLowerCase();
    let score = 0;

    // De-prioritize generic index/search surfaces that frequently return weak signals.
    if (
      path === '/' ||
      /\/search\/?$/.test(path) ||
      query.includes('q=') ||
      query.includes('query=')
    ) {
      score -= 0.35;
    }
    if (/\/shop\/search/.test(path)) {
      score -= 0.45;
    }

    // Crawl robots/sitemaps eventually, but never before likely product/spec pages.
    if (
      path.endsWith('/robots.txt') ||
      isSitemapLikePath(path)
    ) {
      score -= 0.4;
    }

    if (role === 'manufacturer') {
      if (/\/products?\//.test(path)) {
        score += 0.28;
      }
      if (/\/gaming-mice\//.test(path)) {
        score += 0.18;
      }
      if (/\/support\//.test(path)) {
        score += 0.08;
      }
      if (/\/manual|\/spec|\/download/.test(path)) {
        score += 0.05;
      }
      if (path.endsWith('.pdf')) {
        score += 0.12;
      }
    } else if (role === 'review' || role === 'database') {
      if (/\/review|\/product|\/products?\//.test(path)) {
        score += 0.1;
      }
      if (path.endsWith('.pdf')) {
        score += 0.08;
      }
    }

    return Number.parseFloat(Math.max(-0.6, Math.min(0.6, score)).toFixed(6));
  }

  sourcePriority(row) {
    const rootDomain = row?.rootDomain;
    const pathHeuristicBoost = this.sourcePathHeuristicBoost(row);
    if (!rootDomain) {
      return pathHeuristicBoost;
    }

    const { domainIntel, activeIntel } = this.getIntelBundle(rootDomain);
    if (!domainIntel || !activeIntel) {
      return pathHeuristicBoost;
    }

    const baseScore = Number.isFinite(activeIntel.planner_score)
      ? activeIntel.planner_score
      : Number.isFinite(domainIntel.planner_score)
        ? domainIntel.planner_score
      : 0;
    const missingRequiredFields = this.requiredFields.filter((field) => !this.filledFields.has(field));
    const requiredBoost = this.scoreRequiredFieldBoost(activeIntel, domainIntel, missingRequiredFields);
    const rewardBoost = this.scoreFieldRewardBoost(row, domainIntel, activeIntel, missingRequiredFields);

    return Number.parseFloat((baseScore + requiredBoost + rewardBoost + pathHeuristicBoost).toFixed(6));
  }

  domainPriority(rootDomain) {
    return this.sourcePriority({
      rootDomain,
      url: `https://${rootDomain}/`
    });
  }

  getStats() {
    return {
      manufacturer_queue_count: this.manufacturerQueue.length,
      non_manufacturer_queue_count: this.queue.length,
      candidate_queue_count: this.candidateQueue.length,
      manufacturer_visited_count: this.manufacturerVisitedCount,
      non_manufacturer_visited_count: this.nonManufacturerVisitedCount,
      candidate_visited_count: this.candidateVisitedCount,
      blocked_host_count: this.blockedHosts.size,
      blocked_hosts: [...this.blockedHosts].slice(0, 50),
      brand_manufacturer_hosts: [...this.brandManufacturerHostSet].slice(0, 20),
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
      source_id: source.sourceId || '',
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
