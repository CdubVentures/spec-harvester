import crypto from 'node:crypto';
import http from 'node:http';
import { nowIso } from '../utils/common.js';
import { buildReviewQueue } from './reviewGridData.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableQueueFingerprint(items = []) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((row) => ({
      product_id: String(row?.product_id || '').trim(),
      status: String(row?.status || '').trim(),
      flags: toInt(row?.flags, 0),
      confidence: Number.parseFloat(String(row?.confidence ?? 0)) || 0,
      coverage: Number.parseFloat(String(row?.coverage ?? 0)) || 0,
      updated_at: String(row?.updated_at || '').trim()
    }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

function mapByProductId(items = []) {
  const out = new Map();
  for (const row of items || []) {
    const productId = String(row?.product_id || '').trim();
    if (!productId) {
      continue;
    }
    out.set(productId, row);
  }
  return out;
}

function changedProductIds(previousItems = [], nextItems = []) {
  const previous = mapByProductId(previousItems);
  const next = mapByProductId(nextItems);
  const ids = new Set([...previous.keys(), ...next.keys()]);
  const changed = [];
  for (const productId of ids) {
    const left = previous.get(productId) || null;
    const right = next.get(productId) || null;
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      changed.push(productId);
    }
  }
  return changed.sort();
}

function textFrame(text = '') {
  const payload = Buffer.from(String(text || ''), 'utf8');
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([
      Buffer.from([0x81, length]),
      payload
    ]);
  }
  if (length < 65_536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(length, 6);
  return Buffer.concat([header, payload]);
}

function sendWsJson(socket, payload) {
  if (!socket || socket.destroyed || socket.writableEnded) {
    return false;
  }
  try {
    socket.write(textFrame(JSON.stringify(payload)));
    return true;
  } catch {
    return false;
  }
}

function wsHandshakeResponse(secKey = '') {
  const accept = crypto
    .createHash('sha1')
    .update(`${secKey}${WS_GUID}`)
    .digest('base64');
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    ''
  ].join('\r\n');
}

function eventPayload({
  event = 'snapshot',
  category,
  status,
  limit,
  items = [],
  changedIds = []
}) {
  return {
    channel: 'review_queue',
    event,
    category,
    status,
    limit,
    generated_at: nowIso(),
    count: Array.isArray(items) ? items.length : 0,
    changed_product_ids: [...new Set((changedIds || []).map((value) => String(value || '').trim()).filter(Boolean))],
    items: Array.isArray(items) ? items : []
  };
}

export async function startReviewQueueWebSocket({
  storage = null,
  config = {},
  category = 'mouse',
  status = 'needs_review',
  limit = 200,
  host = '127.0.0.1',
  port = 8789,
  pollSeconds = 5,
  snapshotProvider = null
}) {
  const normalizedCategory = normalizeCategory(category || 'mouse') || 'mouse';
  const normalizedStatus = normalizeToken(status || 'needs_review') || 'needs_review';
  const normalizedLimit = Math.max(1, toInt(limit, 200));
  const pollMs = Math.max(20, toInt(Number(pollSeconds) * 1000, 5000));
  const clients = new Set();

  const snapshotFn = typeof snapshotProvider === 'function'
    ? snapshotProvider
    : async () => await buildReviewQueue({
      storage,
      config,
      category: normalizedCategory,
      status: normalizedStatus,
      limit: normalizedLimit
    });

  let currentItems = [];
  let currentFingerprint = stableQueueFingerprint([]);
  let running = true;
  let pollTimer = null;

  async function refreshSnapshot() {
    let nextItems = [];
    try {
      const rows = await snapshotFn();
      nextItems = Array.isArray(rows) ? rows : [];
    } catch {
      return null;
    }
    const nextFingerprint = stableQueueFingerprint(nextItems);
    if (nextFingerprint === currentFingerprint) {
      return null;
    }
    const changedIds = changedProductIds(currentItems, nextItems);
    currentItems = nextItems;
    currentFingerprint = nextFingerprint;
    return eventPayload({
      event: 'queue_updated',
      category: normalizedCategory,
      status: normalizedStatus,
      limit: normalizedLimit,
      items: currentItems,
      changedIds
    });
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        ok: true,
        service: 'review-queue-websocket',
        category: normalizedCategory,
        status: normalizedStatus,
        count: currentItems.length
      }));
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.on('upgrade', (req, socket) => {
    if (!running) {
      socket.destroy();
      return;
    }
    const reqPath = String(req.url || '').split('?')[0];
    if (reqPath !== '/ws/queue') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const secKey = String(req.headers['sec-websocket-key'] || '').trim();
    if (!secKey) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(wsHandshakeResponse(secKey));
    clients.add(socket);
    const initial = eventPayload({
      event: 'snapshot',
      category: normalizedCategory,
      status: normalizedStatus,
      limit: normalizedLimit,
      items: currentItems,
      changedIds: []
    });
    sendWsJson(socket, initial);
    const cleanup = () => {
      clients.delete(socket);
      if (!socket.destroyed) {
        socket.destroy();
      }
    };
    socket.on('close', cleanup);
    socket.on('end', cleanup);
    socket.on('error', cleanup);
    socket.on('data', () => {
      // Ignore inbound frames (this channel is server push only).
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, async () => {
      server.off('error', reject);
      try {
        const seeded = await snapshotFn();
        currentItems = Array.isArray(seeded) ? seeded : [];
        currentFingerprint = stableQueueFingerprint(currentItems);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  pollTimer = setInterval(async () => {
    if (!running || clients.size === 0) {
      return;
    }
    const update = await refreshSnapshot();
    if (!update) {
      return;
    }
    for (const socket of [...clients]) {
      const ok = sendWsJson(socket, update);
      if (!ok) {
        clients.delete(socket);
      }
    }
  }, pollMs);

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const publicHost = host === '0.0.0.0' ? '127.0.0.1' : host;

  async function stop() {
    running = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    for (const socket of [...clients]) {
      try {
        socket.end();
        socket.destroy();
      } catch {
        // ignore close errors
      }
    }
    clients.clear();
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 250);
    });
  }

  return {
    category: normalizedCategory,
    status: normalizedStatus,
    limit: normalizedLimit,
    host,
    port: actualPort,
    path: '/ws/queue',
    ws_url: `ws://${publicHost}:${actualPort}/ws/queue`,
    health_url: `http://${publicHost}:${actualPort}/health`,
    poll_seconds: pollMs / 1000,
    stop
  };
}
