import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleAiMode,
  ruleAiModelStrategy,
  ruleAiMaxCalls,
  ruleAiMaxTokens,
  ruleAiReasoningNote,
  autoGenerateExtractionGuidance,
  resolveAiModeWithInheritance
} from '../src/engine/ruleAccessors.js';
import { buildFieldBatches, resolveBatchModel } from '../src/llm/fieldBatching.js';

// ---------------------------------------------------------------------------
// ruleAiMode — auto-derivation from priority + difficulty
// ---------------------------------------------------------------------------

test('ruleAiMode: identity → judge', () => {
  assert.equal(ruleAiMode({ priority: { required_level: 'identity' } }), 'judge');
});

test('ruleAiMode: required → judge', () => {
  assert.equal(ruleAiMode({ priority: { required_level: 'required' } }), 'judge');
});

test('ruleAiMode: critical → judge', () => {
  assert.equal(ruleAiMode({ priority: { required_level: 'critical' } }), 'judge');
});

test('ruleAiMode: expected + hard → planner', () => {
  assert.equal(ruleAiMode({
    priority: { required_level: 'expected', difficulty: 'hard' }
  }), 'planner');
});

test('ruleAiMode: expected + medium → advisory', () => {
  assert.equal(ruleAiMode({
    priority: { required_level: 'expected', difficulty: 'medium' }
  }), 'advisory');
});

test('ruleAiMode: expected + easy → advisory', () => {
  assert.equal(ruleAiMode({
    priority: { required_level: 'expected', difficulty: 'easy' }
  }), 'advisory');
});

test('ruleAiMode: optional → off', () => {
  assert.equal(ruleAiMode({ priority: { required_level: 'optional' } }), 'off');
});

test('ruleAiMode: rare → off (via default optional)', () => {
  assert.equal(ruleAiMode({ priority: { required_level: 'rare' } }), 'off');
});

test('ruleAiMode: empty rule → off', () => {
  assert.equal(ruleAiMode({}), 'off');
});

// ---------------------------------------------------------------------------
// ruleAiMode — explicit override beats auto-derivation
// ---------------------------------------------------------------------------

test('ruleAiMode: explicit mode in ai_assist block overrides derivation', () => {
  assert.equal(ruleAiMode({
    priority: { required_level: 'optional' },
    ai_assist: { mode: 'judge' }
  }), 'judge');
});

test('ruleAiMode: explicit advisory on identity field', () => {
  assert.equal(ruleAiMode({
    priority: { required_level: 'identity' },
    ai_assist: { mode: 'advisory' }
  }), 'advisory');
});

test('ruleAiMode: nested ai_assist.mode override', () => {
  assert.equal(ruleAiMode({
    priority: { required_level: 'optional' },
    ai_assist: { mode: 'planner' }
  }), 'planner');
});

test('ruleAiMode: invalid explicit mode falls through to auto-derivation', () => {
  assert.equal(ruleAiMode({
    priority: { required_level: 'identity' },
    ai_assist: { mode: 'bogus' }
  }), 'judge');
});

// ---------------------------------------------------------------------------
// ruleAiMaxCalls — auto-derivation from effort
// ---------------------------------------------------------------------------

test('ruleAiMaxCalls: effort 2 → 1', () => {
  assert.equal(ruleAiMaxCalls({ priority: { effort: 2 } }), 1);
});

test('ruleAiMaxCalls: effort 3 → 1', () => {
  assert.equal(ruleAiMaxCalls({ priority: { effort: 3 } }), 1);
});

test('ruleAiMaxCalls: effort 5 → 2', () => {
  assert.equal(ruleAiMaxCalls({ priority: { effort: 5 } }), 2);
});

test('ruleAiMaxCalls: effort 6 → 2', () => {
  assert.equal(ruleAiMaxCalls({ priority: { effort: 6 } }), 2);
});

test('ruleAiMaxCalls: effort 8 → 3', () => {
  assert.equal(ruleAiMaxCalls({ priority: { effort: 8 } }), 3);
});

test('ruleAiMaxCalls: effort 10 → 3', () => {
  assert.equal(ruleAiMaxCalls({ priority: { effort: 10 } }), 3);
});

// ---------------------------------------------------------------------------
// ruleAiMaxCalls — explicit override
// ---------------------------------------------------------------------------

