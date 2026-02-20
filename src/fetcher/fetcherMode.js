export function selectFetcherMode(config = {}) {
  const dryRun = Boolean(config.dryRun);
  if (dryRun) {
    return 'dryrun';
  }

  const preferHttpFetcher = Boolean(config.preferHttpFetcher);
  if (preferHttpFetcher) {
    return 'http';
  }

  if (Boolean(config.dynamicCrawleeEnabled)) {
    return 'crawlee';
  }

  return 'playwright';
}
