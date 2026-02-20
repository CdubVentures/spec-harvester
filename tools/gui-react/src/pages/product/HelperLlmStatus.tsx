import type { RuntimeEvent } from '../../types/events';

interface HelperLlmStatusProps {
  events: RuntimeEvent[];
}

export function HelperLlmStatus({ events }: HelperLlmStatusProps) {
  const helperLoaded = events.some(e => e.event === 'helper_files_context_loaded');
  const supportiveFill = events.some(e => e.event === 'helper_supportive_fill_applied');
  const llmCalls = events.filter(e => e.event === 'llm_call_completed');
  const llmFailed = events.filter(e => e.event === 'llm_call_failed');
  const llmUsage = events.filter(e => e.event === 'llm_call_usage');

  const totalTokens = llmUsage.reduce((sum, e) => {
    const input = Number(e.inputTokens || e.input_tokens || 0);
    const output = Number(e.outputTokens || e.output_tokens || 0);
    return sum + input + output;
  }, 0);

  const totalCost = llmUsage.reduce((sum, e) => sum + Number(e.costUsd || e.cost_usd || 0), 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
      <h3 className="text-sm font-semibold mb-2">Helper + LLM Status</h3>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${helperLoaded ? 'bg-green-500' : 'bg-gray-400'}`} />
          Helper Loaded
        </div>
        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${supportiveFill ? 'bg-green-500' : 'bg-gray-400'}`} />
          Supportive Fill
        </div>
        <div>LLM Calls: {llmCalls.length}</div>
        <div>LLM Failed: {llmFailed.length}</div>
        <div>Total Tokens: {totalTokens.toLocaleString()}</div>
        <div>Total Cost: ${totalCost.toFixed(4)}</div>
      </div>
    </div>
  );
}
