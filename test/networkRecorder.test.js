import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkRecorder } from '../src/fetcher/networkRecorder.js';

function mockResponse({
  url = 'https://example.com/graphql',
  status = 200,
  contentType = 'application/json',
  body = '{"data":{"sensor":"Focus Pro 35K","token":"secret-token"}}',
  requestPostData = '{"query":"query Product","variables":{"sku":"123","api_key":"abc"}}'
} = {}) {
  return {
    url() {
      return url;
    },
    status() {
      return status;
    },
    headers() {
      return { 'content-type': contentType };
    },
    async text() {
      return body;
    },
    request() {
      return {
        url() {
          return url;
        },
        method() {
          return 'POST';
        },
        postData() {
          return requestPostData;
        },
        resourceType() {
          return 'fetch';
        }
      };
    }
  };
}

test('network recorder stores replay metadata and redacts secret-like keys', async () => {
  const recorder = new NetworkRecorder({ maxJsonBytes: 50000 });
  await recorder.handleResponse(mockResponse());

  assert.equal(recorder.rows.length, 1);
  const row = recorder.rows[0];

  assert.equal(row.request_method, 'POST');
  assert.equal(row.request_url, 'https://example.com/graphql');
  assert.equal(row.resource_type, 'fetch');
  assert.equal(row.isGraphQl, true);
  assert.equal(row.request_post_json.variables.api_key, '[redacted]');
  assert.equal(row.jsonFull.data.token, '[redacted]');
  assert.equal('headers' in row, false);
  assert.equal('request_headers' in row, false);
});

test('network recorder redacts non-JSON secret-like POST bodies', async () => {
  const recorder = new NetworkRecorder({ maxJsonBytes: 50000 });
  await recorder.handleResponse(mockResponse({
    requestPostData: 'token=secret-token&sku=123&api_key=abc'
  }));

  assert.equal(recorder.rows.length, 1);
  const row = recorder.rows[0];
  assert.equal(row.request_post_json.raw.includes('secret-token'), false);
  assert.equal(row.request_post_json.raw.includes('api_key=abc'), false);
  assert.equal(row.request_post_json.raw.includes('token=%5Bredacted%5D'), true);
});