test('ruleAiMaxCalls: explicit max_calls in ai_assist block', () => {
  assert.equal(ruleAiMaxCalls({
    priority: { effort: 2 },
    ai_assist: { max_calls: 3 }
  }), 3);
});

test('ruleAiMaxCalls: explicit max_calls capped at 10', () => {
  assert.equal(ruleAiMaxCalls({ ai_assist: { max_calls: 99 } }), 10);
});

test('ruleAiMaxCalls: nested ai_assist.max_calls override', () => {
  assert.equal(ruleAiMaxCalls({
    priority: { effort: 2 },
    ai_assist: { max_calls: 2 }
  }), 2);
});

// ---------------------------------------------------------------------------
// ruleAiModelStrategy
// ---------------------------------------------------------------------------

test('ruleAiModelStrategy: defaults to auto', () => {
  assert.equal(ruleAiModelStrategy({}), 'auto');
});

test('ruleAiModelStrategy: explicit force_deep', () => {
  assert.equal(ruleAiModelStrategy({ ai_assist: { model_strategy: 'force_deep' } }), 'force_deep');
});

test('ruleAiModelStrategy: explicit force_fast', () => {
  assert.equal(ruleAiModelStrategy({ ai_assist: { model_strategy: 'force_fast' } }), 'force_fast');
});

test('ruleAiModelStrategy: nested ai_assist.model_strategy force_deep', () => {
  assert.equal(ruleAiModelStrategy({ ai_assist: { model_strategy: 'force_deep' } }), 'force_deep');
});

// ---------------------------------------------------------------------------
// ruleAiReasoningNote
// ---------------------------------------------------------------------------

test('ruleAiReasoningNote: empty by default', () => {
  assert.equal(ruleAiReasoningNote({}), '');
});

test('ruleAiReasoningNote: reads from ai_assist block', () => {
  assert.equal(ruleAiReasoningNote({
    ai_assist: { reasoning_note: 'Identity field needs full audit' }
  }), 'Identity field needs full audit');
});

test('ruleAiReasoningNote: trims whitespace', () => {
  assert.equal(ruleAiReasoningNote({
    ai_assist: { reasoning_note: '  trimmed  ' }
  }), 'trimmed');
});

// ---------------------------------------------------------------------------
// buildFieldBatches — excludes mode=off fields
// ---------------------------------------------------------------------------

test('buildFieldBatches: excludes mode=off fields', () => {
  const fieldRules = {
    brand: { priority: { required_level: 'identity' } },
    color: { priority: { required_level: 'optional' } },
    weight: { priority: { required_level: 'expected', difficulty: 'medium' } }
  };
  const batches = buildFieldBatches({
    targetFields: ['brand', 'color', 'weight'],
    fieldRules
  });
  const allFields = batches.flatMap((b) => b.fields);
  assert.ok(allFields.includes('brand'), 'brand should be included (judge)');
  assert.ok(!allFields.includes('color'), 'color should be excluded (off)');
  assert.ok(allFields.includes('weight'), 'weight should be included (advisory)');
});

test('buildFieldBatches: skippedOffFields lists excluded fields', () => {
  const fieldRules = {
    color: { priority: { required_level: 'optional' } }
  };
  const batches = buildFieldBatches({
    targetFields: ['brand', 'color'],
    fieldRules
  });
  assert.ok(Array.isArray(batches.skippedOffFields));
  assert.ok(batches.skippedOffFields.includes('color'));
});

test('buildFieldBatches: explicit mode=off in ai_assist excludes field', () => {
  const fieldRules = {
    weight: {
      priority: { required_level: 'expected' },
      ai_assist: { mode: 'off' }
    }
  };
  const batches = buildFieldBatches({
    targetFields: ['weight'],
    fieldRules
  });
  const allFields = batches.flatMap((b) => b.fields);
  assert.ok(!allFields.includes('weight'), 'weight with explicit off should be excluded');
});

// ---------------------------------------------------------------------------
// resolveBatchModel — respects force_deep/force_fast per-field
// ---------------------------------------------------------------------------

