import {
  CrawleeFetcher,
  DryRunFetcher,
  HttpFetcher,
  PlaywrightFetcher
} from './playwrightFetcher.js';
import { selectFetcherMode } from './fetcherMode.js';

function normalizeMode(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'dryrun') return 'dryrun';
  if (token === 'http') return 'http';
  if (token === 'crawlee') return 'crawlee';
  return 'playwright';
}

function isNoResultError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('no_result') ||
    message.includes('crawlee fetch failed: no_result') ||
    message.includes('request queue operation timed out')
  );
}

function fallbackModesFor(mode = '') {
  const token = normalizeMode(mode);
  if (token === 'crawlee') {
    return ['playwright', 'http'];
  }
  if (token === 'playwright') {
    return ['http'];
  }
  return [];
}

function defaultFetcherFactories() {
  return {
    dryrun: (config, logger) => new DryRunFetcher(config, logger),
    http: (config, logger) => new HttpFetcher(config, logger),
    crawlee: (config, logger) => new CrawleeFetcher(config, logger),
    playwright: (config, logger) => new PlaywrightFetcher(config, logger)
  };
}

function withFetcherTelemetry(pageData = {}, fallbackKind = '') {
  const kind = String(
    pageData?.fetchTelemetry?.fetcher_kind ||
    fallbackKind
  ).trim().toLowerCase() || 'playwright';
  return {
    ...(pageData || {}),
    fetchTelemetry: {
      ...(pageData?.fetchTelemetry || {}),
      fetcher_kind: kind
    }
  };
}

export class DynamicCrawlerService {
  constructor(config = {}, logger = null, options = {}) {
    this.config = config;
    this.logger = logger;
    this.fetcherFactories = options.fetcherFactories || defaultFetcherFactories();
    this.mode = normalizeMode(options.mode || selectFetcherMode(config));
    this.fetcher = null;
    this.started = false;
    this.startFallbackReason = '';
  }

  getMode() {
    return this.mode;
  }

  getStartFallbackReason() {
    return this.startFallbackReason;
  }

  createFetcher(mode) {
    const token = normalizeMode(mode);
    const factory = this.fetcherFactories[token];
    if (typeof factory !== 'function') {
      throw new Error(`fetcher_factory_missing:${token}`);
    }
    return {
      mode: token,
      instance: factory(this.config, this.logger)
    };
  }

  async switchMode(nextMode, { reason = '', allowSame = false } = {}) {
    const token = normalizeMode(nextMode);
    if (!allowSame && this.fetcher && this.mode === token) {
      return;
    }
    const previousMode = this.mode;
    const previousFetcher = this.fetcher;
    const next = this.createFetcher(token);
    await next.instance.start();
    this.fetcher = next.instance;
    this.mode = token;
    if (previousFetcher && previousFetcher !== this.fetcher) {
      try {
        await previousFetcher.stop();
      } catch {
        // best effort cleanup
      }
    }
    if (previousMode !== token) {
      this.logger?.warn?.('dynamic_fetcher_mode_switched', {
        from_mode: previousMode,
        to_mode: token,
        reason: String(reason || '').trim() || 'manual'
      });
    }
  }

  async start() {
    const preferredMode = normalizeMode(this.mode);
    try {
      await this.switchMode(preferredMode, {
        reason: 'service_start',
        allowSame: true
      });
      this.started = true;
      return;
    } catch (error) {
      this.startFallbackReason = String(error?.message || 'fetcher_start_failed');
      if (preferredMode === 'dryrun' || preferredMode === 'http') {
        throw error;
      }
      this.logger?.warn?.('fetcher_start_failed', {
        fetcher_mode: preferredMode,
        message: this.startFallbackReason
      });
      await this.switchMode('http', {
        reason: 'start_failed_fallback_http'
      });
      this.started = true;
    }
  }

  async fetch(source = {}) {
    if (!this.started || !this.fetcher) {
      await this.start();
    }

    try {
      const pageData = await this.fetcher.fetch(source);
      return withFetcherTelemetry(pageData, this.mode);
    } catch (error) {
      const modeAtError = this.mode;
      const noResult = isNoResultError(error);
      const fallbackModes = noResult ? fallbackModesFor(modeAtError) : [];

      for (const fallbackMode of fallbackModes) {
        try {
          await this.switchMode(fallbackMode, {
            reason: `fetch_error_${modeAtError}_to_${fallbackMode}`
          });
          this.logger?.warn?.('dynamic_fetcher_runtime_fallback', {
            from_mode: modeAtError,
            to_mode: fallbackMode,
            reason: String(error?.message || 'no_result')
          });
          const pageData = await this.fetcher.fetch(source);
          const withTelemetry = withFetcherTelemetry(pageData, fallbackMode);
          withTelemetry.fetchTelemetry = {
            ...(withTelemetry.fetchTelemetry || {}),
            degraded_from_mode: modeAtError,
            degraded_reason: String(error?.message || 'no_result')
          };
          return withTelemetry;
        } catch (fallbackError) {
          this.logger?.warn?.('dynamic_fetcher_runtime_fallback_failed', {
            from_mode: modeAtError,
            attempted_mode: fallbackMode,
            message: String(fallbackError?.message || 'unknown_error')
          });
        }
      }

      throw error;
    }
  }

  async stop() {
    if (!this.fetcher) {
      return;
    }
    await this.fetcher.stop();
    this.fetcher = null;
    this.started = false;
  }
}
