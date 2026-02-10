import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLlmCostUsd, normalizeUsage } from '../src/billing/costRates.js';

test('computeLlmCostUsd applies deepseek-chat model-specific rate overrides', () => {
  const usage = normalizeUsage({
    prompt_tokens: 1_000_000,
    completion_tokens: 1_000_000,
    cached_prompt_tokens: 500_000
  });
  const result = computeLlmCostUsd({
    usage,
    model: 'deepseek-chat',
    rates: {
      llmCostInputPer1M: 99,
      llmCostOutputPer1M: 99,
      llmCostCachedInputPer1M: 99,
      llmCostInputPer1MDeepseekChat: 0.28,
      llmCostOutputPer1MDeepseekChat: 0.42,
      llmCostCachedInputPer1MDeepseekChat: 0.028
    }
  });
  // input: 0.5M*0.28=0.14, output:1M*0.42=0.42, cached:0.5M*0.028=0.014 -> 0.574
  assert.equal(result.costUsd, 0.574);
});

