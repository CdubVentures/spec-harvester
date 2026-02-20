import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { extractReadableText, truncateForTokenBudget } from './readabilityFilter.js';

const NOISE_SENTENCE_PATTERN = /\b(cookie|privacy|terms|subscribe|newsletter|sign in|log in|advertis(e|ing)|all rights reserved)\b/i;

function safeUrl(input) {
  const token = String(input || '').trim();
  if (!token) {
    return 'https://example.com/';
  }
  try {
    return new URL(token).toString();
  } catch {
    return 'https://example.com/';
  }
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanupSentences(text) {
  const input = String(text || '').trim();
  if (!input) {
    return '';
  }
  const chunks = input
    .split(/(?<=[.!?])\s+/g)
    .map((row) => row.trim())
    .filter(Boolean);

  const filtered = [];
  for (const row of chunks) {
    if (NOISE_SENTENCE_PATTERN.test(row)) {
      continue;
    }
    filtered.push(row);
    if (filtered.length >= 1200) {
      break;
    }
  }
  return normalizeText(filtered.join(' '));
}

function duplicateSentenceRatio(text) {
  const chunks = String(text || '')
    .split(/(?<=[.!?])\s+/g)
    .map((row) => row.trim().toLowerCase())
    .filter((row) => row.length >= 12);
  if (chunks.length === 0) {
    return 1;
  }
  const unique = new Set(chunks);
  return Math.max(0, 1 - (unique.size / chunks.length));
}

function scoreArticle(text, {
  headingCount = 0,
  titleMatch = false
} = {}) {
  const normalized = normalizeText(text);
  const charCount = normalized.length;
  const words = normalized ? normalized.split(/\s+/).length : 0;
  const duplicateRatio = duplicateSentenceRatio(normalized);

  let score = 0;
  if (charCount >= 800) score += 28;
  else if (charCount >= 400) score += 16;
  else if (charCount >= 200) score += 8;

  if (words >= 160) score += 26;
  else if (words >= 90) score += 14;
  else if (words >= 40) score += 8;

  if (headingCount >= 2) score += 14;
  else if (headingCount >= 1) score += 8;

  if (titleMatch) score += 10;

  if (duplicateRatio <= 0.2) score += 12;
  else if (duplicateRatio <= 0.35) score += 6;
  else if (duplicateRatio >= 0.55) score -= 12;

  return {
    score: Math.max(0, Math.min(100, score)),
    char_count: charCount,
    word_count: words,
    heading_count: headingCount,
    duplicate_sentence_ratio: Number(duplicateRatio.toFixed(3))
  };
}

function titleInText(title, text) {
  const titleToken = String(title || '').trim().toLowerCase();
  if (!titleToken) {
    return false;
  }
  return String(text || '').toLowerCase().includes(titleToken);
}

function extractViaReadability(html, { url = '' } = {}) {
  const dom = new JSDOM(String(html || ''), {
    url: safeUrl(url),
    contentType: 'text/html'
  });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.textContent) {
    return null;
  }
  return {
    text: normalizeText(article.textContent),
    title: normalizeText(article.title),
    byline: normalizeText(article.byline),
    excerpt: normalizeText(article.excerpt),
    length: Number(article.length || 0),
    content_html: String(article.content || ''),
    heading_count: Number(String(article.content || '').match(/<h[1-6]\b/gi)?.length || 0)
  };
}

function extractViaFallback(html) {
  const text = cleanupSentences(extractReadableText(html));
  return {
    text: normalizeText(text),
    title: '',
    byline: '',
    excerpt: '',
    length: String(text || '').length,
    content_html: '',
    heading_count: 0
  };
}

export function extractMainArticle(html, options = {}) {
  const enabled = options.enabled !== false;
  const minChars = Math.max(100, Number(options.minChars || 700));
  const minScore = Math.max(1, Number(options.minScore || 45));
  const maxChars = Math.max(1000, Number(options.maxChars || 60_000));
  const pageTitle = String(options.title || '').trim();

  if (!html || typeof html !== 'string') {
    return {
      method: 'none',
      text: '',
      title: pageTitle,
      byline: '',
      excerpt: '',
      quality: {
        score: 0,
        char_count: 0,
        word_count: 0,
        heading_count: 0,
        duplicate_sentence_ratio: 1
      },
      low_quality: true,
      fallback_reason: 'empty_html'
    };
  }

  const fallback = extractViaFallback(html);
  const fallbackQuality = scoreArticle(fallback.text, {
    headingCount: fallback.heading_count,
    titleMatch: titleInText(pageTitle, fallback.text)
  });

  if (!enabled) {
    return {
      method: 'heuristic_fallback',
      text: truncateForTokenBudget(fallback.text, maxChars),
      title: pageTitle || fallback.title,
      byline: fallback.byline,
      excerpt: fallback.excerpt,
      quality: fallbackQuality,
      low_quality: fallbackQuality.score < minScore || fallbackQuality.char_count < minChars,
      fallback_reason: 'disabled'
    };
  }

  let readability = null;
  let readabilityError = '';
  try {
    readability = extractViaReadability(html, options);
  } catch (error) {
    readabilityError = String(error?.message || error || 'readability_error');
  }

  if (!readability || !readability.text) {
    return {
      method: 'heuristic_fallback',
      text: truncateForTokenBudget(fallback.text, maxChars),
      title: pageTitle || fallback.title,
      byline: fallback.byline,
      excerpt: fallback.excerpt,
      quality: fallbackQuality,
      low_quality: fallbackQuality.score < minScore || fallbackQuality.char_count < minChars,
      fallback_reason: readabilityError || 'readability_empty'
    };
  }

  const readabilityText = cleanupSentences(readability.text);
  const readabilityQuality = scoreArticle(readabilityText, {
    headingCount: readability.heading_count,
    titleMatch: titleInText(pageTitle || readability.title, readabilityText)
  });

  const readabilityPasses =
    readabilityQuality.score >= minScore && readabilityQuality.char_count >= minChars;

  if (readabilityPasses || readabilityQuality.score >= fallbackQuality.score) {
    return {
      method: 'readability',
      text: truncateForTokenBudget(readabilityText, maxChars),
      title: readability.title || pageTitle,
      byline: readability.byline,
      excerpt: readability.excerpt,
      quality: readabilityQuality,
      low_quality: !readabilityPasses,
      fallback_reason: readabilityPasses ? '' : 'readability_low_quality'
    };
  }

  return {
    method: 'heuristic_fallback',
    text: truncateForTokenBudget(fallback.text, maxChars),
    title: pageTitle || fallback.title || readability.title,
    byline: fallback.byline || readability.byline,
    excerpt: fallback.excerpt || readability.excerpt,
    quality: fallbackQuality,
    low_quality: fallbackQuality.score < minScore || fallbackQuality.char_count < minChars,
    fallback_reason: 'fallback_scored_higher'
  };
}
