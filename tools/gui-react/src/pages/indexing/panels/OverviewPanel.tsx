import { useState } from 'react';
import { Tip } from '../../../components/common/Tip';
import {
  ActivityGauge,
  formatNumber,
  formatDateTime,
  formatDuration,
  llmPhaseLabel,
  llmPhaseBadgeClasses,
  panelStateChipClasses,
  prettyJsonText,
  isJsonText,
} from '../helpers';
import type { PanelStateToken } from '../types';

interface PendingLlmRow {
  key: string;
  reason: string;
  model: string;
  provider: string;
  routeRole: string;
  pending: number;
  firstStartedAtMs: number;
}

interface LlmTracePartial {
  purpose?: string | null;
  model?: string | null;
  ts?: string | null;
  response_preview?: string | null;
}

interface PipelineStep {
  label: string;
  state: PanelStateToken;
}

interface OverviewPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  category: string;
  processStateLabel: string;
  processStatus: { pid?: number; command?: string; exitCode?: number | null } | null | undefined;
  processRunning: boolean;
  selectedIndexLabRun: { started_at?: string } | null;
  selectedRunLiveDuration: string;
  runtimeActivity: { currentPerMin: number; peakPerMin: number };
  llmActivity: { currentPerMin: number; peakPerMin: number };
  pendingLlmTotal: number;
  pendingLlmPeak: number;
  pendingLlmRows: PendingLlmRow[];
  activityNowMs: number;
  activePendingLlm: PendingLlmRow | null;
  pendingPromptPretty: string;
  pendingPromptPhase: string;
  pendingPromptIsJson: boolean;
  lastReceivedResponseTrace: LlmTracePartial | null;
  lastReceivedResponseEvent: LlmTracePartial | null;
  lastReceivedResponsePretty: string;
  lastReceivedPhase: string;
  lastReceivedResponseIsJson: boolean;
  pipelineSteps: PipelineStep[];
}

