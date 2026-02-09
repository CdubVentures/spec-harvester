import { safeJsonParse } from '../utils/common.js';

function extractBalancedJson(source, startIndex) {
  let i = startIndex;
  while (i < source.length && /\s/.test(source[i])) {
    i += 1;
  }

  const opener = source[i];
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : null;
  if (!closer) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let idx = i; idx < source.length; idx += 1) {
    const ch = source[idx];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === opener) {
      depth += 1;
    } else if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(i, idx + 1);
      }
    }
  }

  return null;
}

function extractScriptTagContent(html, id) {
  const regex = new RegExp(
    `<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    'i'
  );
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

function extractAssignedJson(html, variableName) {
  const marker = `${variableName} =`;
  const idx = html.indexOf(marker);
  if (idx === -1) {
    return null;
  }

  const jsonSlice = extractBalancedJson(html, idx + marker.length);
  if (!jsonSlice) {
    return null;
  }

  return safeJsonParse(jsonSlice, null);
}

export function extractEmbeddedState(html) {
  const output = {
    nextData: null,
    nuxtState: null,
    apolloState: null
  };

  if (!html) {
    return output;
  }

  const nextRaw = extractScriptTagContent(html, '__NEXT_DATA__');
  if (nextRaw) {
    output.nextData = safeJsonParse(nextRaw, null);
  }

  output.nuxtState = extractAssignedJson(html, 'window.__NUXT__');
  output.apolloState = extractAssignedJson(html, 'window.__APOLLO_STATE__');

  return output;
}
