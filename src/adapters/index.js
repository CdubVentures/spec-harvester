import { manufacturerAdapter } from './manufacturerAdapter.js';
import { techPowerUpAdapter } from './techPowerUpAdapter.js';
import { rtingsAdapter } from './rtingsAdapter.js';
import { eloShapesAdapter } from './eloShapesAdapter.js';
import { normalizePdfBackend } from '../extract/pdfBackendRouter.js';

const ADAPTERS = [manufacturerAdapter, techPowerUpAdapter, rtingsAdapter, eloShapesAdapter];

function mergeIdentity(into, extra) {
  return {
    ...into,
    ...(extra || {})
  };
}

function emptyPdfStats() {
  return {
    router_enabled: false,
    requested_backend: 'auto',
    backend_selected: '',
    docs_discovered: 0,
    docs_fetched: 0,
    docs_parsed: 0,
    docs_failed: 0,
    backend_selected_counts: {},
    backend_fallback_count: 0,
    pair_count: 0,
    kv_pair_count: 0,
    table_pair_count: 0,
    pages_scanned: 0,
    tables_found: 0,
    scanned_docs_detected: 0,
    scanned_docs_ocr_attempted: 0,
    scanned_docs_ocr_succeeded: 0,
    scanned_ocr_pair_count: 0,
    scanned_ocr_kv_pair_count: 0,
    scanned_ocr_table_pair_count: 0,
    scanned_ocr_low_confidence_pairs: 0,
    scanned_ocr_confidence_sum: 0,
    scanned_ocr_confidence_count: 0,
    scanned_ocr_confidence_avg: 0,
    scanned_ocr_error_count: 0,
    scanned_ocr_backend_selected: '',
    scanned_ocr_backend_selected_counts: {},
    error_count: 0,
    errors: []
  };
}

function mergePdfStats(into = {}, extra = {}) {
  const base = {
    ...emptyPdfStats(),
    ...(into || {})
  };
  const next = extra && typeof extra === 'object' ? extra : {};
  base.router_enabled = Boolean(base.router_enabled || next.router_enabled);
  base.requested_backend = normalizePdfBackend(next.requested_backend || base.requested_backend || 'auto', 'auto');
  const selectedToken = String(next.backend_selected || base.backend_selected || '').trim();
  base.backend_selected = selectedToken ? normalizePdfBackend(selectedToken, 'legacy') : '';
  base.docs_discovered += Number(next.docs_discovered || 0);
  base.docs_fetched += Number(next.docs_fetched || 0);
  base.docs_parsed += Number(next.docs_parsed || 0);
  base.docs_failed += Number(next.docs_failed || 0);
  base.backend_fallback_count += Number(next.backend_fallback_count || 0);
  base.pair_count += Number(next.pair_count || 0);
  base.kv_pair_count += Number(next.kv_pair_count || 0);
  base.table_pair_count += Number(next.table_pair_count || 0);
  base.pages_scanned += Number(next.pages_scanned || 0);
  base.tables_found += Number(next.tables_found || 0);
  base.scanned_docs_detected += Number(next.scanned_docs_detected || 0);
  base.scanned_docs_ocr_attempted += Number(next.scanned_docs_ocr_attempted || 0);
  base.scanned_docs_ocr_succeeded += Number(next.scanned_docs_ocr_succeeded || 0);
  base.scanned_ocr_pair_count += Number(next.scanned_ocr_pair_count || 0);
  base.scanned_ocr_kv_pair_count += Number(next.scanned_ocr_kv_pair_count || 0);
  base.scanned_ocr_table_pair_count += Number(next.scanned_ocr_table_pair_count || 0);
  base.scanned_ocr_low_confidence_pairs += Number(next.scanned_ocr_low_confidence_pairs || 0);
  base.scanned_ocr_confidence_sum += Number(next.scanned_ocr_confidence_sum || 0);
  base.scanned_ocr_confidence_count += Number(next.scanned_ocr_confidence_count || 0);
  base.scanned_ocr_error_count += Number(next.scanned_ocr_error_count || 0);
  base.error_count += Number(next.error_count || 0);
  const mergedBackendCounts = {
    ...(base.backend_selected_counts || {})
  };
  for (const [backend, count] of Object.entries(next.backend_selected_counts || {})) {
    const token = normalizePdfBackend(backend, 'legacy');
    mergedBackendCounts[token] = Number(mergedBackendCounts[token] || 0) + Number(count || 0);
  }
  base.backend_selected_counts = mergedBackendCounts;
  const mergedOcrBackendCounts = {
    ...(base.scanned_ocr_backend_selected_counts || {})
  };
  for (const [backend, count] of Object.entries(next.scanned_ocr_backend_selected_counts || {})) {
    const token = String(backend || '').trim().toLowerCase() || 'none';
    mergedOcrBackendCounts[token] = Number(mergedOcrBackendCounts[token] || 0) + Number(count || 0);
  }
  base.scanned_ocr_backend_selected_counts = mergedOcrBackendCounts;
  const ocrBackendRows = Object.entries(base.scanned_ocr_backend_selected_counts || {});
  if (ocrBackendRows.length > 0) {
    ocrBackendRows.sort((a, b) => (Number(b[1] || 0) - Number(a[1] || 0)) || String(a[0]).localeCompare(String(b[0])));
    base.scanned_ocr_backend_selected = String(ocrBackendRows[0][0] || '').trim();
  }
  base.scanned_ocr_confidence_avg = base.scanned_ocr_confidence_count > 0
    ? Number((base.scanned_ocr_confidence_sum / base.scanned_ocr_confidence_count).toFixed(6))
    : 0;
  base.errors = [
    ...(Array.isArray(base.errors) ? base.errors : []),
    ...(Array.isArray(next.errors) ? next.errors : [])
  ].map((row) => String(row || '').trim()).filter(Boolean).slice(0, 40);
  return base;
}

