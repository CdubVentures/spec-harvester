import { normalizeWhitespace } from '../utils/common.js';

function stripHtml(html) {
  return normalizeWhitespace(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

export function extractDomFallback(html) {
  const text = stripHtml(html);
  const candidates = {};

  const patterns = [
    ['weight', /weight\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i],
    ['lngth', /length\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*mm/i],
    ['width', /width\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*mm/i],
    ['height', /height\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*mm/i],
    ['sensor', /sensor\s*[:\-]?\s*([a-z0-9\-\s]+)/i],
    ['dpi', /(?:dpi|resolution)\s*[:\-]?\s*(\d{3,6})/i],
    ['polling_rate', /polling\s*rate\s*[:\-]?\s*([\d\s,\/]+)\s*hz/i],
    ['side_buttons', /side\s*buttons\s*[:\-]?\s*(\d+)/i],
    ['middle_buttons', /middle\s*buttons\s*[:\-]?\s*(\d+)/i]
  ];

  for (const [field, regex] of patterns) {
    const match = text.match(regex);
    if (match) {
      candidates[field] = normalizeWhitespace(match[1]);
    }
  }

  return candidates;
}
