import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HostPacer } from '../src/concurrency/hostPacer.js';

describe('HostPacer', () => {
  it('canProceed returns true for unseen host', () => {
    const pacer = new HostPacer({ delayMs: 300 });
    assert.equal(pacer.canProceed('example.com'), true);
  });

  it('canProceed returns false within delay window', () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 300, nowFn: () => now });
    pacer.recordFetch('example.com');
    now = 1100;
    assert.equal(pacer.canProceed('example.com'), false);
  });

  it('canProceed returns true after delay window', () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 300, nowFn: () => now });
    pacer.recordFetch('example.com');
    now = 1400;
    assert.equal(pacer.canProceed('example.com'), true);
  });

  it('waitForSlot resolves immediately for new host', async () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 300, nowFn: () => now });
    const before = now;
    await pacer.waitForSlot('example.com');
    assert.equal(now, before);
  });

  it('waitForSlot waits correct duration for recent host', async () => {
    let now = 1000;
    const sleeps = [];
    const pacer = new HostPacer({
      delayMs: 300,
      nowFn: () => now,
      sleepFn: async (ms) => {
        sleeps.push(ms);
        now += ms;
      }
    });
    pacer.recordFetch('example.com');
    now = 1100;
    await pacer.waitForSlot('example.com');
    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0], 200);
  });

  it('different hosts do not interfere', () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 300, nowFn: () => now });
    pacer.recordFetch('host-a.com');
    now = 1100;
    assert.equal(pacer.canProceed('host-a.com'), false);
    assert.equal(pacer.canProceed('host-b.com'), true);
  });

  it('recordFetch updates last-fetch timestamp', () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 300, nowFn: () => now });
    pacer.recordFetch('example.com');
    now = 1400;
    assert.equal(pacer.canProceed('example.com'), true);
    pacer.recordFetch('example.com');
    assert.equal(pacer.canProceed('example.com'), false);
  });

  it('configurable delayMs per instance', () => {
    let now = 1000;
    const fast = new HostPacer({ delayMs: 100, nowFn: () => now });
    const slow = new HostPacer({ delayMs: 500, nowFn: () => now });
    fast.recordFetch('example.com');
    slow.recordFetch('example.com');
    now = 1200;
    assert.equal(fast.canProceed('example.com'), true);
    assert.equal(slow.canProceed('example.com'), false);
  });

  it('zero delay means no waiting', async () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 0, nowFn: () => now });
    pacer.recordFetch('example.com');
    assert.equal(pacer.canProceed('example.com'), true);
    const sleeps = [];
    await pacer.waitForSlot('example.com');
    assert.equal(sleeps.length, 0);
  });

  it('stats returns host count and last fetch times', () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 300, nowFn: () => now });
    pacer.recordFetch('host-a.com');
    now = 2000;
    pacer.recordFetch('host-b.com');
    const s = pacer.stats();
    assert.equal(s.hostCount, 2);
    assert.deepEqual(Object.keys(s.hosts).sort(), ['host-a.com', 'host-b.com']);
    assert.equal(s.hosts['host-a.com'], 1000);
    assert.equal(s.hosts['host-b.com'], 2000);
  });

  it('remainingMs returns 0 for unseen host', () => {
    const pacer = new HostPacer({ delayMs: 300 });
    assert.equal(pacer.remainingMs('unknown.com'), 0);
  });

  it('remainingMs returns correct value within delay', () => {
    let now = 1000;
    const pacer = new HostPacer({ delayMs: 300, nowFn: () => now });
    pacer.recordFetch('example.com');
    now = 1100;
    assert.equal(pacer.remainingMs('example.com'), 200);
  });
});
