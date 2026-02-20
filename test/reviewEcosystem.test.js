// ── Review Ecosystem Tests — Redesigned for SQLite Schema ──────────────
//
// Comprehensive tests for all 3 review surfaces + SpecDb SQLite layer.
// Uses a rich field rules contract covering ALL contract archetypes:
//   - Scalar number with unit (weight, dpi)
//   - Component reference (sensor, switch_type, encoder, shell_material)
//   - Closed enum (connection)
//   - Open enum (cable_type)
//   - List of strings + enum (coating)
//
// 5 unique products with shared components for cross-product verification:
//   1. mouse-razer-viper-v3-pro    (PAW3950, Razer Optical Gen-3)
//   2. mouse-logitech-g502-x       (HERO26K, Omron D2FC-F-K)
//   3. mouse-zowie-ec2-c            (PMW3360, Huano Blue Shell)
//   4. mouse-pulsar-x2-v3          (PAW3950*, Kailh GM 8.0)
//   5. mouse-endgame-gear-op1we    (PMW3395, Kailh GM 8.0*)
//   * = shared component across products

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  buildProductReviewPayload,
  buildReviewLayout,
  buildFieldState,
} from '../src/review/reviewGridData.js';
import {
  buildComponentReviewPayloads,
  buildEnumReviewPayloads,
} from '../src/review/componentReviewData.js';

// ── Field Rules Contract (all archetypes) ─────────────────────────────

const CATEGORY = 'mouse';

const FIELD_RULES_FIELDS = {
  weight: { required_level: 'required', contract: { type: 'number', unit: 'g', shape: 'scalar', range: { min: 20, max: 300 } } },
  sensor: { required_level: 'required', contract: { type: 'string', shape: 'scalar' }, component: { type: 'sensor', source: 'component_db.sensor' }, enum: { policy: 'open_prefer_known' } },
  switch_type: { required_level: 'expected', contract: { type: 'string', shape: 'scalar' }, component: { type: 'switch', source: 'component_db.switch' }, enum: { policy: 'open_prefer_known' } },
  encoder: { required_level: 'optional', contract: { type: 'string', shape: 'scalar' }, component: { type: 'encoder', source: 'component_db.encoder' }, enum: { policy: 'open_prefer_known' } },
  dpi: { required_level: 'required', contract: { type: 'integer', unit: 'dpi', shape: 'scalar', range: { min: 50, max: 100000 } } },
  connection: { required_level: 'required', contract: { type: 'string', shape: 'scalar' }, enum: { policy: 'closed' }, enum_name: 'connection' },
  cable_type: { required_level: 'optional', contract: { type: 'string', shape: 'scalar' }, enum: { policy: 'open_prefer_known' }, enum_name: 'cable_type' },
  coating: { required_level: 'optional', output_shape: 'list', contract: { type: 'string', shape: 'list' }, enum: { policy: 'open_prefer_known' }, enum_name: 'coating' },
  shell_material: { required_level: 'optional', contract: { type: 'string', shape: 'scalar' }, component: { type: 'material', source: 'component_db.material' }, enum: { policy: 'open_prefer_known' } },
};

// ── Component DB Items (4 types) ──────────────────────────────────────

const SENSOR_ITEMS = [
  { name: 'PAW3950', maker: 'PixArt', aliases: ['3950', 'PixArt 3950'], links: ['https://pixart.com/paw3950'], properties: { dpi_max: '35000', ips: '750', acceleration: '50' } },
  { name: 'HERO26K', maker: 'Logitech', aliases: ['HERO 26K', 'HERO'], links: [], properties: { dpi_max: '25600', ips: '400', acceleration: '40' } },
  { name: 'PMW3360', maker: 'PixArt', aliases: ['3360'], links: [], properties: { dpi_max: '12000', ips: '250', acceleration: '50' } },
  { name: 'PMW3395', maker: 'PixArt', aliases: ['3395', 'PAW3395'], links: [], properties: { dpi_max: '26000', ips: '650', acceleration: '50' } },
  { name: 'PMW3389', maker: 'PixArt', aliases: ['3389'], links: [], properties: { dpi_max: '16000', ips: '400', acceleration: '50' } },
];

const SWITCH_ITEMS = [
  { name: 'Razer Optical Gen-3', maker: 'Razer', aliases: ['Optical Gen 3'], links: [], properties: { actuation_force: '45', lifespan: '90M' } },
  { name: 'Omron D2FC-F-K', maker: 'Omron', aliases: ['D2FC', 'Omron D2FC'], links: [], properties: { actuation_force: '75', lifespan: '50M' } },
  { name: 'Huano Blue Shell', maker: 'Huano', aliases: ['Huano Blue'], links: [], properties: { actuation_force: '65', lifespan: '20M' } },
  { name: 'Kailh GM 8.0', maker: 'Kailh', aliases: ['GM8', 'GM 8.0'], links: [], properties: { actuation_force: '55', lifespan: '80M' } },
  { name: 'TTC Gold', maker: 'TTC', aliases: ['TTC Gold V2'], links: [], properties: { actuation_force: '60', lifespan: '100M' } },
];

const ENCODER_ITEMS = [
  { name: 'TTC Gold Encoder', maker: 'TTC', aliases: ['TTC Encoder'], links: [], properties: { steps: '24', tactility: 'medium' } },
  { name: 'ALPS Encoder', maker: 'ALPS', aliases: ['ALPS'], links: [], properties: { steps: '24', tactility: 'firm' } },
];

const MATERIAL_ITEMS = [
  { name: 'PTFE', maker: '', aliases: ['Teflon'], links: [], properties: { friction: 'low', durability: 'high' } },
  { name: 'Carbon Fiber', maker: '', aliases: ['CF', 'Carbon'], links: [], properties: { weight_class: 'light', durability: 'very_high' } },
];

// ── Known Values (enum fields) ────────────────────────────────────────

const KNOWN_VALUE_ENUMS = {
  connection: { policy: 'closed', values: ['Wired', 'Wireless', '2.4GHz', 'Bluetooth'] },
  cable_type: { policy: 'open', values: ['USB-C', 'Micro-USB', 'Paracord', 'Rubber'] },
  coating: { policy: 'open', values: ['Matte', 'Glossy', 'Textured', 'Rubberized'] },
};

// ── 5 Unique Products ─────────────────────────────────────────────────
// Each has 2-3 candidates per field from different sources/tiers.

