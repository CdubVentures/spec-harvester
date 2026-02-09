import { extractTablePairs, extractIdentityFromPairs, mapPairsToFieldCandidates } from './tableParsing.js';

function hostMatches(source) {
  return source.host === 'techpowerup.com' || source.host.endsWith('.techpowerup.com');
}

export const techPowerUpAdapter = {
  name: 'techpowerup',

  seedUrls({ job }) {
    const query = encodeURIComponent(
      [job.identityLock?.brand || '', job.identityLock?.model || ''].join(' ').trim()
    );
    if (!query) {
      return [];
    }
    return [`https://www.techpowerup.com/search/?q=${query}`];
  },

  supportsHost({ source }) {
    return hostMatches(source);
  },

  async extractFromPage({ pageData }) {
    const pairs = extractTablePairs(pageData.html || '');
    const fieldCandidates = mapPairsToFieldCandidates(pairs, 'html_table');
    const identityCandidates = extractIdentityFromPairs(pairs);

    return {
      fieldCandidates,
      identityCandidates,
      additionalUrls: [],
      pdfDocs: []
    };
  }
};
