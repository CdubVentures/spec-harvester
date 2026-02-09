import {
  BOOLEAN_FIELDS,
  LIST_FIELDS,
  NUMERIC_FIELDS
} from '../constants.js';
import {
  formatDateMmDdYyyy,
  getByPath,
  normalizeBooleanValue,
  normalizeToken,
  normalizeWhitespace,
  parseNumber,
  splitListValue
} from '../utils/common.js';
import { extractDomFallback } from './domFallbackExtractor.js';

const FIELD_ALIASES = {
  id: ['id', 'productid'],
  brand: ['brand', 'manufacturer'],
  model: ['model', 'productname', 'name'],
  base_model: ['basemodel'],
  release_date: ['releasedate', 'released', 'launchdate'],
  discontinued: ['discontinued'],
  sku: ['sku', 'partnumber', 'part_number'],
  colors: ['color', 'colour'],
  design: ['design'],
  lighting: ['lighting'],
  rgb: ['rgb'],
  connection: ['connection', 'connectivitytype'],
  connectivity: ['connectivity', 'connectivityoptions'],
  computer_side_connector: ['computersideconnector', 'usbconnector'],
  mouse_side_connector: ['mousesideconnector'],
  bluetooth: ['bluetooth'],
  cable_type: ['cabletype'],
  paracord: ['paracord'],
  wireless_charging: ['wirelesscharging'],
  battery_hours: ['batteryhours', 'batterylife', 'battery'],
  adjustable_weight: ['adjustableweight'],
  feet_material: ['feetmaterial', 'skatesmaterial'],
  coating: ['coating'],
  honeycomb_frame: ['honeycomb'],
  silent_clicks: ['silentclicks'],
  weight: ['weight', 'mass'],
  material: ['material', 'shellmaterial'],
  lngth: ['length', 'lngth'],
  width: ['width'],
  height: ['height'],
  form_factor: ['formfactor'],
  shape: ['shape'],
  hump: ['hump'],
  front_flare: ['frontflare'],
  thumb_rest: ['thumbrest'],
  grip: ['grip'],
  hand_size: ['handsize'],
  mcu: ['mcu'],
  mcu_link: ['mculink'],
  sensor: ['sensor'],
  sensor_brand: ['sensorbrand'],
  sensor_date: ['sensordate'],
  sensor_link: ['sensorlink'],
  sensor_type: ['sensortype'],
  flawless_sensor: ['flawlesssensor'],
  sensor_latency: ['sensorlatency'],
  sensor_latency_list: ['sensorlatencylist'],
  shift_latency: ['shiftlatency'],
  polling_rate: ['pollingrate', 'polling'],
  dpi: ['dpi', 'maxdpi'],
  ips: ['ips'],
  acceleration: ['acceleration', 'maxacceleration'],
  lift: ['liftoffdistance', 'lift'],
  lift_settings: ['liftsettings'],
  motion_sync: ['motionsync'],
  hardware_acceleration: ['hardwareacceleration'],
  smoothing: ['smoothing'],
  nvidia_reflex: ['nvidiareflex'],
  switch: ['switch', 'mainswitch'],
  switch_brand: ['switchbrand'],
  switch_type: ['switchtype'],
  switches_link: ['switcheslink'],
  hot_swappable: ['hotswappable'],
  debounce: ['debounce'],
  click_latency: ['clicklatency'],
  click_latency_list: ['clicklatencylist'],
  click_force: ['clickforce'],
  encoder: ['encoder', 'scrollencoder'],
  encoder_brand: ['encoderbrand'],
  encoder_link: ['encoderlink'],
  side_buttons: ['sidebuttons'],
  middle_buttons: ['middlebuttons'],
  programmable_buttons: ['programmablebuttons'],
  tilt_scroll_wheel: ['tiltscrollwheel'],
  adjustable_scroll_wheel: ['adjustablescrollwheel'],
  onboard_memory: ['onboardmemory'],
  onboard_memory_value: ['onboardmemoryvalue', 'memoryprofiles', 'profiles'],
  profile_switching: ['profileswitching']
};

const IDENTITY_ALIAS = {
  brand: ['brand', 'manufacturer'],
  model: ['model', 'name', 'productname'],
  sku: ['sku', 'partnumber'],
  mpn: ['mpn', 'manufacturerpartnumber'],
  gtin: ['gtin', 'upc', 'ean']
};

