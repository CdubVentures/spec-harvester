import { nowIso, safeJsonParse } from '../utils/common.js';

function boundedUtf8(text, maxBytes) {
  const buffer = Buffer.from(String(text || ''), 'utf8');
  if (buffer.length <= maxBytes) {
    return {
      text: String(text || ''),
      boundedByteLen: buffer.length,
      truncated: false
    };
  }

  const bounded = buffer.subarray(0, maxBytes);
  return {
    text: bounded.toString('utf8'),
    boundedByteLen: maxBytes,
    truncated: true
  };
}

function collectReplayRequests(rows, maxReplays) {
  const seen = new Set();
  const out = [];

  for (const row of rows || []) {
    const isGraphQl = row.isGraphQl || String(row.url || '').toLowerCase().includes('graphql');
    if (!isGraphQl) {
      continue;
    }
    if (String(row.request_method || '').toUpperCase() !== 'POST') {
      continue;
    }
    if (!row.request_post_json || typeof row.request_post_json !== 'object') {
      continue;
    }

    const key = `${row.request_url || row.url}|${JSON.stringify(row.request_post_json)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    out.push({
      url: row.request_url || row.url,
      postJson: row.request_post_json
    });

    if (out.length >= maxReplays) {
      break;
    }
  }

  return out;
}

export async function replayGraphqlRequests({
  page,
  capturedResponses,
  maxReplays = 5,
  maxJsonBytes = 2_000_000,
  logger
}) {
  const requests = collectReplayRequests(capturedResponses, maxReplays);
  const replayedRows = [];

  for (const request of requests) {
    try {
      const replayResult = await page.evaluate(async ({ url, postJson }) => {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(postJson)
          });
          const body = await response.text();
          return {
            ok: true,
            status: response.status,
            contentType: response.headers.get('content-type') || '',
            body
          };
        } catch (error) {
          return {
            ok: false,
            error: String(error)
          };
        }
      }, request);

      if (!replayResult?.ok) {
        logger?.warn?.('graphql_replay_failed', {
          url: request.url,
          message: replayResult?.error || 'unknown replay error'
        });
        continue;
      }

      const bounded = boundedUtf8(replayResult.body, maxJsonBytes);
      const parsed = safeJsonParse(bounded.text, null);
      const row = {
        ts: nowIso(),
        url: request.url,
        status: replayResult.status,
        contentType: replayResult.contentType,
        isGraphQl: true,
        classification: 'graphql_replay',
        boundedByteLen: bounded.boundedByteLen,
        truncated: bounded.truncated,
        request_url: request.url,
        request_method: 'POST',
        request_post_json: request.postJson,
        resource_type: 'fetch',
        replayed: true
      };

      if (parsed !== null) {
        if (!bounded.truncated) {
          row.jsonFull = parsed;
        } else {
          row.jsonPreview = parsed;
        }
      } else {
        row.jsonPreview = bounded.text.slice(0, 5000);
      }

      replayedRows.push(row);
    } catch (error) {
      logger?.warn?.('graphql_replay_exception', {
        url: request.url,
        message: error.message
      });
    }
  }

  return replayedRows;
}
