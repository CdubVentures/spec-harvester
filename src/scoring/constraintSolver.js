import { parseNumber, splitListValue } from '../utils/common.js';

function round(value, digits = 4) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function hasValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk';
}

function parseBoolean(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token || token === 'unk') {
    return null;
  }
  if (['yes', 'true', '1', 'y', 'on', 'supported', 'enabled'].includes(token)) {
    return true;
  }
  if (['no', 'false', '0', 'n', 'off', 'disabled'].includes(token)) {
    return false;
  }
  return null;
}

function includesToken(value, token) {
  return String(value || '').toLowerCase().includes(String(token || '').toLowerCase());
}

function addContradiction(rows, contradiction) {
  rows.push({
    ...contradiction,
    severity: contradiction.severity || 'warning',
    fields: contradiction.fields || [],
    code: contradiction.code || 'constraint_violation'
  });
}

function ruleWirelessNeedsBattery(fields, contradictions) {
  const connection = String(fields.connection || '').toLowerCase();
  const battery = String(fields.battery_hours || '').toLowerCase();

  if (!connection || connection === 'unk') {
    return;
  }

  if ((connection.includes('wireless') || connection.includes('dual')) && (battery === 'unk' || battery === 'n/a')) {
    addContradiction(contradictions, {
      code: 'wireless_missing_battery_hours',
      severity: 'warning',
      fields: ['connection', 'battery_hours'],
      message: 'Wireless-capable connection but battery_hours is unknown.'
    });
  }

  if (connection === 'wired') {
    const parsed = parseNumber(battery);
    if (parsed !== null && parsed > 0) {
      addContradiction(contradictions, {
        code: 'wired_has_battery_hours',
        severity: 'warning',
        fields: ['connection', 'battery_hours'],
        message: 'Wired connection should not report battery_hours > 0.',
        observed: battery
      });
    }
  }
}

function ruleBluetoothNeedsWireless(fields, contradictions) {
  const bluetooth = parseBoolean(fields.bluetooth);
  const connection = String(fields.connection || '').toLowerCase();
  const connectivity = String(fields.connectivity || '').toLowerCase();

  if (bluetooth !== true) {
    return;
  }

  const hasWirelessSignal =
    includesToken(connection, 'wireless') ||
    includesToken(connection, 'dual') ||
    includesToken(connectivity, 'wireless') ||
    includesToken(connectivity, 'bluetooth');

  if (!hasWirelessSignal) {
    addContradiction(contradictions, {
      code: 'bluetooth_without_wireless',
      severity: 'error',
      fields: ['bluetooth', 'connection', 'connectivity'],
      message: 'Bluetooth is enabled but connection/connectivity has no wireless signal.'
    });
  }
}

function ruleDimensionSanity(fields, contradictions) {
  const length = parseNumber(fields.lngth);
  const width = parseNumber(fields.width);
  const height = parseNumber(fields.height);

  const dims = [
    ['lngth', length],
    ['width', width],
    ['height', height]
  ];

  for (const [field, value] of dims) {
    if (value === null) {
      continue;
    }
    if (value <= 0 || value > 300) {
      addContradiction(contradictions, {
        code: 'dimension_out_of_range',
        severity: 'error',
        fields: [field],
        message: `${field} value is outside expected physical range.`,
        observed: String(value)
      });
    }
  }

  if (length !== null && width !== null && width > (length * 1.25)) {
    addContradiction(contradictions, {
      code: 'width_exceeds_length',
      severity: 'warning',
      fields: ['lngth', 'width'],
      message: 'Width is unexpectedly larger than length.'
    });
  }
}

function parsePollingValues(value) {
  return splitListValue(value)
    .map((item) => parseNumber(item))
    .filter((item) => item !== null);
}

