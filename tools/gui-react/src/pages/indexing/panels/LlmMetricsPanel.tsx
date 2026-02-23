import { useState } from 'react';
import { Tip } from '../../../components/common/Tip';
import {
  formatNumber,
  formatDateTime,
  panelStateChipClasses,
} from '../helpers';
import type { PanelStateToken } from '../types';

interface LlmMetricsRunRow {
  run_id?: string | null;
  calls?: number;
  cost_usd?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface LlmMetricsByModelRow {
  provider?: string;
  model?: string;
  calls?: number;
  cost_usd?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface LlmPricingRow {
  knob: string;
  provider: string;
  model: string;
  token_cap: number;
  default_model?: string | null;
  uses_default_model?: boolean;
  default_token_cap?: number | null;
  uses_default_token_cap?: boolean;
  input_per_1m: number;
  output_per_1m: number;
  cached_input_per_1m: number;
}

interface LlmMetricsPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  indexingLlmMetrics: {
    generated_at?: string;
    total_calls?: number;
    total_cost_usd?: number;
    total_prompt_tokens?: number;
    total_completion_tokens?: number;
    by_model?: LlmMetricsByModelRow[];
  } | null | undefined;
  selectedRunLlmMetrics: LlmMetricsRunRow | null;
  selectedLlmPricingRows: LlmPricingRow[];
  indexingLlmConfig: {
    pricing_meta?: {
      as_of?: string | null;
      sources?: Record<string, string>;
    };
  } | null | undefined;
}

export function LlmMetricsPanel({
  collapsed,
  onToggle,
  indexingLlmMetrics,
  selectedRunLlmMetrics,
  selectedLlmPricingRows,
  indexingLlmConfig,
}: LlmMetricsPanelProps) {
  const [activeModelPricingCollapsed, setActiveModelPricingCollapsed] = useState(true);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 90 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>LLM Runtime Metrics</span>
          <Tip text="Live call/cost/token counters from ledger + pricing rows for all currently selected route/fallback models." />
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          updated {formatDateTime(indexingLlmMetrics?.generated_at || null)}
        </div>
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">selected run calls</div>
              <div className="font-semibold">{formatNumber(Number(selectedRunLlmMetrics?.calls || 0))}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">selected run cost</div>
              <div className="font-semibold">${formatNumber(Number(selectedRunLlmMetrics?.cost_usd || 0), 6)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">selected run prompt</div>
              <div className="font-semibold">{formatNumber(Number(selectedRunLlmMetrics?.prompt_tokens || 0))}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">selected run completion</div>
              <div className="font-semibold">{formatNumber(Number(selectedRunLlmMetrics?.completion_tokens || 0))}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">period calls</div>
              <div className="font-semibold">{formatNumber(Number(indexingLlmMetrics?.total_calls || 0))}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">period cost</div>
              <div className="font-semibold">${formatNumber(Number(indexingLlmMetrics?.total_cost_usd || 0), 6)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">period prompt</div>
              <div className="font-semibold">{formatNumber(Number(indexingLlmMetrics?.total_prompt_tokens || 0))}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">period completion</div>
              <div className="font-semibold">{formatNumber(Number(indexingLlmMetrics?.total_completion_tokens || 0))}</div>
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-gray-800 dark:text-gray-200">
              <div className="flex items-center gap-1.5">
                <span>Active Model Pricing ({formatNumber(selectedLlmPricingRows.length)} rows)</span>
                <Tip text="Per-knob model pricing used for live cost estimation. Rows also show whether the current model matches the default role model." />
                {indexingLlmConfig?.pricing_meta?.as_of ? (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    as of {indexingLlmConfig.pricing_meta.as_of}
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => setActiveModelPricingCollapsed((prev) => !prev)}
                className="inline-flex items-center justify-center w-5 h-5 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                title={activeModelPricingCollapsed ? 'Open pricing table' : 'Close pricing table'}
              >
                {activeModelPricingCollapsed ? '+' : '-'}
              </button>
            </div>
            {!activeModelPricingCollapsed ? (
              <>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  sources:
                  {Object.entries(indexingLlmConfig?.pricing_meta?.sources || {}).map(([provider, link]) => (
                    <span key={`pricing-source:${provider}`} className="ml-2">
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {provider}
                      </a>
                    </span>
                  ))}
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">
                        <span className="inline-flex items-center">knob<Tip text="The lane/control that owns this model selection." /></span>
                      </th>
                      <th className="py-1 pr-3">
                        <span className="inline-flex items-center">provider<Tip text="Resolved provider by selected model name (openai/gemini/deepseek)." /></span>
                      </th>
                      <th className="py-1 pr-3">
                        <span className="inline-flex items-center">model<Tip text="Current selected model with default-model linkage badge." /></span>
                      </th>
                      <th className="py-1 pr-3">
                        <span className="inline-flex items-center">token cap<Tip text="Current max output tokens for this knob (compared to default cap)." /></span>
                      </th>
                      <th className="py-1 pr-3">
                        <span className="inline-flex items-center">input / 1M<Tip text="USD per 1M input tokens." /></span>
                      </th>
                      <th className="py-1 pr-3">
                        <span className="inline-flex items-center">output / 1M<Tip text="USD per 1M output tokens." /></span>
                      </th>
                      <th className="py-1 pr-3">
                        <span className="inline-flex items-center">cached / 1M<Tip text="USD per 1M cached-input tokens (cache-hit pricing)." /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLlmPricingRows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={7}>no selected model pricing rows</td>
                      </tr>
                    )}
                    {selectedLlmPricingRows.map((row) => (
                      <tr key={`selected-pricing:${row.knob}:${row.model}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3">{row.knob}</td>
                        <td className="py-1 pr-3">{row.provider}</td>
                        <td className="py-1 pr-3 font-mono">
                          <span>{row.model}</span>
                          {row.default_model ? (
                            <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${row.uses_default_model ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                              {row.uses_default_model ? 'default' : `default ${row.default_model}`}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3">
                          <span>{formatNumber(Number(row.token_cap || 0))}</span>
                          {row.default_token_cap ? (
                            <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${row.uses_default_token_cap ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                              {row.uses_default_token_cap ? 'default' : `default ${formatNumber(Number(row.default_token_cap || 0))}`}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3">${formatNumber(row.input_per_1m, 4)}</td>
                        <td className="py-1 pr-3">${formatNumber(row.output_per_1m, 4)}</td>
                        <td className="py-1 pr-3">${formatNumber(row.cached_input_per_1m, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              By Model ({formatNumber((indexingLlmMetrics?.by_model || []).length)} rows)
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">provider</th>
                  <th className="py-1 pr-3">model</th>
                  <th className="py-1 pr-3">calls</th>
                  <th className="py-1 pr-3">cost usd</th>
                  <th className="py-1 pr-3">prompt</th>
                  <th className="py-1 pr-3">completion</th>
                </tr>
              </thead>
              <tbody>
                {(indexingLlmMetrics?.by_model || []).length === 0 && (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no llm usage rows yet</td>
                  </tr>
                )}
                {(indexingLlmMetrics?.by_model || []).slice(0, 12).map((row, idx) => (
                  <tr key={`${row.provider || 'unknown'}:${row.model || 'model'}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3">{row.provider || '-'}</td>
                    <td className="py-1 pr-3 font-mono">{row.model || '-'}</td>
                    <td className="py-1 pr-3">{formatNumber(Number(row.calls || 0))}</td>
                    <td className="py-1 pr-3">${formatNumber(Number(row.cost_usd || 0), 6)}</td>
                    <td className="py-1 pr-3">{formatNumber(Number(row.prompt_tokens || 0))}</td>
                    <td className="py-1 pr-3">{formatNumber(Number(row.completion_tokens || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