test('resolveBatchModel: force_deep triggers reasoning', () => {
  const batch = {
    id: 'physical',
    fields: ['weight'],
    difficulty: { easy: 1, medium: 0, hard: 0, instrumented: 0 }
  };
  const fieldRules = {
    weight: { ai_assist: { model_strategy: 'force_deep' } }
  };
  const result = resolveBatchModel({
    batch,
    config: { llmModelFast: 'fast-model', llmModelReasoning: 'deep-model' },
    fieldRules
  });
  assert.equal(result.reasoningMode, true);
  assert.equal(result.model, 'deep-model');
  assert.equal(result.reason, 'extract_force_deep_field');
});

test('resolveBatchModel: all force_fast forces fast model', () => {
  const batch = {
    id: 'physical',
    fields: ['weight', 'height'],
    difficulty: { easy: 0, medium: 0, hard: 2, instrumented: 0 }
  };
  const fieldRules = {
    weight: { ai_assist: { model_strategy: 'force_fast' } },
    height: { ai_assist: { model_strategy: 'force_fast' } }
  };
  const result = resolveBatchModel({
    batch,
    config: { llmModelFast: 'fast-model', llmModelReasoning: 'deep-model' },
    fieldRules
  });
  assert.equal(result.reasoningMode, false);
  assert.equal(result.reason, 'extract_force_fast_all');
});

test('resolveBatchModel: mixed strategies — force_deep wins over auto', () => {
  const batch = {
    id: 'physical',
    fields: ['weight', 'height'],
    difficulty: { easy: 2, medium: 0, hard: 0, instrumented: 0 }
  };
  const fieldRules = {
    weight: { ai_assist: { model_strategy: 'force_deep' } },
    height: { ai_assist: { model_strategy: 'auto' } }
  };
  const result = resolveBatchModel({
    batch,
    config: { llmModelFast: 'fast-model', llmModelReasoning: 'deep-model' },
    fieldRules
  });
  assert.equal(result.reasoningMode, true);
});

test('resolveBatchModel: no fieldRules falls back to existing behavior', () => {
  const batch = {
    id: 'physical',
    fields: ['weight'],
    difficulty: { easy: 1, medium: 0, hard: 0, instrumented: 0 }
  };
  const result = resolveBatchModel({
    batch,
    config: { llmModelFast: 'fast-model', llmModelReasoning: 'deep-model' }
  });
  assert.equal(result.reasoningMode, false);
  assert.equal(result.reason, 'extract_fast_batch');
});

// ---------------------------------------------------------------------------
// buildContractEffortPlan — includes ai_mode and ai_max_calls
// ---------------------------------------------------------------------------

test('buildContractEffortPlan: includes ai_mode and ai_max_calls', async () => {
  const { buildContractEffortPlan } = await import('../src/runner/runUntilComplete.js');
  const categoryConfig = {
    fieldRules: {
      fields: {
        brand: { priority: { required_level: 'identity', effort: 8 } },
        weight: { priority: { required_level: 'expected', difficulty: 'medium', effort: 5 } }
      }
    },
    fieldOrder: ['brand', 'weight']
  };
  const plan = buildContractEffortPlan({
    missingRequiredFields: ['brand', 'weight'],
    categoryConfig
  });
  const brandPlan = plan.fields.find((f) => f.field === 'brand');
  const weightPlan = plan.fields.find((f) => f.field === 'weight');

  assert.ok(brandPlan, 'brand should be in plan');
  assert.equal(brandPlan.ai_mode, 'judge');
  assert.equal(brandPlan.ai_max_calls, 3);

  assert.ok(weightPlan, 'weight should be in plan');
  assert.equal(weightPlan.ai_mode, 'advisory');
  assert.equal(weightPlan.ai_max_calls, 2);
});

// ---------------------------------------------------------------------------
// Per-field call budget tracking — ai_max_calls enforcement
// ---------------------------------------------------------------------------

test('ruleAiMaxCalls: default effort (medium difficulty → effort 5) → max_calls 2', () => {
  // A field with no explicit effort defaults to medium difficulty → effort 5 → max_calls 2
  assert.equal(ruleAiMaxCalls({ priority: { difficulty: 'medium' } }), 2);
});

test('ruleAiMaxCalls: hard difficulty default effort → max_calls 3', () => {
  assert.equal(ruleAiMaxCalls({ priority: { difficulty: 'hard' } }), 3);
});

