import crypto from 'node:crypto';

export function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function sha256Buffer(value) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    return '';
  }
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

export function stableHash(value) {
  let hash = 0;
  const input = String(value || '');
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function screenshotMimeType(format = '') {
  const token = String(format || '').trim().toLowerCase();
  return token === 'png' ? 'image/png' : 'image/jpeg';
}

export function screenshotExtension(format = '') {
  const token = String(format || '').trim().toLowerCase();
  return token === 'png' ? 'png' : 'jpg';
}
