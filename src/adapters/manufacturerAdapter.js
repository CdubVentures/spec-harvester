import path from 'node:path';
import { mapPairsToFieldCandidates, extractTablePairs, extractIdentityFromPairs } from './tableParsing.js';
import { normalizeWhitespace } from '../utils/common.js';

function filenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const base = path.basename(pathname) || 'document.pdf';
    return base.replace(/[^a-zA-Z0-9._-]/g, '_');
  } catch {
    return 'document.pdf';
  }
}

function findPdfUrls(html, baseUrl) {
  const urls = [];
  for (const match of String(html || '').matchAll(/href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
    try {
      urls.push(new URL(match[1], baseUrl).toString());
    } catch {
      // ignore invalid
    }
  }
  return [...new Set(urls)];
}

function findSupportLikeUrls(html, baseUrl) {
  const urls = [];
  const regex = /href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of String(html || '').matchAll(regex)) {
    const href = match[1];
    if (!/support|manual|spec|datasheet/i.test(href)) {
      continue;
    }
    try {
      const absolute = new URL(href, baseUrl).toString();
      urls.push(absolute);
    } catch {
      // ignore invalid links
    }
  }
  return [...new Set(urls)];
}

async function parsePdfText(buffer) {
  try {
    let parser;
    try {
      const mod = await import('pdf-parse/lib/pdf-parse.js');
      parser = mod.default || mod;
    } catch {
      const mod = await import('pdf-parse');
      parser = mod.default || mod;
    }

    const result = await parser(buffer);
    return normalizeWhitespace(result?.text || '');
  } catch {
    return '';
  }
}

function mapPdfTextToCandidates(text) {
  if (!text) {
    return [];
  }

  const pairs = [];
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, 1200);

  for (const line of lines) {
    const parts = line.split(/[:\-]/);
    if (parts.length < 2) {
      continue;
    }
    const key = parts[0];
    const value = parts.slice(1).join(':').trim();
    if (key && value) {
      pairs.push({ key, value });
    }
  }

  return mapPairsToFieldCandidates(pairs, 'pdf_table');
}

export const manufacturerAdapter = {
  name: 'manufacturer',

  supportsHost({ source }) {
    return source.role === 'manufacturer';
  },

  async extractFromPage({ source, pageData }) {
    const pairs = extractTablePairs(pageData.html || '');
    const fieldCandidates = mapPairsToFieldCandidates(pairs, 'html_table');
    const identityCandidates = extractIdentityFromPairs(pairs);

    const additionalUrls = findSupportLikeUrls(pageData.html, source.url)
      .filter((url) => {
        try {
          const host = new URL(url).hostname.toLowerCase();
          return host === source.host || host.endsWith(`.${source.host}`) || source.host.endsWith(`.${host}`);
        } catch {
          return false;
        }
      });

    const pdfUrls = findPdfUrls(pageData.html, source.url)
      .filter((url) => {
        try {
          const host = new URL(url).hostname.toLowerCase();
          return host === source.host || host.endsWith(`.${source.host}`) || source.host.endsWith(`.${host}`);
        } catch {
          return false;
        }
      });

    const pdfDocs = [];
    const pdfFieldCandidates = [];

    for (const pdfUrl of pdfUrls.slice(0, 3)) {
      try {
        const response = await fetch(pdfUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; EGSpecHarvester/1.0; +https://eggear.com)'
          }
        });
        if (!response.ok) {
          continue;
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        const text = await parsePdfText(bytes);
        const candidatesFromPdf = mapPdfTextToCandidates(text);
        pdfFieldCandidates.push(...candidatesFromPdf);

        pdfDocs.push({
          url: pdfUrl,
          filename: filenameFromUrl(pdfUrl),
          bytes,
          textPreview: text.slice(0, 8000)
        });
      } catch {
        // best effort for manufacturer PDFs
      }
    }

    return {
      fieldCandidates: [...fieldCandidates, ...pdfFieldCandidates],
      identityCandidates,
      additionalUrls,
      pdfDocs
    };
  }
};