test('ruleAiMaxCalls: easy difficulty default effort → max_calls 1', () => {
  assert.equal(ruleAiMaxCalls({ priority: { difficulty: 'easy' } }), 1);
});

// ---------------------------------------------------------------------------
// resolveAiModeWithInheritance — component owner inheritance
// ---------------------------------------------------------------------------

test('resolveAiModeWithInheritance: explicit mode always wins', () => {
  const rules = {
    sensor: {
      priority: { required_level: 'expected' },
      component: { type: 'sensor' },
      ai_assist: { mode: 'judge' }
    },
    max_dpi: {
      priority: { required_level: 'expected' },
      enum: { source: 'component_db.sensor' },
      ai_assist: { mode: 'advisory' }
    }
  };
  assert.equal(resolveAiModeWithInheritance('max_dpi', rules), 'advisory');
});

test('resolveAiModeWithInheritance: inherits from component owner when no explicit mode', () => {
  const rules = {
    sensor: {
      priority: { required_level: 'identity' },
      component: { type: 'sensor' }
    },
    max_dpi: {
      priority: { required_level: 'optional' },
      enum: { source: 'component_db.sensor' }
    }
  };
  // max_dpi would normally be 'off' (optional), but inherits 'judge' from sensor (identity)
  assert.equal(resolveAiModeWithInheritance('max_dpi', rules), 'judge');
});

test('resolveAiModeWithInheritance: component owner uses standard derivation', () => {
  const rules = {
    sensor: {
      priority: { required_level: 'expected', difficulty: 'hard' },
      component: { type: 'sensor' }
    }
  };
  assert.equal(resolveAiModeWithInheritance('sensor', rules), 'planner');
});

test('resolveAiModeWithInheritance: no component link falls back to standard', () => {
  const rules = {
    weight: { priority: { required_level: 'expected', difficulty: 'medium' } }
  };
  assert.equal(resolveAiModeWithInheritance('weight', rules), 'advisory');
});

test('resolveAiModeWithInheritance: unknown field returns off', () => {
  assert.equal(resolveAiModeWithInheritance('nonexistent', {}), 'off');
});

// ---------------------------------------------------------------------------
// ruleAiMaxTokens — auto-derivation from AI mode
// ---------------------------------------------------------------------------

test('ruleAiMaxTokens: off → 0', () => {
  assert.equal(ruleAiMaxTokens({ priority: { required_level: 'optional' } }), 0);
});

test('ruleAiMaxTokens: advisory → 4096', () => {
  assert.equal(ruleAiMaxTokens({ priority: { required_level: 'expected', difficulty: 'easy' } }), 4096);
});

test('ruleAiMaxTokens: planner → 8192', () => {
  assert.equal(ruleAiMaxTokens({ priority: { required_level: 'expected', difficulty: 'hard' } }), 8192);
});

test('ruleAiMaxTokens: judge → 16384', () => {
  assert.equal(ruleAiMaxTokens({ priority: { required_level: 'identity' } }), 16384);
});

test('ruleAiMaxTokens: explicit override', () => {
  assert.equal(ruleAiMaxTokens({ ai_assist: { max_tokens: 2048 } }), 2048);
});

test('ruleAiMaxTokens: explicit zero falls through to auto', () => {
  assert.equal(ruleAiMaxTokens({ ai_assist: { max_tokens: 0 }, priority: { required_level: 'identity' } }), 16384);
});

// ---------------------------------------------------------------------------
// autoGenerateExtractionGuidance — generates notes from field properties
// ---------------------------------------------------------------------------

test('autoGenerateExtractionGuidance: explicit note overrides auto', () => {
  const note = autoGenerateExtractionGuidance({
    ai_assist: { reasoning_note: 'Custom guidance' }
  }, 'weight');
  assert.equal(note, 'Custom guidance');
});

test('autoGenerateExtractionGuidance: identity field gets identity guidance', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'identity' },
    contract: { type: 'string', shape: 'scalar' }
  }, 'sku');
  assert.ok(note.includes('Identity field'), 'should mention identity');
  assert.ok(note.includes('Cross-reference'), 'should mention cross-reference');
});

