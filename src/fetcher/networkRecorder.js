import { nowIso, safeJsonParse } from '../utils/common.js';

const SECRET_KEY_PATTERN = /(authorization|token|password|secret|api[_-]?key|cookie|session)/i;

function isJsonLikeContentType(contentType = '') {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') ||
    normalized.includes('+json') ||
    normalized.includes('application/graphql-response+json') ||
    normalized.includes('text/json')
  );
}

function likelyGraphql(url, parsed) {
  if (String(url || '').toLowerCase().includes('graphql')) {
    return true;
  }
  return Boolean(parsed && typeof parsed === 'object' && ('data' in parsed || 'errors' in parsed));
}

function classifyResponse(url, parsed) {
  const token = String(url || '').toLowerCase();
  if (token.includes('variant') || token.includes('option')) {
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
    if (text.includes('variant') || (text.includes('sku') && text.includes('option'))) {
      return 'variant_matrix';
    }
    if (text.includes('spec') || text.includes('sensor') || text.includes('polling') || text.includes('dpi')) {
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

  const boundedBuffer = buffer.subarray(0, maxBytes);
  return {
    boundedText: boundedBuffer.toString('utf8'),
    boundedByteLen: maxBytes,
    truncated: true
  };
}

function sanitizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }

  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        output[key] = '[redacted]';
      } else {
        output[key] = sanitizeJsonValue(inner);
      }
    }
    return output;
  }

  if (typeof value === 'string' && value.length > 3000) {
    return `${value.slice(0, 3000)}...`;
  }

  return value;
}

function sanitizeRawPostData(text) {
  const raw = String(text || '');
  if (!raw) {
    return raw;
  }

  const maybeQueryString = raw.includes('=');
  if (maybeQueryString) {
    try {
      const params = new URLSearchParams(raw);
      let touched = false;
      for (const [key, value] of params.entries()) {
        if (SECRET_KEY_PATTERN.test(key)) {
          params.set(key, '[redacted]');
          touched = true;
        } else {
          params.set(key, value);
        }
      }
      if (touched) {
        return params.toString();
      }
    } catch {
      // fall through to regex redaction
    }
  }

  const keyValuePattern =
    /\b(authorization|token|password|secret|api[_-]?key|cookie|session)\b\s*[:=]\s*([^\s&;,]+)/ig;
  return raw.replace(keyValuePattern, '$1=[redacted]');
}

function parseRequestPostJson(request, responseUrl, maxJsonBytes) {
  try {
    const postData = request.postData();
    if (!postData) {
      return null;
    }

    const trimmed = postData.trimStart();
    const looksJsonBody = trimmed.startsWith('{') || trimmed.startsWith('[');
    const jsonEligible = looksJsonBody || responseUrl.toLowerCase().includes('graphql');
    if (!jsonEligible) {
      return null;
    }

    const bounded = boundedUtf8(postData, maxJsonBytes);
    const parsed = safeJsonParse(bounded.boundedText, null);
    if (parsed !== null) {
      return sanitizeJsonValue(parsed);
    }

    return {
      raw: sanitizeRawPostData(bounded.boundedText.slice(0, 5000)),
      truncated: bounded.truncated
    };
  } catch {
    return null;
  }
}

export class NetworkRecorder {
  constructor({ maxJsonBytes }) {
    this.maxJsonBytes = maxJsonBytes;
    this.rows = [];
  }

  async handleResponse(response) {
    const responseUrl = response.url();
    const status = response.status();
    const headers = response.headers();
    const contentType = headers['content-type'] || '';

    if (!isJsonLikeContentType(contentType) && !responseUrl.toLowerCase().includes('graphql')) {
      return;
    }

    let responseText;
    try {
      responseText = await response.text();
    } catch {
      return;
    }

    const bounded = boundedUtf8(responseText, this.maxJsonBytes);
    const parsed = safeJsonParse(bounded.boundedText, null);
    const isGraphQl = likelyGraphql(responseUrl, parsed);

    const request = response.request();
    const row = {
      ts: nowIso(),
      url: responseUrl,
      status,
      contentType,
      isGraphQl,
      classification: classifyResponse(responseUrl, parsed),
      boundedByteLen: bounded.boundedByteLen,
      truncated: bounded.truncated,
      request_url: request.url(),
      request_method: request.method(),
      resource_type: request.resourceType()
    };

    const requestPostJson = parseRequestPostJson(request, responseUrl, this.maxJsonBytes);
    if (requestPostJson !== null) {
      row.request_post_json = requestPostJson;
    }

    if (parsed !== null && !bounded.truncated) {
      row.jsonFull = sanitizeJsonValue(parsed);
    } else if (parsed !== null) {
      row.jsonPreview = sanitizeJsonValue(parsed);
    } else {
      row.jsonPreview = bounded.boundedText.slice(0, 5000);
    }

    this.rows.push(row);
  }
}