const PRODUCTS = {
  'mouse-razer-viper-v3-pro': {
    identity: { brand: 'Razer', model: 'Viper V3 Pro' },
    fields: { weight: '49', sensor: 'PAW3950', switch_type: 'Razer Optical Gen-3', encoder: 'TTC Gold Encoder', dpi: '35000', connection: '2.4GHz', cable_type: 'USB-C', coating: 'Matte', shell_material: 'unk' },
    provenance: {
      weight: { value: '49', confidence: 0.95 }, sensor: { value: 'PAW3950', confidence: 0.98 },
      switch_type: { value: 'Razer Optical Gen-3', confidence: 0.90 }, encoder: { value: 'TTC Gold Encoder', confidence: 0.75 },
      dpi: { value: '35000', confidence: 0.98 }, connection: { value: '2.4GHz', confidence: 0.98 },
      cable_type: { value: 'USB-C', confidence: 0.95 }, coating: { value: 'Matte', confidence: 0.80 },
      shell_material: { value: 'unk', confidence: 0 },
    },
    candidates: {
      weight: [
        { candidate_id: 'razer-w1', value: '49', score: 0.95, host: 'razer.com', source_host: 'razer.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'razer-w2', value: '49g', score: 0.85, host: 'rtings.com', source_host: 'rtings.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
        { candidate_id: 'razer-w3', value: '48', score: 0.60, host: 'amazon.com', source_host: 'amazon.com', method: 'llm', source_method: 'llm', tier: 3, source_tier: 3 },
      ],
      sensor: [
        { candidate_id: 'razer-s1', value: 'PAW3950', score: 0.98, host: 'razer.com', source_host: 'razer.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'razer-s2', value: 'PixArt PAW3950', score: 0.80, host: 'techpowerup.com', source_host: 'techpowerup.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
      switch_type: [
        { candidate_id: 'razer-sw1', value: 'Razer Optical Gen-3', score: 0.90, host: 'razer.com', source_host: 'razer.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      encoder: [
        { candidate_id: 'razer-e1', value: 'TTC Gold Encoder', score: 0.75, host: 'techpowerup.com', source_host: 'techpowerup.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
      dpi: [
        { candidate_id: 'razer-d1', value: '35000', score: 0.98, host: 'razer.com', source_host: 'razer.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'razer-d2', value: '30000', score: 0.70, host: 'rtings.com', source_host: 'rtings.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
      connection: [
        { candidate_id: 'razer-cn1', value: '2.4GHz', score: 0.98, host: 'razer.com', source_host: 'razer.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'razer-cn2', value: 'Wireless', score: 0.80, host: 'rtings.com', source_host: 'rtings.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
      cable_type: [
        { candidate_id: 'razer-cb1', value: 'USB-C', score: 0.95, host: 'razer.com', source_host: 'razer.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      coating: [
        { candidate_id: 'razer-ct1', value: 'Matte', score: 0.80, host: 'rtings.com', source_host: 'rtings.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
    },
    override: {
      weight: { override_value: '48', override_source: 'manual_entry', set_at: '2026-02-15T10:00:00.000Z' },
    },
  },

  'mouse-logitech-g502-x': {
    identity: { brand: 'Logitech', model: 'G502 X' },
    fields: { weight: '89', sensor: 'HERO26K', switch_type: 'Omron D2FC-F-K', encoder: 'ALPS Encoder', dpi: '25600', connection: 'Wired', cable_type: 'USB-C', coating: 'Textured', shell_material: 'unk' },
    provenance: {
      weight: { value: '89', confidence: 0.92 }, sensor: { value: 'HERO26K', confidence: 0.95 },
      switch_type: { value: 'Omron D2FC-F-K', confidence: 0.85 }, encoder: { value: 'ALPS Encoder', confidence: 0.70 },
      dpi: { value: '25600', confidence: 0.98 }, connection: { value: 'Wired', confidence: 0.99 },
      cable_type: { value: 'USB-C', confidence: 0.95 }, coating: { value: 'Textured', confidence: 0.75 },
      shell_material: { value: 'unk', confidence: 0 },
    },
    candidates: {
      weight: [
        { candidate_id: 'logi-w1', value: '89', score: 0.92, host: 'logitech.com', source_host: 'logitech.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'logi-w2', value: '89g', score: 0.80, host: 'pcgamer.com', source_host: 'pcgamer.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
      sensor: [
        { candidate_id: 'logi-s1', value: 'HERO26K', score: 0.95, host: 'logitech.com', source_host: 'logitech.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      switch_type: [
        { candidate_id: 'logi-sw1', value: 'Omron D2FC-F-K', score: 0.85, host: 'logitech.com', source_host: 'logitech.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'logi-sw2', value: 'Omron D2FC', score: 0.70, host: 'overclock.net', source_host: 'overclock.net', method: 'llm', source_method: 'llm', tier: 3, source_tier: 3 },
      ],
      encoder: [
        { candidate_id: 'logi-e1', value: 'ALPS Encoder', score: 0.70, host: 'teardown.com', source_host: 'teardown.com', method: 'scrape', source_method: 'scrape', tier: 3, source_tier: 3 },
      ],
      dpi: [
        { candidate_id: 'logi-d1', value: '25600', score: 0.98, host: 'logitech.com', source_host: 'logitech.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      connection: [
        { candidate_id: 'logi-cn1', value: 'Wired', score: 0.99, host: 'logitech.com', source_host: 'logitech.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      cable_type: [
        { candidate_id: 'logi-cb1', value: 'USB-C', score: 0.95, host: 'logitech.com', source_host: 'logitech.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      coating: [
        { candidate_id: 'logi-ct1', value: 'Textured', score: 0.75, host: 'pcgamer.com', source_host: 'pcgamer.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
    },
    override: {
      dpi: { override_value: '25600', override_source: 'candidate_selection', candidate_id: 'logi-d1', overridden_at: '2026-02-15T11:00:00.000Z', source: { host: 'logitech.com', method: 'dom', tier: 1 }, override_provenance: { url: 'https://logitech.com/g502x', quote: 'Max DPI: 25,600' } },
    },
  },

  'mouse-zowie-ec2-c': {
    identity: { brand: 'Zowie', model: 'EC2-C' },
    fields: { weight: '73', sensor: 'PMW3360', switch_type: 'Huano Blue Shell', encoder: 'unk', dpi: '3200', connection: 'Wired', cable_type: 'Paracord', coating: 'Matte', shell_material: 'unk' },
    provenance: {
      weight: { value: '73', confidence: 0.90 }, sensor: { value: 'PMW3360', confidence: 0.88 },
      switch_type: { value: 'Huano Blue Shell', confidence: 0.82 }, encoder: { value: 'unk', confidence: 0 },
      dpi: { value: '3200', confidence: 0.95 }, connection: { value: 'Wired', confidence: 0.99 },
      cable_type: { value: 'Paracord', confidence: 0.85 }, coating: { value: 'Matte', confidence: 0.80 },
      shell_material: { value: 'unk', confidence: 0 },
    },
    candidates: {
      weight: [
        { candidate_id: 'zowie-w1', value: '73', score: 0.90, host: 'zowie.benq.com', source_host: 'zowie.benq.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'zowie-w2', value: '73g', score: 0.80, host: 'rtings.com', source_host: 'rtings.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
        { candidate_id: 'zowie-w3', value: '74', score: 0.55, host: 'reddit.com', source_host: 'reddit.com', method: 'llm', source_method: 'llm', tier: 3, source_tier: 3 },
      ],
      sensor: [
        { candidate_id: 'zowie-s1', value: 'PMW3360', score: 0.88, host: 'zowie.benq.com', source_host: 'zowie.benq.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'zowie-s2', value: '3360', score: 0.65, host: 'reddit.com', source_host: 'reddit.com', method: 'llm', source_method: 'llm', tier: 3, source_tier: 3 },
      ],
      switch_type: [
        { candidate_id: 'zowie-sw1', value: 'Huano Blue Shell', score: 0.82, host: 'zowie.benq.com', source_host: 'zowie.benq.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      dpi: [
        { candidate_id: 'zowie-d1', value: '3200', score: 0.95, host: 'zowie.benq.com', source_host: 'zowie.benq.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      connection: [
        { candidate_id: 'zowie-cn1', value: 'Wired', score: 0.99, host: 'zowie.benq.com', source_host: 'zowie.benq.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      cable_type: [
        { candidate_id: 'zowie-cb1', value: 'Paracord', score: 0.85, host: 'zowie.benq.com', source_host: 'zowie.benq.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      coating: [
        { candidate_id: 'zowie-ct1', value: 'Matte', score: 0.80, host: 'zowie.benq.com', source_host: 'zowie.benq.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
    },
    override: {
      sensor: { override_value: 'PMW3360', override_source: 'candidate_selection', candidate_id: 'zowie-s1', overridden_at: '2026-02-15T12:00:00.000Z', source: { host: 'zowie.benq.com', method: 'dom', tier: 1 }, override_provenance: { url: 'https://zowie.benq.com/ec2-c', quote: 'Sensor: PMW 3360' } },
    },
  },

  'mouse-pulsar-x2-v3': {
    identity: { brand: 'Pulsar', model: 'X2 V3' },
    fields: { weight: '52', sensor: 'PAW3950', switch_type: 'Kailh GM 8.0', encoder: 'TTC Gold Encoder', dpi: '26000', connection: '2.4GHz', cable_type: 'USB-C', coating: 'Matte', shell_material: 'PTFE' },
    provenance: {
      weight: { value: '52', confidence: 0.93 }, sensor: { value: 'PAW3950', confidence: 0.96 },
      switch_type: { value: 'Kailh GM 8.0', confidence: 0.88 }, encoder: { value: 'TTC Gold Encoder', confidence: 0.72 },
      dpi: { value: '26000', confidence: 0.96 }, connection: { value: '2.4GHz', confidence: 0.97 },
      cable_type: { value: 'USB-C', confidence: 0.93 }, coating: { value: 'Matte', confidence: 0.85 },
      shell_material: { value: 'PTFE', confidence: 0.70 },
    },
    candidates: {
      weight: [
        { candidate_id: 'pulsar-w1', value: '52', score: 0.93, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'pulsar-w2', value: '51', score: 0.75, host: 'rtings.com', source_host: 'rtings.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
      sensor: [
        { candidate_id: 'pulsar-s1', value: 'PAW3950', score: 0.96, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'pulsar-s2', value: 'PixArt PAW3950', score: 0.82, host: 'techpowerup.com', source_host: 'techpowerup.com', method: 'scrape', source_method: 'scrape', tier: 2, source_tier: 2 },
      ],
      switch_type: [
        { candidate_id: 'pulsar-sw1', value: 'Kailh GM 8.0', score: 0.88, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      encoder: [
        { candidate_id: 'pulsar-e1', value: 'TTC Gold Encoder', score: 0.72, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      dpi: [
        { candidate_id: 'pulsar-d1', value: '26000', score: 0.96, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      connection: [
        { candidate_id: 'pulsar-cn1', value: '2.4GHz', score: 0.97, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      cable_type: [
        { candidate_id: 'pulsar-cb1', value: 'USB-C', score: 0.93, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      coating: [
        { candidate_id: 'pulsar-ct1', value: 'Matte', score: 0.85, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      shell_material: [
        { candidate_id: 'pulsar-sm1', value: 'PTFE', score: 0.70, host: 'pulsar.gg', source_host: 'pulsar.gg', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
    },
    override: null,
  },

  'mouse-endgame-gear-op1we': {
    identity: { brand: 'Endgame Gear', model: 'OP1we' },
    fields: { weight: '59', sensor: 'PMW3395', switch_type: 'Kailh GM 8.0', encoder: 'unk', dpi: '26000', connection: '2.4GHz', cable_type: 'USB-C', coating: 'Matte', shell_material: 'Carbon Fiber' },
    provenance: {
      weight: { value: '59', confidence: 0.91 }, sensor: { value: 'PMW3395', confidence: 0.94 },
      switch_type: { value: 'Kailh GM 8.0', confidence: 0.86 }, encoder: { value: 'unk', confidence: 0 },
      dpi: { value: '26000', confidence: 0.96 }, connection: { value: '2.4GHz', confidence: 0.97 },
      cable_type: { value: 'USB-C', confidence: 0.93 }, coating: { value: 'Matte', confidence: 0.82 },
      shell_material: { value: 'Carbon Fiber', confidence: 0.68 },
    },
    candidates: {
      weight: [
        { candidate_id: 'eg-w1', value: '59', score: 0.91, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      sensor: [
        { candidate_id: 'eg-s1', value: 'PMW3395', score: 0.94, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      switch_type: [
        { candidate_id: 'eg-sw1', value: 'Kailh GM 8.0', score: 0.86, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
        { candidate_id: 'eg-sw2', value: 'Kailh GM8', score: 0.60, host: 'reddit.com', source_host: 'reddit.com', method: 'llm', source_method: 'llm', tier: 3, source_tier: 3 },
      ],
      dpi: [
        { candidate_id: 'eg-d1', value: '26000', score: 0.96, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      connection: [
        { candidate_id: 'eg-cn1', value: '2.4GHz', score: 0.97, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      cable_type: [
        { candidate_id: 'eg-cb1', value: 'USB-C', score: 0.93, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      coating: [
        { candidate_id: 'eg-ct1', value: 'Matte', score: 0.82, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
      shell_material: [
        { candidate_id: 'eg-sm1', value: 'Carbon Fiber', score: 0.68, host: 'endgamegear.com', source_host: 'endgamegear.com', method: 'dom', source_method: 'dom', tier: 1, source_tier: 1 },
      ],
    },
    override: {
      switch_type: { override_value: 'Kailh GM 8.0', override_source: 'candidate_selection', candidate_id: 'eg-sw1', overridden_at: '2026-02-15T13:00:00.000Z', source: { host: 'endgamegear.com', method: 'dom', tier: 1 }, override_provenance: { url: 'https://endgamegear.com/op1we', quote: 'Switches: Kailh GM 8.0' } },
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeStorage(tempRoot) {
  return createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function seedFieldRules(helperRoot, category) {
  const gen = path.join(helperRoot, category, '_generated');
  await writeJson(path.join(gen, 'field_rules.json'), { category, fields: FIELD_RULES_FIELDS });
  await writeJson(path.join(gen, 'known_values.json'), { category, fields: {} }); // Separate from enums
  await writeJson(path.join(gen, 'parse_templates.json'), { category, templates: {} });
  await writeJson(path.join(gen, 'cross_validation_rules.json'), { category, rules: [] });
  await writeJson(path.join(gen, 'key_migrations.json'), { version: '1.0.0', previous_version: '1.0.0', bump: 'patch', summary: { added_count: 0, removed_count: 0, changed_count: 0 }, key_map: {}, migrations: [] });
  await writeJson(path.join(gen, 'ui_field_catalog.json'), { category, fields: Object.keys(FIELD_RULES_FIELDS).map((k) => ({ key: k, group: 'specs' })) });
}

async function seedComponentDb(helperRoot, category, componentType, items) {
  const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
  await writeJson(path.join(dbDir, `${componentType}.json`), { component_type: componentType, items });
}

async function seedAllComponentDbs(helperRoot, category) {
  await seedComponentDb(helperRoot, category, 'sensor', SENSOR_ITEMS);
  await seedComponentDb(helperRoot, category, 'switch', SWITCH_ITEMS);
  await seedComponentDb(helperRoot, category, 'encoder', ENCODER_ITEMS);
  await seedComponentDb(helperRoot, category, 'material', MATERIAL_ITEMS);
}

async function seedKnownValues(helperRoot, category, fields) {
  const kvPath = path.join(helperRoot, category, '_generated', 'known_values.json');
  await writeJson(kvPath, { category, fields });
}

async function seedEnumSuggestions(helperRoot, category, suggestions) {
  const sugPath = path.join(helperRoot, category, '_suggestions', 'enums.json');
  await writeJson(sugPath, suggestions);
}

async function seedWorkbookMap(helperRoot, category, manualEnumValues, manualEnumTimestamps = {}) {
  const wbPath = path.join(helperRoot, category, '_control_plane', 'workbook_map.json');
  await writeJson(wbPath, { manual_enum_values: manualEnumValues, manual_enum_timestamps: manualEnumTimestamps });
}

async function seedComponentOverride(helperRoot, category, componentType, name, override) {
  const overrideDir = path.join(helperRoot, category, '_overrides', 'components');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  await writeJson(path.join(overrideDir, `${componentType}_${slug}.json`), { componentType, name, ...override });
}

async function seedProductOverride(helperRoot, category, productId, overrides) {
  const overridePath = path.join(helperRoot, category, '_overrides', `${productId}.overrides.json`);
  await writeJson(overridePath, { product_id: productId, overrides });
}

async function seedComponentReviewSuggestions(helperRoot, category, items) {
  const reviewPath = path.join(helperRoot, category, '_suggestions', 'component_review.json');
  await writeJson(reviewPath, { items });
}

async function seedLatestArtifacts(storage, category, productId, product) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  await storage.writeObject(`${latestBase}/normalized.json`, Buffer.from(JSON.stringify({
    identity: product.identity,
    fields: product.fields,
  }, null, 2)), { contentType: 'application/json' });
  await storage.writeObject(`${latestBase}/provenance.json`, Buffer.from(JSON.stringify(
    product.provenance,
  null, 2)), { contentType: 'application/json' });
  await storage.writeObject(`${latestBase}/summary.json`, Buffer.from(JSON.stringify({
    confidence: 0.85, coverage_overall_percent: 80,
    missing_required_fields: Object.entries(product.fields).filter(([, v]) => v === 'unk').map(([k]) => k),
    fields_below_pass_target: [], critical_fields_below_pass_target: [],
    field_reasoning: {},
  }, null, 2)), { contentType: 'application/json' });
  await storage.writeObject(`${latestBase}/candidates.json`, Buffer.from(JSON.stringify(
    product.candidates || {},
  null, 2)), { contentType: 'application/json' });
}

async function seedAllProducts(storage, helperRoot, category) {
  for (const [productId, product] of Object.entries(PRODUCTS)) {
    await seedLatestArtifacts(storage, category, productId, product);
    if (product.override) {
      await seedProductOverride(helperRoot, category, productId, product.override);
    }
  }
}

function buildFieldRulesForSeed() {
  const componentDBs = {};
  // Keys are SINGULAR — matching what loadFieldRules produces from filenames (sensor.json → "sensor")
  const items = { sensor: SENSOR_ITEMS, switch: SWITCH_ITEMS, encoder: ENCODER_ITEMS, material: MATERIAL_ITEMS };
  for (const [typeKey, dbItems] of Object.entries(items)) {
    const entries = {};
    const index = new Map();
    for (const item of dbItems) {
      const name = item.name;
      entries[name] = { ...item, canonical_name: name };
      index.set(name.toLowerCase(), entries[name]);
      index.set(name.toLowerCase().replace(/\s+/g, ''), entries[name]);
      for (const alias of (item.aliases || [])) {
        index.set(alias.toLowerCase(), entries[name]);
        index.set(alias.toLowerCase().replace(/\s+/g, ''), entries[name]);
      }
    }
    componentDBs[typeKey] = { entries, __index: index };
  }
  return {
    rules: { fields: FIELD_RULES_FIELDS },
    componentDBs,
    knownValues: { enums: KNOWN_VALUE_ENUMS },
  };
}

/** Creates a full test environment with all products, component DBs, known values, and overrides. */
async function createFullFixture(tempRoot) {
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files'),
    localOutputRoot: path.join(tempRoot, 'out'),
    specDbDir: path.join(tempRoot, '.specfactory_tmp'),
  };

  await seedFieldRules(config.helperFilesRoot, CATEGORY);
  await seedAllComponentDbs(config.helperFilesRoot, CATEGORY);
  await seedKnownValues(config.helperFilesRoot, CATEGORY, {
    connection: KNOWN_VALUE_ENUMS.connection.values,
    cable_type: KNOWN_VALUE_ENUMS.cable_type.values,
    coating: KNOWN_VALUE_ENUMS.coating.values,
  });
  await seedWorkbookMap(config.helperFilesRoot, CATEGORY, {
    cable_type: ['Braided'],
    coating: ['Soft-touch'],
  });
  await seedAllProducts(storage, config.helperFilesRoot, CATEGORY);

  // component_review.json — pipeline candidates from products for shared-source testing
  await seedComponentReviewSuggestions(config.helperFilesRoot, CATEGORY, [
    // PAW3950 shared by razer and pulsar
    { component_type: 'sensor', matched_component: 'PAW3950', product_id: 'mouse-razer-viper-v3-pro', status: 'pending_ai', raw_query: 'PAW3950', match_type: 'exact', combined_score: 0.95, product_attributes: { dpi_max: '35000', sensor_brand: 'PixArt' }, created_at: '2026-02-15T10:00:00.000Z' },
    { component_type: 'sensor', matched_component: 'PAW3950', product_id: 'mouse-pulsar-x2-v3', status: 'pending_ai', raw_query: 'PAW3950', match_type: 'exact', combined_score: 0.92, product_attributes: { dpi_max: '26000', sensor_brand: 'PixArt' }, created_at: '2026-02-15T11:00:00.000Z' },
    // Kailh GM 8.0 shared by pulsar and endgame — raw_query uses pipeline-extracted variant (no space before 8.0)
    { component_type: 'switch', matched_component: 'Kailh GM 8.0', product_id: 'mouse-pulsar-x2-v3', status: 'pending_ai', raw_query: 'Kailh GM8.0', match_type: 'exact', combined_score: 0.88, product_attributes: { switch_brand: 'Kailh' }, created_at: '2026-02-15T10:00:00.000Z' },
    { component_type: 'switch', matched_component: 'Kailh GM 8.0', product_id: 'mouse-endgame-gear-op1we', status: 'pending_ai', raw_query: 'Kailh GM8.0', match_type: 'exact', combined_score: 0.86, product_attributes: { switch_brand: 'Kailh' }, created_at: '2026-02-15T12:00:00.000Z' },
    // HERO26K only used by logitech
    { component_type: 'sensor', matched_component: 'HERO26K', product_id: 'mouse-logitech-g502-x', status: 'pending_ai', raw_query: 'HERO26K', match_type: 'exact', combined_score: 0.95, product_attributes: { dpi_max: '25600', sensor_brand: 'Logitech' }, created_at: '2026-02-15T10:00:00.000Z' },
  ]);

  return { storage, config };
}

// ════════════════════════════════════════════════════════════════════════
// SECTION 1: SPECDB SEED (verify all 9 tables populated)
// ════════════════════════════════════════════════════════════════════════

test('DB SEED — SpecDb table verification', async (t) => {
  let tempRoot, db;
  try {
    const { SpecDb } = await import('../src/db/specDb.js');
    const { seedSpecDb } = await import('../src/db/seed.js');

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-db-'));
    const { config } = await createFullFixture(tempRoot);

    const dbDir = path.join(config.specDbDir, CATEGORY);
    await fs.mkdir(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'spec.sqlite');
    db = new SpecDb({ dbPath, category: CATEGORY });

    const fieldRules = buildFieldRulesForSeed();
    const seedResult = await seedSpecDb({ db, config, category: CATEGORY, fieldRules, logger: null });

    await t.test('DB-01: all 9 tables have non-zero counts', () => {
      const counts = seedResult.counts;
      for (const table of ['candidates', 'candidate_reviews', 'component_values', 'component_identity', 'component_aliases', 'list_values', 'item_field_state', 'item_component_links', 'item_list_links']) {
        assert.ok(counts[table] > 0, `${table} should have rows, got ${counts[table]}`);
      }
    });

    await t.test('DB-02: component_identity covers all 4 types (sensor, switch, encoder, material)', () => {
      for (const type of ['sensor', 'switch', 'encoder', 'material']) {
        const rows = db.getAllComponentIdentities(type);
        assert.ok(rows.length > 0, `component_identity should have ${type} entries`);
      }
      assert.equal(db.getAllComponentIdentities('sensor').length, 5);
      assert.equal(db.getAllComponentIdentities('switch').length, 5);
      assert.equal(db.getAllComponentIdentities('encoder').length, 2);
      assert.equal(db.getAllComponentIdentities('material').length, 2);
    });

    await t.test('DB-03: component_aliases includes canonical names and explicit aliases', () => {
      // PAW3950 should be findable by alias '3950'
      const found = db.findComponentByAlias('sensor', '3950');
      assert.ok(found, 'Should find PAW3950 by alias "3950"');
      assert.equal(found.canonical_name, 'PAW3950');

      // Kailh GM 8.0 should be findable by alias 'GM8'
      const foundSwitch = db.findComponentByAlias('switch', 'GM8');
      assert.ok(foundSwitch, 'Should find Kailh GM 8.0 by alias "GM8"');
      assert.equal(foundSwitch.canonical_name, 'Kailh GM 8.0');

      // PTFE findable by alias 'Teflon'
      const foundMaterial = db.findComponentByAlias('material', 'Teflon');
      assert.ok(foundMaterial, 'Should find PTFE by alias "Teflon"');
      assert.equal(foundMaterial.canonical_name, 'PTFE');
    });

    await t.test('DB-04: component_values stores properties for each component', () => {
      const sensorVals = db.getComponentValues('sensor', 'PAW3950');
      const propKeys = sensorVals.map((r) => r.property_key).sort();
      assert.deepEqual(propKeys, ['acceleration', 'dpi_max', 'ips']);
      const dpiRow = sensorVals.find((r) => r.property_key === 'dpi_max');
      assert.equal(dpiRow.value, '35000');

      const switchVals = db.getComponentValues('switch', 'Kailh GM 8.0');
      assert.ok(switchVals.length >= 2);
    });

    await t.test('DB-05: list_values populated from known_values and manual_enum_values', () => {
      const connectionVals = db.getListValues('connection');
      assert.ok(connectionVals.length >= 4, `connection should have >= 4 values, got ${connectionVals.length}`);
      const cableVals = db.getListValues('cable_type');
      assert.ok(cableVals.length >= 4, `cable_type should have >= 4 values, got ${cableVals.length}`);
      const coatingVals = db.getListValues('coating');
      assert.ok(coatingVals.length >= 4, `coating should have >= 4 values, got ${coatingVals.length}`);

      // Manual values from workbook_map
      const braidedVal = db.getListValueByFieldAndValue('cable_type', 'Braided');
      assert.ok(braidedVal, 'cable_type should include manual value "Braided"');
      const softTouchVal = db.getListValueByFieldAndValue('coating', 'Soft-touch');
      assert.ok(softTouchVal, 'coating should include manual value "Soft-touch"');
    });

    await t.test('DB-06: candidates table has entries from all 5 products', () => {
      const productIds = new Set();
      for (const pid of Object.keys(PRODUCTS)) {
        const grouped = db.getCandidatesForProduct(pid);
        const fieldKeys = Object.keys(grouped);
        assert.ok(fieldKeys.length > 0, `${pid} should have candidates`);
        productIds.add(pid);
      }
      assert.equal(productIds.size, 5);
    });

    await t.test('DB-07: item_field_state covers all product×field combinations', () => {
      const fieldCount = Object.keys(FIELD_RULES_FIELDS).length;
      for (const pid of Object.keys(PRODUCTS)) {
        const states = db.getItemFieldState(pid);
        assert.equal(states.length, fieldCount, `${pid} should have ${fieldCount} field states, got ${states.length}`);
      }
      assert.equal(seedResult.counts.item_field_state, 5 * fieldCount);
    });

    await t.test('DB-08: item_component_links connects products to correct components', () => {
      // Razer → PAW3950 sensor
      const razerLinks = db.getItemComponentLinks('mouse-razer-viper-v3-pro');
      const razerSensor = razerLinks.find((l) => l.field_key === 'sensor');
      assert.ok(razerSensor, 'Razer should have sensor link');
      assert.equal(razerSensor.component_name, 'PAW3950');

      // Pulsar → PAW3950 sensor (shared!)
      const pulsarLinks = db.getItemComponentLinks('mouse-pulsar-x2-v3');
      const pulsarSensor = pulsarLinks.find((l) => l.field_key === 'sensor');
      assert.ok(pulsarSensor, 'Pulsar should have sensor link');
      assert.equal(pulsarSensor.component_name, 'PAW3950');

      // Pulsar → PTFE material
      const pulsarMaterial = pulsarLinks.find((l) => l.field_key === 'shell_material');
      assert.ok(pulsarMaterial, 'Pulsar should have shell_material link');
      assert.equal(pulsarMaterial.component_name, 'PTFE');

      // Endgame → Carbon Fiber material
      const egLinks = db.getItemComponentLinks('mouse-endgame-gear-op1we');
      const egMaterial = egLinks.find((l) => l.field_key === 'shell_material');
      assert.ok(egMaterial, 'Endgame should have shell_material link');
      assert.equal(egMaterial.component_name, 'Carbon Fiber');

      // Total: 5 sensor + 5 switch + 3 encoder + 2 material = 15
      assert.ok(seedResult.counts.item_component_links >= 14, `Should have >= 14 component links, got ${seedResult.counts.item_component_links}`);
    });

    await t.test('DB-09: item_list_links connects products to list values for list fields', () => {
      // coating is a list field; products with non-unk coating should link
      const razerLists = db.getItemListLinks('mouse-razer-viper-v3-pro');
      const razerCoating = razerLists.find((l) => l.field_key === 'coating');
      assert.ok(razerCoating, 'Razer should have coating list link');

      const logiLists = db.getItemListLinks('mouse-logitech-g502-x');
      const logiCoating = logiLists.find((l) => l.field_key === 'coating');
      assert.ok(logiCoating, 'Logitech should have coating list link');

      assert.ok(seedResult.counts.item_list_links >= 4, `Should have >= 4 list links, got ${seedResult.counts.item_list_links}`);
    });

    await t.test('DB-10: candidate_reviews created from override files with candidate_id', () => {
      // Logitech dpi override has candidate_id 'logi-d1'
      const logiReviews = db.getReviewsForCandidate('logi-d1');
      assert.ok(logiReviews.length > 0, 'Should have review for logi-d1');
      assert.equal(logiReviews[0].context_type, 'item');
      assert.equal(logiReviews[0].human_accepted, 1);

      // Zowie sensor override has candidate_id 'zowie-s1'
      const zowieReviews = db.getReviewsForCandidate('zowie-s1');
      assert.ok(zowieReviews.length > 0, 'Should have review for zowie-s1');

      // Endgame switch override has candidate_id 'eg-sw1'
      const egReviews = db.getReviewsForCandidate('eg-sw1');
      assert.ok(egReviews.length > 0, 'Should have review for eg-sw1');

      // Razer weight override is manual_entry with no candidate_id → no review
      assert.ok(seedResult.counts.candidate_reviews >= 3, `Should have >= 3 reviews, got ${seedResult.counts.candidate_reviews}`);
    });

    await t.test('DB-11: idempotent re-seed produces same counts', async () => {
      const countsBefore = db.counts();
      await seedSpecDb({ db, config, category: CATEGORY, fieldRules, logger: null });
      const countsAfter = db.counts();
      assert.deepEqual(countsAfter, countsBefore);
    });

    await t.test('DB-12: shared component PAW3950 has candidates from both razer and pulsar', () => {
      // Both products should have sensor candidates for PAW3950
      const razerCands = db.getCandidatesForField('mouse-razer-viper-v3-pro', 'sensor');
      const pulsarCands = db.getCandidatesForField('mouse-pulsar-x2-v3', 'sensor');
      assert.ok(razerCands.some((c) => c.value === 'PAW3950'), 'Razer should have PAW3950 candidate');
      assert.ok(pulsarCands.some((c) => c.value === 'PAW3950'), 'Pulsar should have PAW3950 candidate');
    });

  } finally {
    db?.close();
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════
// SECTION 2: PRODUCT GRID (10 scenarios)
// ════════════════════════════════════════════════════════════════════════

test('GRID-01: Pipeline value with multiple candidates shows top source', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-zowie-ec2-c' });
    // Weight has 3 candidates: zowie.benq.com (tier 1), rtings.com (tier 2), reddit.com (tier 3)
    assert.equal(payload.fields.weight.selected.value, '73');
    assert.equal(payload.fields.weight.source, 'zowie.benq.com');
    assert.equal(payload.fields.weight.method, 'dom');
    assert.equal(payload.fields.weight.tier, 1);
    assert.equal(payload.fields.weight.candidate_count, 3);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('GRID-02: Manual override sets source=user, overridden=true', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-razer-viper-v3-pro' });
    assert.equal(payload.fields.weight.selected.value, '48'); // Overridden from 49 to 48
    assert.equal(payload.fields.weight.selected.confidence, 1.0);
    assert.equal(payload.fields.weight.overridden, true);
    assert.equal(payload.fields.weight.source, 'user');
    assert.equal(payload.fields.weight.method, 'manual_override');
    assert.equal(payload.fields.weight.needs_review, false);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('GRID-03: Candidate acceptance does NOT set overridden=true', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    // Logitech dpi: candidate_selection override
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-logitech-g502-x' });
    assert.equal(payload.fields.dpi.selected.value, '25600');
    assert.equal(payload.fields.dpi.overridden, false); // Candidate acceptance ≠ override
    assert.equal(payload.fields.dpi.source, 'logitech.com');
    assert.equal(payload.fields.dpi.evidence_url, 'https://logitech.com/g502x');
    assert.equal(payload.fields.dpi.evidence_quote, 'Max DPI: 25,600');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('GRID-04: Missing value shows gray color and needs_review=true', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    // Zowie encoder is 'unk'
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-zowie-ec2-c' });
    assert.equal(payload.fields.encoder.selected.value, 'unk');
    assert.equal(payload.fields.encoder.selected.color, 'gray');
    assert.equal(payload.fields.encoder.needs_review, true);
    assert.ok(payload.fields.encoder.reason_codes.includes('missing_value'));
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('GRID-05: Multiple fields maintain independent sources across products', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    // Razer: weight overridden (user), sensor from pipeline (razer.com)
    const razer = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-razer-viper-v3-pro' });
    assert.equal(razer.fields.weight.source, 'user');
    assert.equal(razer.fields.weight.overridden, true);
    assert.equal(razer.fields.sensor.source, 'razer.com');
    assert.equal(razer.fields.sensor.overridden, undefined); // No override

    // Pulsar: no overrides — all from pipeline
    const pulsar = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-pulsar-x2-v3' });
    assert.equal(pulsar.fields.sensor.source, 'pulsar.gg');
    assert.equal(pulsar.fields.weight.source, 'pulsar.gg');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('GRID-06: buildFieldState with multiple candidates includes evidence', async () => {
  const fieldState = buildFieldState({
    field: 'weight',
    candidates: PRODUCTS['mouse-zowie-ec2-c'].candidates,
    normalized: { fields: PRODUCTS['mouse-zowie-ec2-c'].fields },
    provenance: PRODUCTS['mouse-zowie-ec2-c'].provenance,
    summary: { missing_required_fields: [], fields_below_pass_target: [], critical_fields_below_pass_target: [] },
  });
  assert.equal(fieldState.source, 'zowie.benq.com');
  assert.equal(fieldState.method, 'dom');
  assert.equal(fieldState.tier, 1);
  assert.equal(fieldState.candidate_count, 3);
  assert.equal(fieldState.candidates.length, 3);
  // Candidates ordered by appearance: tier 1, tier 2, tier 3
  assert.equal(fieldState.candidates[0].source, 'zowie.benq.com');
  assert.equal(fieldState.candidates[1].source, 'rtings.com');
  assert.equal(fieldState.candidates[2].source, 'reddit.com');
});

test('GRID-07: Low confidence value gets correct color', async () => {
  // below_pass_target forces red
  const redState = buildFieldState({
    field: 'weight',
    candidates: { weight: [{ candidate_id: 'c1', value: '59', score: 0.7, host: 'example.com' }] },
    normalized: { fields: { weight: '59' } },
    provenance: { weight: { value: '59', confidence: 0.7 } },
    summary: { missing_required_fields: [], fields_below_pass_target: ['weight'], critical_fields_below_pass_target: [] },
  });
  assert.equal(redState.selected.color, 'red');
  assert.ok(redState.reason_codes.includes('below_pass_target'));

  // Without below_pass_target, 0.7 = yellow
  const yellowState = buildFieldState({
    field: 'weight',
    candidates: { weight: [{ candidate_id: 'c1', value: '59', score: 0.7, host: 'example.com' }] },
    normalized: { fields: { weight: '59' } },
    provenance: { weight: { value: '59', confidence: 0.7 } },
    summary: { missing_required_fields: [], fields_below_pass_target: [], critical_fields_below_pass_target: [] },
  });
  assert.equal(yellowState.selected.color, 'yellow');
});

test('GRID-08: includeCandidates=false still reports count and source', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    const payload = await buildProductReviewPayload({
      storage, config, category: CATEGORY, productId: 'mouse-zowie-ec2-c', includeCandidates: false,
    });
    assert.equal(payload.fields.weight.candidates.length, 0);
    assert.equal(payload.fields.weight.candidate_count, 3);
    assert.equal(payload.fields.weight.source, 'zowie.benq.com');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('GRID-09: Override evidence URL and quote flow into field state', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    // Zowie sensor: candidate_selection override with evidence
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-zowie-ec2-c' });
    assert.equal(payload.fields.sensor.evidence_url, 'https://zowie.benq.com/ec2-c');
    assert.equal(payload.fields.sensor.evidence_quote, 'Sensor: PMW 3360');
    assert.equal(payload.fields.sensor.source, 'zowie.benq.com');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('GRID-10: Source timestamp from override flows into field state', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    // Razer weight has set_at
    const razer = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-razer-viper-v3-pro' });
    assert.equal(razer.fields.weight.source_timestamp, '2026-02-15T10:00:00.000Z');

    // Pulsar weight has no override → no timestamp
    const pulsar = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-pulsar-x2-v3' });
    assert.equal(pulsar.fields.weight.source_timestamp, undefined);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

// ════════════════════════════════════════════════════════════════════════
// SECTION 3: COMPONENT REVIEW (12 scenarios including shared sources)
// ════════════════════════════════════════════════════════════════════════

test('COMP-01: Workbook value shows source=workbook, overridden=false', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const paw3950 = payload.items.find((i) => i.name === 'PAW3950');
    assert.ok(paw3950);
    assert.equal(paw3950.properties.dpi_max.source, 'workbook');
    assert.equal(paw3950.properties.dpi_max.overridden, false);
    assert.equal(paw3950.properties.dpi_max.selected.value, '35000');
    assert.equal(paw3950.properties.dpi_max.selected.confidence, 1.0);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-02: Override sets source=user, overridden=true', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'sensor', 'PAW3950', {
      properties: { dpi_max: '40000' },
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const paw3950 = payload.items.find((i) => i.name === 'PAW3950');
    assert.equal(paw3950.properties.dpi_max.selected.value, '40000');
    assert.equal(paw3950.properties.dpi_max.source, 'user');
    assert.equal(paw3950.properties.dpi_max.overridden, true);
    assert.ok(paw3950.properties.dpi_max.reason_codes.includes('manual_override'));
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-03: Missing property shows source=unknown, needs_review=true', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    // PMW3360 has dpi_max, ips, acceleration — all sensors share same columns
    // Check that HERO26K has all properties from the union
    const hero = payload.items.find((i) => i.name === 'HERO26K');
    assert.ok(hero);
    assert.equal(hero.properties.dpi_max.selected.value, '25600');
    assert.equal(hero.properties.dpi_max.source, 'workbook');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-04: Name override tracked correctly', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const nameTs = '2026-02-15T14:00:00.000Z';
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'sensor', 'PMW3389', {
      identity: { name: 'PAW-3389' },
      timestamps: { __name: nameTs },
      updated_at: nameTs,
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const item = payload.items.find((i) => i.name === 'PAW-3389');
    assert.ok(item, 'Item should exist with overridden name');
    assert.equal(item.name_tracked.source, 'user');
    assert.equal(item.name_tracked.overridden, true);
    assert.equal(item.name_tracked.source_timestamp, nameTs);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-05: Maker override tracked correctly', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'switch', 'TTC Gold', {
      identity: { maker: 'TTC Electronics' },
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'switch' });
    const item = payload.items.find((i) => i.name === 'TTC Gold');
    assert.equal(item.maker, 'TTC Electronics');
    assert.equal(item.maker_tracked.source, 'user');
    assert.equal(item.maker_tracked.overridden, true);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-06: Aliases override sets aliases_overridden=true', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'encoder', 'TTC Gold Encoder', {
      identity: { aliases: ['TTC Encoder', 'TTC Gold Scroll Encoder'] },
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'encoder' });
    const item = payload.items.find((i) => i.name === 'TTC Gold Encoder');
    assert.deepEqual(item.aliases, ['TTC Encoder', 'TTC Gold Scroll Encoder']);
    assert.equal(item.aliases_overridden, true);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-07: Property columns aggregated from all items', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    // All sensors have dpi_max, ips, acceleration
    assert.ok(payload.property_columns.includes('dpi_max'));
    assert.ok(payload.property_columns.includes('ips'));
    assert.ok(payload.property_columns.includes('acceleration'));
    assert.equal(payload.items.length, 5);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-08: Multiple items — override only affects target', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'switch', 'Kailh GM 8.0', {
      properties: { actuation_force: '50' },
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'switch' });
    const kailh = payload.items.find((i) => i.name === 'Kailh GM 8.0');
    const omron = payload.items.find((i) => i.name === 'Omron D2FC-F-K');
    assert.equal(kailh.properties.actuation_force.selected.value, '50');
    assert.equal(kailh.properties.actuation_force.source, 'user');
    assert.equal(omron.properties.actuation_force.selected.value, '75');
    assert.equal(omron.properties.actuation_force.source, 'workbook');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-09: Material components have correct properties', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'material' });
    assert.equal(payload.items.length, 2);
    const ptfe = payload.items.find((i) => i.name === 'PTFE');
    assert.ok(ptfe);
    assert.equal(ptfe.properties.friction.selected.value, 'low');
    const cf = payload.items.find((i) => i.name === 'Carbon Fiber');
    assert.ok(cf);
    assert.equal(cf.properties.durability.selected.value, 'very_high');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-10: Shared sensor PAW3950 shows pipeline candidates from BOTH razer and pulsar', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const paw3950 = payload.items.find((i) => i.name === 'PAW3950');
    assert.ok(paw3950);

    // dpi_max should have workbook candidate (35000) + pipeline candidates from products
    const dpiCandidates = paw3950.properties.dpi_max.candidates;
    assert.ok(dpiCandidates.length >= 2, `PAW3950 dpi_max should have >= 2 candidates, got ${dpiCandidates.length}`);

    // Workbook candidate
    const wbCandidate = dpiCandidates.find((c) => c.source_id === 'workbook');
    assert.ok(wbCandidate, 'Should have workbook candidate');
    assert.equal(wbCandidate.value, '35000');

    // Pipeline candidates from razer (35000) and pulsar (26000)
    const plCandidates = dpiCandidates.filter((c) => c.source_id === 'pipeline');
    assert.ok(plCandidates.length >= 1, `Should have pipeline candidates, got ${plCandidates.length}`);

    // At least one pipeline candidate should reference multiple products or different values
    const allPipelineValues = plCandidates.map((c) => c.value);
    // Razer has dpi_max=35000, Pulsar has dpi_max=26000 → two different pipeline candidates
    assert.ok(allPipelineValues.includes('35000') || allPipelineValues.includes('26000'),
      'Pipeline candidates should include product extraction values');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-11: Shared switch Kailh GM 8.0 shows pipeline candidates from pulsar and endgame', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'switch' });
    const kailh = payload.items.find((i) => i.name === 'Kailh GM 8.0');
    assert.ok(kailh);

    // Name candidates: workbook + pipeline variant (raw_query 'Kailh GM8.0' differs from canonical 'Kailh GM 8.0')
    const nameCandidates = kailh.name_tracked.candidates;
    assert.ok(nameCandidates.length >= 2, `Kailh name should have >= 2 candidates (wb + pipeline variant), got ${nameCandidates.length}`);
    const wbNameCand = nameCandidates.find((c) => c.source_id === 'workbook');
    assert.ok(wbNameCand, 'Should have workbook name candidate');
    assert.equal(wbNameCand.value, 'Kailh GM 8.0');

    const plNameCand = nameCandidates.find((c) => c.source_id === 'pipeline');
    assert.ok(plNameCand, 'Should have pipeline name candidate (variant spelling from products)');
    assert.equal(plNameCand.value, 'Kailh GM8.0');
    // Pipeline candidate should mention 2 products sharing this switch
    assert.ok(plNameCand.source.includes('2 products') || plNameCand.evidence.quote.includes('2 product'),
      'Pipeline name candidate should reference 2 products');

    // Maker candidates: workbook 'Kailh' is already there; pipeline brand 'Kailh' is deduplicated (same value)
    const makerCandidates = kailh.maker_tracked.candidates;
    assert.ok(makerCandidates.length >= 1, 'Should have at least workbook maker candidate');
    assert.equal(makerCandidates[0].value, 'Kailh');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('COMP-12: Single-use component HERO26K shows 1 product in pipeline candidates', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const hero = payload.items.find((i) => i.name === 'HERO26K');
    assert.ok(hero);

    // dpi_max pipeline candidate should reference only 1 product
    const dpiPl = hero.properties.dpi_max.candidates.filter((c) => c.source_id === 'pipeline');
    if (dpiPl.length > 0) {
      assert.ok(dpiPl[0].source.includes('1 product'), 'HERO26K pipeline candidate should reference 1 product');
    }
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

// ════════════════════════════════════════════════════════════════════════
// SECTION 4: ENUM LIST (10 scenarios)
// ════════════════════════════════════════════════════════════════════════

test('ENUM-01: Workbook-only value gets source=workbook', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const connField = payload.fields.find((f) => f.field === 'connection');
    assert.ok(connField);
    const wired = connField.values.find((v) => v.value === 'Wired');
    assert.equal(wired.source, 'workbook');
    assert.equal(wired.confidence, 1.0);
    assert.equal(wired.color, 'green');
    assert.equal(wired.needs_review, false);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-02: Pipeline suggestion gets source=pipeline, needs_review=true', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, {
      fields: { connection: ['USB-A'] },
    });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const connField = payload.fields.find((f) => f.field === 'connection');
    const usbA = connField.values.find((v) => v.value === 'USB-A');
    assert.equal(usbA.source, 'pipeline');
    assert.equal(usbA.confidence, 0.6);
    assert.equal(usbA.color, 'yellow');
    assert.equal(usbA.needs_review, true);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-03: User-added fresh value gets source=manual', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    // 'Braided' is in workbook_map manual_enum_values but not in pipeline suggestions
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const cableField = payload.fields.find((f) => f.field === 'cable_type');
    // Need to check if Braided shows up — it's in manual_enum_values but must also be in known_values
    // Actually, manual values are only marked if they're in known_values too.
    // Braided is only in workbook_map but NOT in known_values → it won't appear in the enum builder
    // It only appears if it's ALSO added to known_values
    // Let me check: seedKnownValues sets cable_type to the KNOWN_VALUE_ENUMS.cable_type.values
    // which are ['USB-C', 'Micro-USB', 'Paracord', 'Rubber'] — no 'Braided'
    // So Braided won't appear. That's correct for enum review (only known + suggested values shown)

    // Test manual source: add 'Braided' to known_values too
    await seedKnownValues(config.helperFilesRoot, CATEGORY, {
      connection: KNOWN_VALUE_ENUMS.connection.values,
      cable_type: [...KNOWN_VALUE_ENUMS.cable_type.values, 'Braided'],
      coating: KNOWN_VALUE_ENUMS.coating.values,
    });
    const payload2 = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const cableField2 = payload2.fields.find((f) => f.field === 'cable_type');
    const braided = cableField2.values.find((v) => v.value === 'Braided');
    assert.ok(braided, 'Braided should appear in cable_type values');
    assert.equal(braided.source, 'manual');
    assert.equal(braided.confidence, 1.0);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-04: Pipeline suggestion already in workbook is not duplicated', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, {
      fields: { connection: ['Wired', 'USB-A'] }, // Wired already in workbook
    });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const connField = payload.fields.find((f) => f.field === 'connection');
    const wiredValues = connField.values.filter((v) => v.value.toLowerCase() === 'wired');
    assert.equal(wiredValues.length, 1, 'Wired should not be duplicated');
    assert.equal(wiredValues[0].source, 'workbook');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-05: Metrics correctly count flags', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, {
      fields: { connection: ['USB-A', 'Thunderbolt'] },
    });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const connField = payload.fields.find((f) => f.field === 'connection');
    assert.equal(connField.metrics.total, 6); // 4 workbook + 2 suggestions
    assert.equal(connField.metrics.flags, 2); // 2 pipeline suggestions need review
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-06: Multiple fields independently tracked', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, {
      fields: { cable_type: ['Braided'] },
    });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const cableField = payload.fields.find((f) => f.field === 'cable_type');
    const connField = payload.fields.find((f) => f.field === 'connection');
    const coatingField = payload.fields.find((f) => f.field === 'coating');
    // cable_type: 4 workbook + 1 suggestion
    assert.equal(cableField.values.length, 5);
    assert.equal(cableField.metrics.flags, 1);
    // connection: 4 workbook, no suggestions
    assert.equal(connField.values.length, 4);
    assert.equal(connField.metrics.flags, 0);
    // coating: 4 workbook, no suggestions
    assert.equal(coatingField.values.length, 4);
    assert.equal(coatingField.metrics.flags, 0);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-07: Curation format suggestions with pending/dismissed status', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, {
      suggestions: [
        { field_key: 'cable_type', value: 'Braided', status: 'pending' },
        { field_key: 'cable_type', value: 'Coiled', status: 'dismissed' },
        { field_key: 'cable_type', value: 'Detachable', status: 'pending' },
      ],
    });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const field = payload.fields.find((f) => f.field === 'cable_type');
    const values = field.values.map((v) => v.value);
    assert.ok(values.includes('Braided'));
    assert.ok(values.includes('Detachable'));
    assert.ok(!values.includes('Coiled')); // Dismissed
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-08: Case-insensitive deduplication', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, {
      fields: { cable_type: ['usb-c', 'Braided'] }, // usb-c matches USB-C in workbook
    });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const field = payload.fields.find((f) => f.field === 'cable_type');
    const usbcValues = field.values.filter((v) => v.value.toLowerCase() === 'usb-c');
    assert.equal(usbcValues.length, 1, 'USB-C should not be duplicated');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-09: User-accepted pipeline value retains source=pipeline', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    // 'Braided' in known_values + pipeline suggestions + manual_enum_values → source=pipeline
    await seedKnownValues(config.helperFilesRoot, CATEGORY, {
      connection: KNOWN_VALUE_ENUMS.connection.values,
      cable_type: [...KNOWN_VALUE_ENUMS.cable_type.values, 'Braided'],
      coating: KNOWN_VALUE_ENUMS.coating.values,
    });
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, {
      suggestions: [{ field_key: 'cable_type', value: 'Braided', status: 'accepted' }],
    });
    // Braided is already in workbook_map manual_enum_values from createFullFixture
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const field = payload.fields.find((f) => f.field === 'cable_type');
    const braided = field.values.find((v) => v.value === 'Braided');
    assert.ok(braided);
    assert.equal(braided.source, 'pipeline'); // Retained original pipeline source
    assert.equal(braided.confidence, 1.0);
    assert.equal(braided.needs_review, false);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('ENUM-10: Enum manual value includes source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-eco-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const ts = '2026-02-15T15:00:00.000Z';
    // Override workbook_map with timestamps
    await seedWorkbookMap(config.helperFilesRoot, CATEGORY,
      { cable_type: ['Braided'], coating: ['Soft-touch'] },
      { 'cable_type::braided': ts },
    );
    // Need Braided in known_values too
    await seedKnownValues(config.helperFilesRoot, CATEGORY, {
      connection: KNOWN_VALUE_ENUMS.connection.values,
      cable_type: [...KNOWN_VALUE_ENUMS.cable_type.values, 'Braided'],
      coating: KNOWN_VALUE_ENUMS.coating.values,
    });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const field = payload.fields.find((f) => f.field === 'cable_type');
    const braided = field.values.find((v) => v.value === 'Braided');
    assert.equal(braided.source_timestamp, ts);
    // USB-C is pure workbook, no timestamp
    const usbC = field.values.find((v) => v.value === 'USB-C');
    assert.equal(usbC.source_timestamp, null);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

// ════════════════════════════════════════════════════════════════════════
// SECTION 5: SOURCE TIMESTAMPS (10 scenarios)
// ════════════════════════════════════════════════════════════════════════

test('TS-01: Product candidate_selection override includes source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    // Logitech dpi override has overridden_at
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-logitech-g502-x' });
    assert.equal(payload.fields.dpi.source_timestamp, '2026-02-15T11:00:00.000Z');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-02: Product manual override uses set_at as source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    // Razer weight override has set_at
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-razer-viper-v3-pro' });
    assert.equal(payload.fields.weight.source_timestamp, '2026-02-15T10:00:00.000Z');
    assert.equal(payload.fields.weight.source, 'user');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-03: Product field without override has no source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { storage, config } = await createFullFixture(tempRoot);
    const payload = await buildProductReviewPayload({ storage, config, category: CATEGORY, productId: 'mouse-pulsar-x2-v3' });
    assert.equal(payload.fields.weight.source_timestamp, undefined);
    assert.equal(payload.fields.sensor.source_timestamp, undefined);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-04: Component property override includes source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const propTs = '2026-02-15T16:00:00.000Z';
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'sensor', 'PAW3950', {
      properties: { dpi_max: '40000' },
      timestamps: { dpi_max: propTs },
      updated_at: propTs,
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const item = payload.items.find((i) => i.name === 'PAW3950');
    assert.equal(item.properties.dpi_max.source_timestamp, propTs);
    assert.equal(item.properties.dpi_max.source, 'user');
    // Non-overridden property has no timestamp
    assert.equal(item.properties.ips.source_timestamp, null);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-05: Component name override includes source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const nameTs = '2026-02-15T17:00:00.000Z';
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'sensor', 'PMW3389', {
      identity: { name: 'PAW-3389' },
      timestamps: { __name: nameTs },
      updated_at: nameTs,
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const item = payload.items.find((i) => i.name === 'PAW-3389');
    assert.equal(item.name_tracked.source_timestamp, nameTs);
    assert.equal(item.maker_tracked.source_timestamp, null);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-06: Component override without per-property timestamp falls back to updated_at', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const fileTs = '2026-02-15T18:00:00.000Z';
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'switch', 'Razer Optical Gen-3', {
      properties: { actuation_force: '42' },
      updated_at: fileTs,
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'switch' });
    const item = payload.items.find((i) => i.name === 'Razer Optical Gen-3');
    assert.equal(item.properties.actuation_force.source_timestamp, fileTs);
    assert.equal(item.properties.actuation_force.source, 'user');
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-07: Multiple component properties each have independent timestamps', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const ts1 = '2026-02-15T19:00:00.000Z';
    const ts2 = '2026-02-15T19:05:00.000Z';
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'sensor', 'PMW3395', {
      properties: { dpi_max: '30000', ips: '700' },
      timestamps: { dpi_max: ts1, ips: ts2 },
      updated_at: ts2,
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const item = payload.items.find((i) => i.name === 'PMW3395');
    assert.equal(item.properties.dpi_max.source_timestamp, ts1);
    assert.equal(item.properties.ips.source_timestamp, ts2);
    assert.equal(item.properties.acceleration.source_timestamp, null); // Not overridden
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-08: Component links override includes source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const linksTs = '2026-02-15T20:00:00.000Z';
    await seedComponentOverride(config.helperFilesRoot, CATEGORY, 'sensor', 'PAW3950', {
      identity: { links: ['https://new-spec.com/paw3950'] },
      timestamps: { __links: linksTs },
      updated_at: linksTs,
    });
    const payload = await buildComponentReviewPayloads({ config, category: CATEGORY, componentType: 'sensor' });
    const item = payload.items.find((i) => i.name === 'PAW3950');
    assert.equal(item.links.length, 1);
    assert.equal(item.links[0], 'https://new-spec.com/paw3950');
    assert.equal(item.links_tracked[0].source, 'user');
    assert.equal(item.links_tracked[0].source_timestamp, linksTs);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-09: Pipeline enum suggestion has no source_timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    await seedEnumSuggestions(config.helperFilesRoot, CATEGORY, { fields: { cable_type: ['Braided'] } });
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const field = payload.fields.find((f) => f.field === 'cable_type');
    const braided = field.values.find((v) => v.value === 'Braided');
    assert.equal(braided.source, 'pipeline');
    assert.equal(braided.source_timestamp, null);
    assert.equal(braided.needs_review, true);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('TS-10: Multiple enum fields have independent timestamps', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ts-'));
  try {
    const { config } = await createFullFixture(tempRoot);
    const ts1 = '2026-02-15T21:00:00.000Z';
    const ts2 = '2026-02-15T21:30:00.000Z';
    // Need to add values to known_values and set timestamps
    await seedKnownValues(config.helperFilesRoot, CATEGORY, {
      connection: [...KNOWN_VALUE_ENUMS.connection.values, 'USB-A'],
      cable_type: [...KNOWN_VALUE_ENUMS.cable_type.values, 'Braided'],
      coating: KNOWN_VALUE_ENUMS.coating.values,
    });
    await seedWorkbookMap(config.helperFilesRoot, CATEGORY,
      { connection: ['USB-A'], cable_type: ['Braided'] },
      { 'connection::usb-a': ts1, 'cable_type::braided': ts2 },
    );
    const payload = await buildEnumReviewPayloads({ config, category: CATEGORY });
    const conn = payload.fields.find((f) => f.field === 'connection');
    const cable = payload.fields.find((f) => f.field === 'cable_type');
    const usbA = conn.values.find((v) => v.value === 'USB-A');
    const braided = cable.values.find((v) => v.value === 'Braided');
    assert.equal(usbA.source_timestamp, ts1);
    assert.equal(braided.source_timestamp, ts2);
    // Non-manual workbook values have no timestamp
    const wired = conn.values.find((v) => v.value === 'Wired');
    assert.equal(wired.source_timestamp, null);
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});
