const NOISE_TAG_PATTERN = /<(nav|header|footer|aside|noscript|script|style|iframe|svg|form)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const HIDDEN_PATTERN = /\b(display\s*:\s*none|visibility\s*:\s*hidden|aria-hidden\s*=\s*["']true["'])/gi;

const NOISE_CLASS_PATTERNS = [
  /class\s*=\s*["'][^"']*\b(navbar|nav-bar|site-header|site-footer|sidebar|breadcrumb|cookie-banner|modal-overlay|popup|advertisement|ad-container|social-share|share-buttons)\b[^"']*["']/gi
];

function stripHtmlComments(html) {
  return String(html || '').replace(COMMENT_PATTERN, '');
}

function stripNoiseTags(html) {
  return String(html || '').replace(NOISE_TAG_PATTERN, ' ');
}

function collapseWhitespace(text) {
  return String(text || '')
    .replace(/[\r\n]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function filterReadableHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  let filtered = stripHtmlComments(html);
  filtered = stripNoiseTags(filtered);
  for (const pattern of NOISE_CLASS_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    // Remove elements with noise classes (simplified: just flag them)
    filtered = filtered.replace(pattern, '');
  }
  return filtered;
}

export function extractReadableText(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  let filtered = filterReadableHtml(html);
  // Strip remaining HTML tags
  filtered = filtered.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  filtered = filtered
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return collapseWhitespace(filtered);
}

export function truncateForTokenBudget(text, maxChars = 50_000) {
  const clean = String(text || '');
  if (clean.length <= maxChars) {
    return clean;
  }
  return clean.slice(0, maxChars);
}
