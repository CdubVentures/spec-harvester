/**
 * Dossier Builder — Token Efficiency (IP05-5C).
 *
 * Before sending evidence to any LLM:
 *   1. Rank snippets by relevance to target fields
 *   2. Prefer readability_text and tables over raw HTML
 *   3. Cap payload size to stay within token budget
 *
 * This reduces cost and improves extraction quality.
 */

const SURFACE_PRIORITY = {
  table: 5,
  readability_text: 4,
  structured: 3,
  meta: 2,
  raw_html: 1,
  unknown: 0
};

/**
 * Approximate token count from text (≈4 chars per token).
 */
export function estimateTokenCount(text) {
  const len = String(text || '').length;
  return Math.ceil(len / 4);
}

/**
 * Rank snippets by relevance to target fields.
 *
 * Scoring factors:
 *   - Surface type (tables and readability_text preferred)
 *   - Keyword overlap with target fields
 *   - Shorter snippets with high density preferred
 */
export function rankSnippets({ snippets = [], targetFields = [] } = {}) {
  const fieldPatterns = targetFields
    .map((f) => String(f || '').trim().toLowerCase().replace(/_/g, '[_ ]?'))
    .filter(Boolean)
    .map((pattern) => {
      try { return new RegExp(pattern, 'i'); }
      catch { return null; }
    })
    .filter(Boolean);

  const scored = snippets.map((snippet) => {
    const text = String(snippet.text || '').toLowerCase();
    const surface = String(snippet.surface || 'unknown').toLowerCase();

    // Surface priority score (0-5)
    const surfaceScore = SURFACE_PRIORITY[surface] ?? SURFACE_PRIORITY.unknown;

    // Keyword relevance (how many target fields appear in text)
    let keywordHits = 0;
    for (const pattern of fieldPatterns) {
      if (pattern.test(text)) keywordHits += 1;
    }
    const keywordScore = fieldPatterns.length > 0
      ? (keywordHits / fieldPatterns.length) * 5
      : 0;

    // Density bonus: more keywords per character = higher quality
    const charCount = Math.max(1, text.length);
    const densityScore = keywordHits > 0 ? Math.min(2, (keywordHits * 100) / charCount) : 0;

    const totalScore = surfaceScore + keywordScore + densityScore;

    return {
      ...snippet,
      _relevanceScore: Number(totalScore.toFixed(4))
    };
  });

  scored.sort((a, b) => b._relevanceScore - a._relevanceScore);
  return scored;
}

/**
 * Build a token-budgeted dossier from snippets.
 *
 * @param {object} params
 * @param {Array} params.snippets - Evidence snippets
 * @param {string[]} params.targetFields - Fields being extracted
 * @param {number} params.maxTokens - Token budget
 * @returns {{ snippets, total_tokens, input_count, output_count, truncated }}
 */
export function buildDossier({ snippets = [], targetFields = [], maxTokens = 4000 } = {}) {
  if (snippets.length === 0) {
    return {
      snippets: [],
      total_tokens: 0,
      input_count: 0,
      output_count: 0,
      truncated: false
    };
  }

  const ranked = rankSnippets({ snippets, targetFields });
  const selected = [];
  let totalTokens = 0;

  for (const snippet of ranked) {
    const tokens = estimateTokenCount(snippet.text);
    if (totalTokens + tokens > maxTokens) {
      continue;
    }
    totalTokens += tokens;
    selected.push(snippet);
  }

  return {
    snippets: selected,
    total_tokens: totalTokens,
    input_count: snippets.length,
    output_count: selected.length,
    truncated: selected.length < snippets.length
  };
}
