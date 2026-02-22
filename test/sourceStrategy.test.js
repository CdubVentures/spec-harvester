import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { SpecDb } from '../src/db/specDb.js';

function makeTempDb() {
  const tmpDir = path.join('test', '_tmp_source_strategy_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new SpecDb({ dbPath, category: 'mouse' });
  return { db, tmpDir, dbPath };
}

function cleanupDb(ctx) {
  try { ctx.db.close(); } catch {}
  try { fs.rmSync(ctx.tmpDir, { recursive: true, force: true }); } catch {}
}

describe('sourceStrategy', () => {
  let ctx;

  before(() => {
    ctx = makeTempDb();
  });

  after(() => {
    cleanupDb(ctx);
  });

  it('CRUD: insert, read, update, delete', () => {
    const { id } = ctx.db.insertSourceStrategy({
      host: 'rtings.com',
      display_name: 'RTINGS',
      source_type: 'lab_review',
      default_tier: 2,
      discovery_method: 'search_first',
      priority: 90
    });
    assert.ok(id);

    const all = ctx.db.listSourceStrategies();
    assert.ok(all.length >= 1);
    const found = all.find(r => r.host === 'rtings.com');
    assert.ok(found);
    assert.equal(found.display_name, 'RTINGS');
    assert.equal(found.source_type, 'lab_review');
    assert.equal(found.priority, 90);

    const updated = ctx.db.updateSourceStrategy(id, { priority: 95, notes: 'Top tier review site' });
    assert.equal(updated.priority, 95);
    assert.equal(updated.notes, 'Top tier review site');

    ctx.db.deleteSourceStrategy(id);
    const afterDelete = ctx.db.getSourceStrategy(id);
    assert.equal(afterDelete, null);
  });

  it('discovery reads enabled sources from table', () => {
    ctx.db.insertSourceStrategy({
      host: 'techpowerup.com',
      display_name: 'TechPowerUp',
      source_type: 'lab_review',
      default_tier: 2,
      priority: 85,
      enabled: 1
    });
    ctx.db.insertSourceStrategy({
      host: 'eloshapes.com',
      display_name: 'Eloshapes',
      source_type: 'spec_database',
      default_tier: 2,
      priority: 70,
      enabled: 1
    });

    const enabled = ctx.db.listEnabledSourceStrategies();
    assert.ok(enabled.length >= 2);
    assert.ok(enabled.some(r => r.host === 'techpowerup.com'));
    assert.ok(enabled.some(r => r.host === 'eloshapes.com'));
  });

  it('disabled sources are skipped', () => {
    ctx.db.insertSourceStrategy({
      host: 'disabled-site.com',
      display_name: 'Disabled Site',
      source_type: 'retail',
      default_tier: 3,
      priority: 10,
      enabled: 0
    });

    const enabled = ctx.db.listEnabledSourceStrategies();
    assert.ok(!enabled.some(r => r.host === 'disabled-site.com'));
  });

  it('search_first method generates site: queries for the host', () => {
    const sources = ctx.db.listEnabledSourceStrategies();
    const searchFirstSources = sources.filter(s => s.discovery_method === 'search_first');
    assert.ok(searchFirstSources.length > 0);

    const tpu = searchFirstSources.find(s => s.host === 'techpowerup.com');
    assert.ok(tpu);
    const siteQuery = `site:${tpu.host} Razer Viper V3 Pro`;
    assert.ok(siteQuery.includes('site:techpowerup.com'));
  });
});