export function OverviewPanel({
  collapsed,
  onToggle,
  category,
  processStateLabel,
  processStatus,
  processRunning,
  selectedIndexLabRun,
  selectedRunLiveDuration,
  runtimeActivity,
  llmActivity,
  pendingLlmTotal,
  pendingLlmPeak,
  pendingLlmRows,
  activityNowMs,
  activePendingLlm,
  pendingPromptPretty,
  pendingPromptPhase,
  pendingPromptIsJson,
  lastReceivedResponseTrace,
  lastReceivedResponseEvent,
  lastReceivedResponsePretty,
  lastReceivedPhase,
  lastReceivedResponseIsJson,
  pipelineSteps,
}: OverviewPanelProps) {
  const [pendingPromptCollapsed, setPendingPromptCollapsed] = useState(true);
  const [lastResponseCollapsed, setLastResponseCollapsed] = useState(true);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4" style={{ order: 10 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-6 h-6 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Indexing Lab (Phase 01)</h2>
            {!collapsed ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                One click run path. Run IndexLab executes search -&gt; fetch -&gt; parse -&gt; index -&gt; NeedSet/Phase 02/Phase 03 automatically for <span className="font-mono">{category}</span>.
              </p>
            ) : null}
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          process {processStateLabel}
          {processStatus?.pid ? ` | pid ${processStatus.pid}` : ''}
          {processStatus?.command ? ` | ${processStatus.command}` : ''}
          {!processRunning && processStatus?.exitCode !== null && processStatus?.exitCode !== undefined ? ` | exit ${processStatus.exitCode}` : ''}
          {selectedIndexLabRun?.started_at ? ` | runtime ${selectedRunLiveDuration}` : ''}
        </div>
      </div>
      {!collapsed ? (
        <div className="mt-3 space-y-2">
          <ActivityGauge
            label="overall run activity"
            currentPerMin={runtimeActivity.currentPerMin}
            peakPerMin={runtimeActivity.peakPerMin}
            active={processRunning}
          />
          <ActivityGauge
            label="llm call activity"
            currentPerMin={llmActivity.currentPerMin}
            peakPerMin={llmActivity.peakPerMin}
            active={processRunning || pendingLlmTotal > 0}
            tooltip="Live LLM call lifecycle events (started/completed/failed) per minute."
          />
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center text-gray-600 dark:text-gray-300">
                pending llm calls
                <Tip text="Current in-flight LLM calls grouped by purpose + model. Bars shrink to zero when calls complete." />
              </div>
              <div className={`font-semibold ${pendingLlmTotal > 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}`}>
                {formatNumber(pendingLlmTotal)}
              </div>
            </div>
            {pendingLlmRows.length === 0 ? (
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                no llm calls pending
              </div>
            ) : (
              <div className="mt-2 space-y-1.5">
                {pendingLlmRows.slice(0, 8).map((row) => {
                  const widthPct = Math.max(8, Math.min(100, (Number(row.pending || 0) / Math.max(1, pendingLlmPeak)) * 100));
                  const sinceMs = row.firstStartedAtMs > 0 ? Math.max(0, activityNowMs - row.firstStartedAtMs) : 0;
                  return (
                    <div key={`pending-llm:${row.key}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="truncate text-gray-700 dark:text-gray-200" title={`${row.reason} | ${row.model}`}>
                          {row.reason} | {row.model}
                        </div>
                        <div className="font-semibold text-emerald-600 dark:text-emerald-300">
                          {formatNumber(Number(row.pending || 0))}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                        <span className="truncate" title={`${row.provider} | ${row.routeRole || 'n/a'}`}>
                          {row.provider} | role {row.routeRole || 'n/a'}
                        </span>
                        <span>{sinceMs > 0 ? `pending ${formatDuration(sinceMs)}` : 'pending'}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full rounded bg-emerald-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className={`rounded border px-2 py-2 ${activePendingLlm ? 'border-emerald-400 dark:border-emerald-500' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <div className={`font-semibold ${activePendingLlm ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-800 dark:text-gray-200'}`}>
                    Pending LLM Prompt
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${llmPhaseBadgeClasses(pendingPromptPhase)}`}>
                    {llmPhaseLabel(pendingPromptPhase)}
                  </span>
                  {pendingPromptIsJson ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      JSON
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() => setPendingPromptCollapsed((prev) => !prev)}
                  className={`inline-flex items-center justify-center w-5 h-5 text-[10px] rounded border ${activePendingLlm ? 'border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                  title={pendingPromptCollapsed ? 'Open panel' : 'Close panel'}
                >
                  {pendingPromptCollapsed ? '+' : '-'}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {activePendingLlm
                  ? `${activePendingLlm.reason} | ${activePendingLlm.model} | role ${activePendingLlm.routeRole || 'n/a'} | pending ${formatNumber(Number(activePendingLlm.pending || 0))}`
                  : 'no pending prompt'}
              </div>
              {!pendingPromptCollapsed ? (
                <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] max-h-56 overflow-y-auto text-gray-700 dark:text-gray-200">
                  {activePendingLlm
                    ? (pendingPromptPretty || '(prompt preview not available yet for the active call)')
                    : '(no pending llm prompt)'}
                </pre>
              ) : null}
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="font-semibold text-gray-800 dark:text-gray-200">
                    Last Received Response
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${llmPhaseBadgeClasses(lastReceivedPhase)}`}>
                    {llmPhaseLabel(lastReceivedPhase)}
                  </span>
                  {lastReceivedResponseIsJson ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      JSON
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() => setLastResponseCollapsed((prev) => !prev)}
                  className="inline-flex items-center justify-center w-5 h-5 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title={lastResponseCollapsed ? 'Open panel' : 'Close panel'}
                >
                  {lastResponseCollapsed ? '+' : '-'}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {lastReceivedResponseTrace
                  ? `${String(lastReceivedResponseTrace.purpose || 'unknown')} | ${String(lastReceivedResponseTrace.model || 'unknown')} | ${formatDateTime(lastReceivedResponseTrace.ts || null)}`
                  : lastReceivedResponseEvent
                    ? `${String(lastReceivedResponseEvent.purpose || 'unknown')} | ${String(lastReceivedResponseEvent.model || 'unknown')} | ${formatDateTime(lastReceivedResponseEvent.ts || null)}`
                  : 'no response received yet'}
              </div>
              {!lastResponseCollapsed ? (
                <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] max-h-56 overflow-y-auto text-gray-700 dark:text-gray-200">
                  {lastReceivedResponsePretty || '(no response trace yet)'}
                </pre>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 text-xs">
            {pipelineSteps.map((step) => (
              <div key={`pipeline-step:${step.label}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 flex items-center justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-300 truncate" title={step.label}>{step.label}</span>
                <span className={`px-1.5 py-0.5 rounded ${panelStateChipClasses(step.state)}`}>
                  {step.state}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
