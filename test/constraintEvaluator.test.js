import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConstraint,
  evaluateConstraint,
  evaluateAllConstraints,
} from '../src/engine/constraintEvaluator.js';

describe('parseConstraint — requires operator', () => {
  it('parses "sensor_brand requires sensor"', () => {
    const result = parseConstraint('sensor_brand requires sensor');
    assert.deepStrictEqual(result, {
      left: 'sensor_brand',
      op: 'requires',
      right: 'sensor',
      raw: 'sensor_brand requires sensor',
    });
  });

  it('parses requires with extra whitespace', () => {
    const result = parseConstraint('  sensor_brand   requires   sensor  ');
    assert.equal(result.left, 'sensor_brand');
    assert.equal(result.op, 'requires');
    assert.equal(result.right, 'sensor');
  });

  it('returns null for empty/invalid input', () => {
    assert.equal(parseConstraint(''), null);
    assert.equal(parseConstraint(null), null);
    assert.equal(parseConstraint(undefined), null);
    assert.equal(parseConstraint('just a string'), null);
  });
});

describe('evaluateConstraint — requires semantics', () => {
  it('passes when left has value AND right has value', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      {},
      { sensor_brand: 'PixArt', sensor: 'PAW3950' }
    );
    assert.equal(result.pass, true);
    assert.equal(result.dependencyMissing, undefined);
    assert.equal(result.skipped, undefined);
  });

  it('fails when left has value BUT right is unk', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      {},
      { sensor_brand: 'PixArt', sensor: 'unk' }
    );
    assert.equal(result.pass, false);
    assert.equal(result.dependencyMissing, true);
  });

  it('fails when left has value BUT right is empty string', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      {},
      { sensor_brand: 'PixArt', sensor: '' }
    );
    assert.equal(result.pass, false);
    assert.equal(result.dependencyMissing, true);
  });

  it('fails when left has value BUT right is missing (unresolved)', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      {},
      { sensor_brand: 'PixArt' }
    );
    assert.equal(result.pass, false);
    assert.equal(result.dependencyMissing, true);
  });

  it('skips when left is unk (dependency not applicable)', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      {},
      { sensor_brand: 'unk', sensor: 'PAW3950' }
    );
    assert.equal(result.pass, true);
    assert.equal(result.skipped, true);
  });

  it('skips when left is unknown', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      {},
      { sensor_brand: 'unknown' }
    );
    assert.equal(result.pass, true);
    assert.equal(result.skipped, true);
  });

  it('skips when left is unresolved (not in any data source)', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      {},
      {}
    );
    assert.equal(result.pass, true);
    assert.equal(result.skipped, true);
  });

  it('resolves from component props first, then product values', () => {
    const result = evaluateConstraint(
      'sensor_brand requires sensor',
      { sensor_brand: 'PixArt' },
      { sensor: 'PAW3950' }
    );
    assert.equal(result.pass, true);
  });
});

describe('evaluateConstraint — regression: existing operators', () => {
  it('literal number comparison: dpi >= 100', () => {
    const result = evaluateConstraint('dpi >= 100', {}, { dpi: '26000' });
    assert.equal(result.pass, true);
  });

  it('literal number comparison: weight <= 200', () => {
    const result = evaluateConstraint('weight <= 200', {}, { weight: '58' });
    assert.equal(result.pass, true);
  });

  it('literal number comparison fails correctly', () => {
    const result = evaluateConstraint('dpi >= 100', {}, { dpi: '50' });
    assert.equal(result.pass, false);
  });

  it('cross-field comparison: sensor_date <= release_date', () => {
    const result = evaluateConstraint(
      'sensor_date <= release_date',
      { sensor_date: '2023-01-15' },
      { release_date: '2024-06-01' }
    );
    assert.equal(result.pass, true);
  });

  it('equality with string literal', () => {
    const result = evaluateConstraint("shape == 'symmetric'", {}, { shape: 'symmetric' });
    assert.equal(result.pass, true);
  });

  it('inequality operator', () => {
    const result = evaluateConstraint('connection != unk', {}, { connection: 'wireless' });
    assert.equal(result.pass, true);
  });
});

describe('evaluateAllConstraints — batch with requires', () => {
  it('evaluates mixed constraint types including requires', () => {
    const mappings = [
      { field_key: 'sensor_brand', constraints: ['sensor_brand requires sensor'] },
      { field_key: 'dpi', constraints: ['dpi >= 100'] },
      { field_key: 'weight', constraints: ['weight <= 200'] },
    ];
    const productValues = {
      sensor_brand: 'PixArt',
      sensor: 'PAW3950',
      dpi: '26000',
      weight: '58',
    };
    const results = evaluateAllConstraints(mappings, {}, productValues);
    assert.equal(results.length, 3);
    assert.equal(results[0].pass, true);
    assert.equal(results[0].propertyKey, 'sensor_brand');
    assert.equal(results[1].pass, true);
    assert.equal(results[2].pass, true);
  });

  it('flags dependency_missing in batch results', () => {
    const mappings = [
      { field_key: 'sensor_brand', constraints: ['sensor_brand requires sensor'] },
    ];
    const results = evaluateAllConstraints(mappings, {}, { sensor_brand: 'PixArt' });
    assert.equal(results.length, 1);
    assert.equal(results[0].pass, false);
    assert.equal(results[0].dependencyMissing, true);
  });
});
