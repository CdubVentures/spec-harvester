import { manufacturerAdapter } from './manufacturerAdapter.js';
import { techPowerUpAdapter } from './techPowerUpAdapter.js';
import { rtingsAdapter } from './rtingsAdapter.js';
import { eloShapesAdapter } from './eloShapesAdapter.js';

const ADAPTERS = [manufacturerAdapter, techPowerUpAdapter, rtingsAdapter, eloShapesAdapter];

function mergeIdentity(into, extra) {
  return {
    ...into,
    ...(extra || {})
  };
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
