import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, sha256Buffer, stableHash, screenshotMimeType, screenshotExtension } from '../src/pipeline/helpers/cryptoHelpers.js';

test('sha256 produces hex hash of string input', () => {
  const hash = sha256('hello');
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 64);
  assert.equal(hash, sha256('hello'));
});

test('sha256 handles empty and null input', () => {
  assert.equal(sha256(''), sha256(null));
  assert.equal(sha256(), sha256(''));
});

test('sha256Buffer produces sha256: prefixed hex for buffer input', () => {
  const buf = Buffer.from('test data');
  const result = sha256Buffer(buf);
  assert.ok(result.startsWith('sha256:'));
  assert.equal(result.length, 7 + 64);
});

test('sha256Buffer returns empty string for non-buffer or empty buffer', () => {
  assert.equal(sha256Buffer('not a buffer'), '');
  assert.equal(sha256Buffer(Buffer.alloc(0)), '');
  assert.equal(sha256Buffer(null), '');
});

test('stableHash returns consistent non-negative integer', () => {
  const a = stableHash('test');
  const b = stableHash('test');
  assert.equal(a, b);
  assert.ok(a >= 0);
  assert.ok(Number.isInteger(a));
});

test('stableHash returns different values for different inputs', () => {
  assert.notEqual(stableHash('hello'), stableHash('world'));
});

test('screenshotMimeType returns image/png for png', () => {
  assert.equal(screenshotMimeType('png'), 'image/png');
  assert.equal(screenshotMimeType('PNG'), 'image/png');
});

test('screenshotMimeType returns image/jpeg for non-png', () => {
  assert.equal(screenshotMimeType('jpg'), 'image/jpeg');
  assert.equal(screenshotMimeType(''), 'image/jpeg');
  assert.equal(screenshotMimeType(), 'image/jpeg');
});

test('screenshotExtension returns png for png', () => {
  assert.equal(screenshotExtension('png'), 'png');
  assert.equal(screenshotExtension('PNG'), 'png');
});

test('screenshotExtension returns jpg for non-png', () => {
  assert.equal(screenshotExtension('jpg'), 'jpg');
  assert.equal(screenshotExtension(''), 'jpg');
  assert.equal(screenshotExtension(), 'jpg');
});
