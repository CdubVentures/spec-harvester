import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { startReviewQueueWebSocket } from '../src/review/queueWebSocket.js';

function encodeClientCloseFrame() {
  const payload = Buffer.alloc(0);
  const mask = crypto.randomBytes(4);
  const header = Buffer.from([0x88, 0x80 | payload.length]);
  return Buffer.concat([header, mask, payload]);
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > buffer.length) {
        break;
      }
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) {
        break;
      }
      const high = buffer.readUInt32BE(cursor);
      const low = buffer.readUInt32BE(cursor + 4);
      length = (high * 2 ** 32) + low;
      cursor += 8;
    }

    const maskBytes = masked ? 4 : 0;
    if (cursor + maskBytes + length > buffer.length) {
      break;
    }

    let payload = buffer.slice(cursor + maskBytes, cursor + maskBytes + length);
    if (masked) {
      const mask = buffer.slice(cursor, cursor + 4);
      payload = Buffer.from(payload);
      for (let idx = 0; idx < payload.length; idx += 1) {
        payload[idx] ^= mask[idx % 4];
      }
    }

    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }
    offset = cursor + maskBytes + length;
  }
  return {
    messages,
    remaining: buffer.slice(offset)
  };
}

function createRawWsClient({ host, port, path = '/ws/queue' }) {
  const socket = net.createConnection({ host, port });
  let handshakeDone = false;
  let buffer = Buffer.alloc(0);
  const queue = [];
  const waiters = [];

  function pushMessage(message) {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(message);
      return;
    }
    queue.push(message);
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshakeDone) {
      const marker = buffer.indexOf('\r\n\r\n');
      if (marker === -1) {
        return;
      }
      handshakeDone = true;
      buffer = buffer.slice(marker + 4);
    }
    const decoded = decodeFrames(buffer);
    buffer = decoded.remaining;
    for (const message of decoded.messages) {
      pushMessage(message);
    }
  });

  socket.on('error', (error) => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter.reject(error);
    }
  });

  async function open() {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const key = crypto.randomBytes(16).toString('base64');
    socket.write(
      [
        `GET ${path} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        ''
      ].join('\r\n')
    );
  }

  function nextMessage(timeoutMs = 2000) {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((entry) => entry.resolve === resolve);
        if (idx >= 0) {
          waiters.splice(idx, 1);
        }
        reject(new Error('timeout_waiting_for_ws_message'));
      }, timeoutMs);
      waiters.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async function close() {
    if (!socket.destroyed) {
      socket.write(encodeClientCloseFrame());
      socket.end();
    }
    await new Promise((resolve) => {
      socket.once('close', resolve);
      setTimeout(resolve, 250);
    });
  }

  return {
    open,
    nextMessage,
    close
  };
}

test('review queue websocket pushes initial and changed queue snapshots', async () => {
  let queueItems = [
    {
      product_id: 'mouse-a',
      confidence: 0.91,
      coverage: 0.88,
      flags: 1,
      status: 'needs_review',
      updated_at: '2026-02-13T00:00:00.000Z'
    }
  ];

  const server = await startReviewQueueWebSocket({
    category: 'mouse',
    status: 'needs_review',
    limit: 50,
    host: '127.0.0.1',
    port: 0,
    pollSeconds: 0.05,
    snapshotProvider: async () => queueItems
  });

  const client = createRawWsClient({
    host: '127.0.0.1',
    port: server.port
  });

  try {
    await client.open();
    const firstRaw = await client.nextMessage(2000);
    const first = JSON.parse(firstRaw);
    assert.equal(first.channel, 'review_queue');
    assert.equal(first.event, 'snapshot');
    assert.equal(first.count, 1);

    queueItems = [
      ...queueItems,
      {
        product_id: 'mouse-b',
        confidence: 0.84,
        coverage: 0.81,
        flags: 3,
        status: 'needs_review',
        updated_at: '2026-02-13T00:00:10.000Z'
      }
    ];

    const secondRaw = await client.nextMessage(2500);
    const second = JSON.parse(secondRaw);
    assert.equal(second.channel, 'review_queue');
    assert.equal(second.event, 'queue_updated');
    assert.equal(second.count, 2);
    assert.equal(Array.isArray(second.changed_product_ids), true);
    assert.equal(second.changed_product_ids.includes('mouse-b'), true);
  } finally {
    await client.close();
    await server.stop();
  }
});
