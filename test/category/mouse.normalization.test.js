import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeterministicCritic } from '../../src/validator/critic.js';

const ALIAS_CASES = [
  {
    "field": "connection",
    "alias": "2 4 ghz",
    "canonical": "wireless"
  },
  {
    "field": "connection",
    "alias": "2 4ghz",
    "canonical": "wireless"
  },
  {
    "field": "connection",
    "alias": "2 4ghz wired",
    "canonical": "hybrid"
  },
  {
    "field": "connection",
    "alias": "24ghz",
    "canonical": "wireless"
  },
  {
    "field": "connectivity",
    "alias": "2 4 ghz",
    "canonical": "wireless"
  },
  {
    "field": "connectivity",
    "alias": "2 4ghz",
    "canonical": "wireless"
  },
  {
    "field": "connectivity",
    "alias": "2 4ghz dongle",
    "canonical": "2 4ghz dongle"
  },
  {
    "field": "connectivity",
    "alias": "2 4ghz rf dongle",
    "canonical": "2 4ghz rf dongle"
  }
];
const FIELD_ORDER = [
  "connection",
  "connectivity"
];
const CONSTRAINTS = {
  "fields": {
    "connection": {
      "type": "string",
      "enum": [
        "hybrid",
        "wired",
        "wireless"
      ],
      "aliases": {
        "2 4 ghz": "wireless",
        "2 4ghz": "wireless",
        "2 4ghz wired": "hybrid",
        "24ghz": "wireless",
        "24ghzwired": "hybrid",
        "bluetooth 2 4ghz": "hybrid",
        "bluetooth 2 4ghz wired": "hybrid",
        "bluetooth wired": "hybrid",
        "bluetooth24ghz": "hybrid",
        "bluetooth24ghzwired": "hybrid",
        "bluetoothwired": "hybrid",
        "dongle": "wireless",
        "dual": "hybrid",
        "dual mode": "hybrid",
        "dualmode": "hybrid",
        "hybrid": "hybrid",
        "receiver": "wireless",
        "rf": "wireless",
        "usb": "wired",
        "usb wired": "wired",
        "usbwired": "wired",
        "wire": "wired",
        "wired": "wired",
        "wired wireless": "hybrid",
        "wiredwireless": "hybrid",
        "wireless": "wireless",
        "wireless wired": "hybrid",
        "wirelesswired": "hybrid"
      }
    },
    "connectivity": {
      "type": "list",
      "enum": [
        "2 4ghz dongle",
        "2 4ghz rf dongle",
        "2 4ghz wifi dongle",
        "bluetooth",
        "n a",
        "wired",
        "wireless"
      ],
      "aliases": {
        "2 4 ghz": "wireless",
        "2 4ghz": "wireless",
        "2 4ghz dongle": "2 4ghz dongle",
        "2 4ghz rf dongle": "2 4ghz rf dongle",
        "2 4ghz wifi dongle": "2 4ghz wifi dongle",
        "24ghz": "wireless",
        "24ghzdongle": "2 4ghz dongle",
        "24ghzrfdongle": "2 4ghz rf dongle",
        "24ghzwifidongle": "2 4ghz wifi dongle",
        "bluetooth": "bluetooth",
        "dongle": "wireless",
        "n a": "n a",
        "na": "n a",
        "receiver": "wireless",
        "rf": "wireless",
        "usb": "wired",
        "usb wired": "wired",
        "usbwired": "wired",
        "wire": "wired",
        "wired": "wired",
        "wireless": "wireless"
      }
    }
  }
};

test('mouse enum alias normalization via deterministic critic', () => {
  for (const row of ALIAS_CASES) {
    const normalized = { fields: { [row.field]: row.alias } };
    const provenance = {};
    const decisions = runDeterministicCritic({
      normalized,
      provenance,
      fieldReasoning: {},
      categoryConfig: { fieldOrder: FIELD_ORDER },
      constraints: CONSTRAINTS
    });
    const rejected = (decisions.reject || []).find((entry) => entry.field === row.field);
    assert.equal(Boolean(rejected), false, `Alias was rejected for field ${row.field}`);
    assert.equal(String(normalized.fields[row.field]), String(row.canonical));
  }
});

