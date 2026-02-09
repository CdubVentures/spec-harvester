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

function classifyResponse(url, parsed) {
  const token = String(url || '').toLowerCase();

  if (token.includes('variant') || token.includes('options')) {
    return 'variant_matrix';
  }
  if (token.includes('price')) {
    return 'pricing';
  }
  if (token.includes('review') || token.includes('rating')) {
    return 'reviews';
  }

  if (parsed && typeof parsed === 'object') {
    const text = JSON.stringify(parsed).toLowerCase();
    if (text.includes('variant') || text.includes('sku') && text.includes('options')) {
      return 'variant_matrix';
    }
    if (text.includes('spec') || text.includes('polling') || text.includes('dpi') || text.includes('sensor')) {
      return 'specs';
    }
    if (text.includes('price') || text.includes('currency')) {
      return 'pricing';
    }
    if (text.includes('review') || text.includes('rating')) {
      return 'reviews';
    }
    if (text.includes('product') || text.includes('model') || text.includes('brand')) {
      return 'product_payload';
    }
  }

  return 'unknown';
}

function boundedUtf8(text, maxBytes) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) {
    return {
      boundedText: text,
      boundedByteLen: buffer.length,
      truncated: false
    };
  }

  const truncated = buffer.subarray(0, maxBytes);
  return {
    boundedText: truncated.toString('utf8'),
    boundedByteLen: maxBytes,
    truncated: true
  };
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

    if (!isJsonLikeContentType(contentType) && !url.toLowerCase().includes('graphql')) {
      return;
    }

    let text;
    try {
      text = await response.text();
    } catch {
      return;
    }

    const bounded = boundedUtf8(text, this.maxJsonBytes);
    const parsed = safeJsonParse(bounded.boundedText, null);
    const isGraphQl = likelyGraphql(url, parsed);
    const classification = classifyResponse(url, parsed);

    const row = {
      ts: nowIso(),
      url,
      status,
      contentType,
      isGraphQl,
      classification,
      boundedByteLen: bounded.boundedByteLen,
      truncated: bounded.truncated
    };

    if (parsed !== null && !bounded.truncated) {
      row.jsonFull = parsed;
    } else if (parsed !== null) {
      row.jsonPreview = parsed;
    } else {
      row.jsonPreview = bounded.boundedText.slice(0, 5000);
    }

    this.rows.push(row);
  }
}
