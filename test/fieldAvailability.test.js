import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityClassForField,
  availabilitySearchEffort,
  defaultFieldAvailability,
  summarizeAvailability,
  undisclosedThresholdForField,
  updateFieldAvailability
} from '../src/learning/fieldAvailability.js';

function makeRun({
  weight = '60',
  dpi = 'unk',
  dpiUnknownReason = 'not_found_after_search'
} = {}) {
  return {
    normalized: {
      fields: {
        weight,
        dpi
      }
    },
    summary: {
      validated: true,
      field_reasoning: {
        weight: { unknown_reason: '' },
        dpi: { unknown_reason: dpiUnknownReason }
      }
    },
    provenance: {
      weight: {
        evidence: [{ rootDomain: 'logitechg.com', tier: 1 }]
      },
      dpi: {
        evidence: [{ rootDomain: 'example.com', tier: 2 }]
      }
    }
  };
}

test('field availability updates expected and rare classifications', () => {
  let artifact = defaultFieldAvailability();
  artifact.thresholds = {
    min_validated_seen: 2,
    expected_rate: 0.85,
    rare_rate: 0.25,
    rare_override_min_seen: 2,
    rare_override_not_publicly_disclosed_ratio: 0.6
  };

  const run1 = makeRun({
    weight: '60',
    dpi: 'unk',
    dpiUnknownReason: 'not_publicly_disclosed'
  });
  artifact = updateFieldAvailability({
    artifact,
    fieldOrder: ['weight', 'dpi'],
    normalized: run1.normalized,
    summary: run1.summary,
    provenance: run1.provenance,
    validated: true
  });

  const run2 = makeRun({
    weight: '59',
    dpi: 'unk',
    dpiUnknownReason: 'not_publicly_disclosed'
  });
  artifact = updateFieldAvailability({
    artifact,
    fieldOrder: ['weight', 'dpi'],
    normalized: run2.normalized,
    summary: run2.summary,
    provenance: run2.provenance,
    validated: true
  });

  assert.equal(availabilityClassForField(artifact, 'weight'), 'expected');
  assert.equal(availabilityClassForField(artifact, 'dpi'), 'rare');
  assert.equal(artifact.fields.weight.validated_seen, 2);
  assert.equal(artifact.fields.weight.validated_filled, 2);
  assert.equal(artifact.fields.dpi.unknown_reason_counts.not_publicly_disclosed, 2);
});

test('availability search effort and threshold adapt by classification', () => {
  const artifact = {
    ...defaultFieldAvailability(),
    fields: {
      weight: {
        validated_seen: 80,
        validated_filled: 76,
        filled_rate_validated: 0.95,
        classification: 'expected',
        unknown_reason_counts: {},
        top_domains: [],
        domain_stats: {}
      },
      release_date: {
        validated_seen: 80,
        validated_filled: 8,
        filled_rate_validated: 0.1,
        classification: 'rare',
        unknown_reason_counts: { not_publicly_disclosed: 60 },
        top_domains: [],
        domain_stats: {}
      }
    }
  };

  const effort = availabilitySearchEffort({
    artifact,
    missingFields: ['weight', 'release_date', 'dpi']
  });
  assert.equal(effort.expected_count, 1);
  assert.equal(effort.rare_count, 1);
  assert.equal(effort.sometimes_count, 1);

  const expectedThreshold = undisclosedThresholdForField({
    field: 'weight',
    artifact
  });
  const rareThreshold = undisclosedThresholdForField({
    field: 'release_date',
    artifact
  });
  assert.equal(expectedThreshold > rareThreshold, true);

  const summary = summarizeAvailability(artifact);
  assert.equal(summary.counts.expected, 1);
  assert.equal(summary.counts.rare, 1);
});