function redactSecrets(message, config) {
  const secrets = [
    config?.eloSupabaseAnonKey,
    config?.bingSearchKey,
    config?.googleCseKey
  ].filter(Boolean);

  let output = String(message || '');
  for (const secret of secrets) {
    output = output.split(secret).join('[redacted]');
  }
  return output;
}

export function createAdapterManager(config, logger) {
  return {
    adapters: ADAPTERS,

    collectSeedUrls({ job }) {
      const urls = [];
      for (const adapter of ADAPTERS) {
        try {
          urls.push(...(adapter.seedUrls?.({ job, config }) || []));
        } catch {
          // best effort only
        }
      }
      return [...new Set(urls)];
    },

    async extractForPage({ source, pageData, job, runId }) {
      const combined = {
        fieldCandidates: [],
        identityCandidates: {},
        additionalUrls: [],
        pdfDocs: [],
        pdfStats: emptyPdfStats(),
        adapterArtifacts: []
      };

      for (const adapter of ADAPTERS) {
        if (!adapter.supportsHost?.({ source, pageData, job })) {
          continue;
        }

        try {
          const result = await adapter.extractFromPage?.({ source, pageData, job, config, runId });
          if (!result) {
            continue;
          }
          combined.fieldCandidates.push(...(result.fieldCandidates || []));
          combined.identityCandidates = mergeIdentity(combined.identityCandidates, result.identityCandidates || {});
          combined.additionalUrls.push(...(result.additionalUrls || []));
          combined.pdfDocs.push(...(result.pdfDocs || []));
          combined.pdfStats = mergePdfStats(combined.pdfStats, result.pdfStats || {});
          combined.adapterArtifacts.push(...(result.adapterArtifacts || []));
        } catch (error) {
          logger?.warn?.('adapter_extract_failed', {
            adapter: adapter.name,
            host: source.host,
            message: redactSecrets(error.message, config)
          });
        }
      }

      combined.additionalUrls = [...new Set(combined.additionalUrls)];
      return combined;
    },

    async runDedicatedAdapters({ job, runId, storage }) {
      const syntheticSources = [];
      const adapterArtifacts = [];

      for (const adapter of ADAPTERS) {
        if (!adapter.runDedicatedFetch) {
          continue;
        }
        try {
          const result = await adapter.runDedicatedFetch({ config, job, runId, logger, storage });
          if (!result) {
            continue;
          }
          syntheticSources.push(...(result.syntheticSources || []));
          adapterArtifacts.push(...(result.adapterArtifacts || []));
        } catch (error) {
          logger?.warn?.('adapter_dedicated_failed', {
            adapter: adapter.name,
            message: redactSecrets(error.message, config)
          });
        }
      }

      return {
        syntheticSources,
        adapterArtifacts
      };
    }
  };
}