const HOST_HINT_PATHS = {
  'rtings.com': [
    'data.mouse',
    'data.product',
    'data.review',
    'review'
  ],
  'techpowerup.com': [
    'data.product',
    'product',
    'specs'
  ],
  'razer.com': [
    'props.pageProps',
    'data.product',
    'product'
  ]
};

function normalizeKey(key) {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function flattenObject(value, prefix = '', out = [], depth = 0) {
  if (value === null || value === undefined || depth > 8) {
    return out;
  }

  if (Array.isArray(value)) {
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      out.push({ path: prefix, value });
      return out;
    }
    value.forEach((item, index) => {
      flattenObject(item, `${prefix}[${index}]`, out, depth + 1);
    });
    return out;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${k}` : k;
      flattenObject(v, next, out, depth + 1);
    }
    return out;
  }

  out.push({ path: prefix, value });
  return out;
}

function pickFieldFromPath(path) {
  const key = normalizeKey(path.split('.').slice(-1)[0]);

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(key)) {
      return field;
    }
  }

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((alias) => normalizeKey(path).includes(alias))) {
      return field;
    }
  }

  return null;
}

function normalizeList(value) {
  const values = splitListValue(value);
  return values.length ? values.join(', ') : 'unk';
}

function normalizePollingRate(value) {
  const list = splitListValue(value)
    .map((entry) => parseNumber(entry))
    .filter((n) => n !== null)
    .map((n) => Math.round(n));

  if (!list.length) {
    const text = String(value || '');
    const matches = text.match(/\d+/g) || [];
    for (const match of matches) {
      const parsed = Number.parseInt(match, 10);
      if (Number.isFinite(parsed)) {
        list.push(parsed);
      }
    }
  }

  const unique = [...new Set(list)].sort((a, b) => b - a);
  return unique.length ? unique.join(', ') : 'unk';
}

function normalizeNumeric(value) {
  const num = parseNumber(value);
  if (num === null) {
    return 'unk';
  }
  const rounded = Number.isInteger(num) ? num : Number.parseFloat(num.toFixed(2));
  return String(rounded);
}

function normalizeString(value) {
  const text = normalizeWhitespace(value);
  return text || 'unk';
}

function normalizeConnectionValue(value) {
  const token = normalizeToken(value);
  if (!token) {
    return 'unk';
  }
  if (token.includes('dual')) {
    return 'dual';
  }
  if (token.includes('wireless') && token.includes('wired')) {
    return 'dual';
  }
  if (token.includes('wireless')) {
    return 'wireless';
  }
  if (token.includes('wired')) {
    return 'wired';
  }
  return normalizeString(value);
}

function normalizeByField(field, value) {
  if (value === null || value === undefined || value === '') {
    return 'unk';
  }

  if (field === 'release_date') {
    return formatDateMmDdYyyy(value);
  }
  if (field === 'polling_rate') {
    return normalizePollingRate(value);
  }
  if (field === 'connection') {
    return normalizeConnectionValue(value);
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return normalizeBooleanValue(value);
  }
  if (LIST_FIELDS.has(field)) {
    return normalizeList(value);
  }
  if (NUMERIC_FIELDS.has(field)) {
    return normalizeNumeric(value);
  }

  return normalizeString(value);
}

function gatherIdentityCandidates(flattened) {
  const identity = {};
  for (const [field, aliases] of Object.entries(IDENTITY_ALIAS)) {
    for (const entry of flattened) {
      const key = normalizeKey(entry.path.split('.').slice(-1)[0]);
      if (aliases.includes(key)) {
        const value = normalizeString(entry.value);
        if (value !== 'unk') {
          identity[field] = value;
          break;
        }
      }
    }
  }
  return identity;
}

function inferVariantFromText(text) {
  const token = normalizeToken(text);
  if (!token) {
    return 'unk';
  }
  if (token.includes('wireless')) {
    return 'Wireless';
  }
  if (token.includes('wired')) {
    return 'Wired';
  }
  return 'unk';
}

function hostHintPayloads(host, payload) {
  const normalizedHost = String(host || '').toLowerCase();
  const hintEntry = Object.entries(HOST_HINT_PATHS).find(([domain]) => normalizedHost.endsWith(domain));
  if (!hintEntry || !payload || typeof payload !== 'object') {
    return [];
  }

  const hintPaths = hintEntry[1];
  const out = [];
  for (const hintPath of hintPaths) {
    const hit = getByPath(payload, hintPath);
    if (hit && typeof hit === 'object') {
      out.push(hit);
    }
  }
  return out;
}

function buildPayloadBuckets({ host, ldjsonBlocks, embeddedState, networkResponses }) {
  const buckets = [];

  buckets.push({ method: 'ldjson', payloads: ldjsonBlocks || [] });

  const embeddedPayloads = [
    embeddedState?.nextData?.props?.pageProps,
    embeddedState?.nextData,
    embeddedState?.nuxtState?.data,
    embeddedState?.nuxtState,
    embeddedState?.apolloState
  ].filter(Boolean);
  buckets.push({ method: 'embedded_state', payloads: embeddedPayloads });

  const networkPayloads = [];
  for (const row of networkResponses || []) {
    const payload = row.jsonFull ?? row.jsonPreview;
    if (!payload || typeof payload !== 'object') {
      continue;
    }
    networkPayloads.push(payload);
    if (payload.data && typeof payload.data === 'object') {
      networkPayloads.push(payload.data);
    }
    if (payload.product && typeof payload.product === 'object') {
      networkPayloads.push(payload.product);
    }
    networkPayloads.push(...hostHintPayloads(host, payload));
  }
  buckets.push({ method: 'network_json', payloads: networkPayloads });

  return buckets;
}

function extractHtmlLinkCandidates(html) {
  const candidates = [];
  if (!html) {
    return candidates;
  }

  for (const match of html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = normalizeWhitespace(match[1]);
    const label = normalizeWhitespace(match[2]).toLowerCase();
    if (!/^https?:\/\//i.test(href)) {
      continue;
    }

    if (label.includes('sensor')) {
      candidates.push({ field: 'sensor_link', value: href, method: 'dom', keyPath: 'html.a.sensor' });
    }
    if (label.includes('switch')) {
      candidates.push({ field: 'switches_link', value: href, method: 'dom', keyPath: 'html.a.switch' });
    }
    if (label.includes('encoder')) {
      candidates.push({ field: 'encoder_link', value: href, method: 'dom', keyPath: 'html.a.encoder' });
    }
  }

  return candidates;
}

export function extractCandidatesFromPage({
  host,
  html,
  title,
  ldjsonBlocks,
  embeddedState,
  networkResponses
}) {
  const candidateRows = [];
  const identity = {};

  const buckets = buildPayloadBuckets({
    host,
    ldjsonBlocks,
    embeddedState,
    networkResponses
  });

  for (const bucket of buckets) {
    for (const payload of bucket.payloads) {
      const flattened = flattenObject(payload);
      const identityFromPayload = gatherIdentityCandidates(flattened);
      Object.assign(identity, identityFromPayload);

      for (const item of flattened) {
        const field = pickFieldFromPath(item.path);
        if (!field) {
          continue;
        }

        const value = normalizeByField(field, item.value);
        if (value === 'unk') {
          continue;
        }

        if (field.endsWith('_link') && !/^https?:\/\//i.test(String(value))) {
          continue;
        }

        candidateRows.push({
          field,
          value,
          method: bucket.method,
          keyPath: item.path
        });
      }
    }
  }

  const domFallback = extractDomFallback(html);
  for (const [field, value] of Object.entries(domFallback)) {
    const normalizedValue = normalizeByField(field, value);
    if (normalizedValue !== 'unk') {
      candidateRows.push({
        field,
        value: normalizedValue,
        method: 'dom',
        keyPath: `dom.${field}`
      });
    }
  }

  candidateRows.push(...extractHtmlLinkCandidates(html));

  const identityText = [title, html?.slice(0, 4000)].filter(Boolean).join(' ');
  if (!identity.variant || identity.variant === 'unk') {
    identity.variant = inferVariantFromText(identityText);
  }

  return {
    fieldCandidates: candidateRows,
    identityCandidates: identity
  };
}