test('autoGenerateExtractionGuidance: numeric field with unit', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'expected' },
    contract: { type: 'number', unit: 'g' }
  }, 'weight');
  assert.ok(note.includes('Numeric field'), 'should mention numeric');
  assert.ok(note.includes('g'), 'should mention unit');
});

test('autoGenerateExtractionGuidance: boolean field', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'expected' },
    parse: { template: 'boolean_yes_no_unk' }
  }, 'rgb');
  assert.ok(note.includes('Boolean field'), 'should mention boolean');
});

test('autoGenerateExtractionGuidance: component reference', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'required' },
    component: { type: 'sensor' },
    parse: { template: 'component_reference' }
  }, 'sensor');
  assert.ok(note.includes('Component reference'), 'should mention component');
  assert.ok(note.includes('sensor'), 'should mention component type');
});

test('autoGenerateExtractionGuidance: hard difficulty', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'expected', difficulty: 'hard' },
    contract: { type: 'number', unit: 'ms' }
  }, 'click_latency');
  assert.ok(note.includes('inconsistent across sources'), 'should warn about inconsistency');
});

test('autoGenerateExtractionGuidance: list field', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'expected' },
    contract: { type: 'string', shape: 'list' }
  }, 'colors');
  assert.ok(note.includes('multiple values'), 'should mention multi-value');
});

test('autoGenerateExtractionGuidance: closed enum', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'expected' },
    enum: { policy: 'closed', source: 'data_lists.shape' }
  }, 'shape');
  assert.ok(note.includes('Closed enum'), 'should mention closed enum');
});

test('autoGenerateExtractionGuidance: date field by key name', () => {
  const note = autoGenerateExtractionGuidance({
    priority: { required_level: 'expected' },
    contract: { type: 'string' }
  }, 'release_date');
  assert.ok(note.includes('Date field'), 'should detect date from key name');
});

test('autoGenerateExtractionGuidance: empty rule gets text field guidance', () => {
  const note = autoGenerateExtractionGuidance({}, 'unknown_field');
  assert.ok(note.length > 0, 'should produce non-empty guidance');
  assert.ok(note.includes('extract'), 'should have extraction guidance');
});

// ---------------------------------------------------------------------------
// resolveBatchModel — returns maxTokens from per-field ai_assist
// ---------------------------------------------------------------------------

test('resolveBatchModel: returns maxTokens from per-field config', () => {
  const batch = {
    id: 'physical',
    fields: ['weight', 'height'],
    difficulty: { easy: 2, medium: 0, hard: 0, instrumented: 0 }
  };
  const fieldRules = {
    weight: { priority: { required_level: 'identity' } },
    height: { priority: { required_level: 'expected', difficulty: 'easy' } }
  };
  const result = resolveBatchModel({
    batch,
    config: { llmModelFast: 'fast-model', llmModelReasoning: 'deep-model' },
    fieldRules
  });
  // weight=identity→judge→16384, height=expected+easy→advisory→4096, MAX=16384
  assert.equal(result.maxTokens, 16384);
});

test('resolveBatchModel: explicit max_tokens override', () => {
  const batch = {
    id: 'physical',
    fields: ['weight'],
    difficulty: { easy: 1, medium: 0, hard: 0, instrumented: 0 }
  };
  const fieldRules = {
    weight: { ai_assist: { max_tokens: 2048 } }
  };
  const result = resolveBatchModel({
    batch,
    config: { llmModelFast: 'fast-model', llmModelReasoning: 'deep-model' },
    fieldRules
  });
  assert.equal(result.maxTokens, 2048);
});

// ---------------------------------------------------------------------------
// Dynamic escalation — forcedHighFields triggers reasoning for failed fields
// ---------------------------------------------------------------------------

test('resolveBatchModel: escalated fields trigger reasoning via forcedHighFields', () => {
  const batch = {
    id: 'physical',
    fields: ['weight'],
    difficulty: { easy: 1, medium: 0, hard: 0, instrumented: 0 }
  };
  // weight is easy, normally fast. But it failed last round → escalated
  const result = resolveBatchModel({
    batch,
    config: { llmModelFast: 'fast-model', llmModelReasoning: 'deep-model' },
    forcedHighFields: ['weight']
  });
  assert.equal(result.reasoningMode, true, 'escalated field should trigger reasoning');
  assert.equal(result.reason, 'extract_forced_high_batch');
});