function rulePerformanceSanity(fields, contradictions) {
  const pollingValues = parsePollingValues(fields.polling_rate);
  if (pollingValues.length) {
    const maxPolling = Math.max(...pollingValues);
    const minPolling = Math.min(...pollingValues);

    if (maxPolling > 10_000 || minPolling < 125) {
      addContradiction(contradictions, {
        code: 'polling_rate_out_of_range',
        severity: 'warning',
        fields: ['polling_rate'],
        message: 'Polling rate appears outside expected range (125-10000Hz).',
        observed: String(fields.polling_rate || '')
      });
    }
  }

  const dpi = parseNumber(fields.dpi);
  if (dpi !== null && (dpi < 100 || dpi > 100_000)) {
    addContradiction(contradictions, {
      code: 'dpi_out_of_range',
      severity: 'warning',
      fields: ['dpi'],
      message: 'DPI appears outside expected range (100-100000).',
      observed: String(fields.dpi || '')
    });
  }

  const ips = parseNumber(fields.ips);
  if (ips !== null && (ips < 40 || ips > 1200)) {
    addContradiction(contradictions, {
      code: 'ips_out_of_range',
      severity: 'warning',
      fields: ['ips'],
      message: 'IPS appears outside expected range (40-1200).',
      observed: String(fields.ips || '')
    });
  }
}

function ruleDependencyPairs(fields, contradictions) {
  if (hasValue(fields.sensor_brand) && !hasValue(fields.sensor)) {
    addContradiction(contradictions, {
      code: 'sensor_brand_without_sensor',
      severity: 'warning',
      fields: ['sensor_brand', 'sensor'],
      message: 'sensor_brand is present while sensor is unknown.'
    });
  }

  if (hasValue(fields.switch_brand) && !hasValue(fields.switch)) {
    addContradiction(contradictions, {
      code: 'switch_brand_without_switch',
      severity: 'warning',
      fields: ['switch_brand', 'switch'],
      message: 'switch_brand is present while switch is unknown.'
    });
  }
}

function fieldConfidence(provenanceRow) {
  if (!provenanceRow || typeof provenanceRow !== 'object') {
    return 0;
  }
  const confidence = Number.parseFloat(String(provenanceRow.confidence ?? 0));
  return Number.isFinite(confidence) ? confidence : 0;
}

function severityPenalty(severity) {
  if (severity === 'error') {
    return 0.25;
  }
  if (severity === 'warning') {
    return 0.12;
  }
  return 0.08;
}

function buildFieldUncertainty(fields, provenance, contradictions, criticalFieldSet) {
  const map = {};
  const penalties = {};

  for (const contradiction of contradictions || []) {
    for (const field of contradiction.fields || []) {
      penalties[field] = (penalties[field] || 0) + severityPenalty(contradiction.severity);
    }
  }

  for (const field of Object.keys(fields || {})) {
    const value = fields[field];
    const confidence = fieldConfidence(provenance?.[field]);
    let uncertainty = hasValue(value)
      ? Math.max(0, 1 - confidence)
      : 0.9;

    if (criticalFieldSet?.has(field) && !hasValue(value)) {
      uncertainty += 0.08;
    }
    if (provenance?.[field]?.meets_pass_target === false) {
      uncertainty += 0.07;
    }

    uncertainty += penalties[field] || 0;
    map[field] = round(Math.max(0, Math.min(1, uncertainty)), 6);
  }

  return map;
}

export function evaluateConstraintGraph({
  fields = {},
  provenance = {},
  criticalFieldSet = new Set(),
  crossValidationFailures = []
}) {
  const contradictions = [];

  ruleWirelessNeedsBattery(fields, contradictions);
  ruleBluetoothNeedsWireless(fields, contradictions);
  ruleDimensionSanity(fields, contradictions);
  rulePerformanceSanity(fields, contradictions);
  ruleDependencyPairs(fields, contradictions);

  for (const failure of crossValidationFailures) {
    if (failure.reason_code === 'compound_range_conflict') {
      addContradiction(contradictions, {
        code: 'compound_range_conflict',
        severity: 'error',
        fields: [failure.field_key],
        message: `${failure.field_key} value ${failure.actual} outside compound range [${failure.effective_min ?? '?'}, ${failure.effective_max ?? '?'}]`
      });
    }
  }

  const field_uncertainty = buildFieldUncertainty(fields, provenance, contradictions, criticalFieldSet);
  const values = Object.values(field_uncertainty);
  const global_uncertainty = values.length
    ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 6)
    : 0;

  const top_uncertain_fields = Object.entries(field_uncertainty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([field, uncertainty]) => ({ field, uncertainty }));

  return {
    contradiction_count: contradictions.length,
    contradictions,
    field_uncertainty,
    global_uncertainty,
    top_uncertain_fields
  };
}
