import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
    if (!/support|manual|spec|specsheet|datasheet|documentation|technical/i.test(href)) {
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

function sameDomainFamily(sourceHost, targetUrl) {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    return (
      host === sourceHost ||
      host.endsWith(`.${sourceHost}`) ||
      sourceHost.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

function runCommand(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill('SIGKILL');
      reject(new Error(`Command timeout: ${command}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `command failed with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function parsePdfViaPython(buffer) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-pdf-'));
  const pdfPath = path.join(tmpRoot, 'input.pdf');
  const outPath = path.join(tmpRoot, 'output.json');

  try {
    await fs.writeFile(pdfPath, buffer);
    await runCommand('python', [
      path.resolve('scripts', 'pdf_extract_tables.py'),
      '--pdf',
      pdfPath,
      '--out',
      outPath
    ]);

    const parsed = JSON.parse(await fs.readFile(outPath, 'utf8'));
    return {
      ok: Boolean(parsed?.ok),
      pairs: parsed?.pairs || [],
      textPreview: normalizeWhitespace(parsed?.text_preview || '')
    };
  } catch {
    return {
      ok: false,
      pairs: [],
      textPreview: ''
    };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
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

  async extractFromPage({ source, pageData, config }) {
    const pairs = extractTablePairs(pageData.html || '');
    const fieldCandidates = mapPairsToFieldCandidates(pairs, 'html_table');
    const identityCandidates = extractIdentityFromPairs(pairs);

    const additionalUrls = findSupportLikeUrls(pageData.html, source.url)
      .filter((url) => sameDomainFamily(source.host, url));

    const pdfUrls = findPdfUrls(pageData.html, source.url)
      .filter((url) => sameDomainFamily(source.host, url));

    const pdfDocs = [];
    const pdfFieldCandidates = [];

    for (const pdfUrl of pdfUrls.slice(0, 4)) {
      try {
        const response = await fetch(pdfUrl, {
          method: 'GET',
          headers: {
            'User-Agent': config.userAgent
          }
        });

        if (!response.ok) {
          continue;
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > config.maxPdfBytes) {
          continue;
        }

        const parsed = await parsePdfViaPython(bytes);
        const tableCandidates = mapPairsToFieldCandidates(parsed.pairs, 'pdf_table');
        const textCandidates = mapPdfTextToCandidates(parsed.textPreview);
        pdfFieldCandidates.push(...tableCandidates, ...textCandidates);

        pdfDocs.push({
          url: pdfUrl,
          filename: filenameFromUrl(pdfUrl),
          bytes,
          textPreview: parsed.textPreview.slice(0, 8000)
        });
      } catch {
        // best effort only
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
