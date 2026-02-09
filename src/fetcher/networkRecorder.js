import { nowIso, safeJsonParse } from '../utils/common.js';

function isJsonLikeContentType(contentType = '') {
  const ct = contentType.toLowerCase();
  return (
    ct.includes('application/json') ||
    ct.includes('+json') ||
    ct.includes('application/graphql-response+json') ||
    ct.includes('text/json')
  );
}

function likelyGraphql(url, parsed) {
  if (String(url).toLowerCase().includes('graphql')) {
    return true;
  }
  return Boolean(parsed && typeof parsed === 'object' && ('data' in parsed || 'errors' in parsed));
}

export class NetworkRecorder {
  constructor({ maxJsonBytes }) {
    this.maxJsonBytes = maxJsonBytes;
    this.rows = [];
  }

  async handleResponse(response) {
    const url = response.url();
    const status = response.status();
    const headers = response.headers();
    const contentType = headers['content-type'] || '';

    let text;
    if (!isJsonLikeContentType(contentType) && !url.toLowerCase().includes('graphql')) {
      return;
    }

    try {
      text = await response.text();
    } catch {
      return;
    }

    const byteLength = Buffer.byteLength(text, 'utf8');
    const truncated = byteLength > this.maxJsonBytes;
    const boundedText = truncated
      ? text.slice(0, Math.max(0, this.maxJsonBytes))
      : text;

    const parsed = safeJsonParse(boundedText, null);
    this.rows.push({
      ts: nowIso(),
      url,
      status,
      content_type: contentType,
      is_graphql: likelyGraphql(url, parsed),
      truncated,
      body: parsed !== null ? parsed : boundedText
    });
  }
}
