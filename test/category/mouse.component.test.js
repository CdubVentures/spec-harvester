import test from 'node:test';
import assert from 'node:assert/strict';

const COMPONENTS = [
  {
    "name": "sensor",
    "values": []
  },
  {
    "name": "switch",
    "values": []
  },
  {
    "name": "encoder",
    "values": []
  },
  {
    "name": "mcu",
    "values": []
  }
];

test('mouse component alias map is deterministic and deduped', () => {
  for (const row of COMPONENTS) {
    const deduped = [...new Set(row.values)];
    assert.deepEqual(row.values, deduped, `Component aliases are not deduped for ${row.name}`);
  }
});

