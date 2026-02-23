import { Tip } from '../../../components/common/Tip';
import { ActivityGauge, formatNumber, formatDateTime, normalizeToken } from '../helpers';
import type { IndexLabAutomationJobRow, IndexLabAutomationActionRow } from '../types';

interface Phase06bPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  phase6bStatusLabel: string;
  phase6bActivity: { currentPerMin: number; peakPerMin: number };
  processRunning: boolean;
  phase6bSummary: {
    totalJobs: number;
    queueDepth: number;
    activeJobs: number;
    queued: number;
    running: number;
    done: number;
    failed: number;
    cooldown: number;
    repairSearch: number;
    stalenessRefresh: number;
    deficitRediscovery: number;
    domainBackoff: number;
  };
  phase6bJobs: IndexLabAutomationJobRow[];
  phase6bActions: IndexLabAutomationActionRow[];
}

export function Phase06bPanel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  phase6bStatusLabel,
  phase6bActivity,
  processRunning,
  phase6bSummary,
  phase6bJobs,
  phase6bActions,
}: Phase06bPanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 51 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Automation Queue (Phase 06B)</span>
          <Tip text="Scheduler control-plane proof: repair search, staleness refresh, and NeedSet deficit rediscovery job transitions." />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'} | {phase6bStatusLabel}
          </div>
          <ActivityGauge
            label="phase 06b activity"
            currentPerMin={phase6bActivity.currentPerMin}
            peakPerMin={phase6bActivity.peakPerMin}
            active={processRunning}
          />
        </div>
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-12 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">total jobs<Tip text="Total Phase 06B automation jobs derived for this run." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.totalJobs)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">queue depth<Tip text="Queued + running + failed jobs waiting on scheduler follow-through." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.queueDepth)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">active<Tip text="Queued + running jobs currently active in automation flow." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.activeJobs)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">cooldown<Tip text="Jobs currently in cooldown/backoff state waiting for next retry window." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.cooldown)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">queued<Tip text="Queued jobs pending execution." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.queued)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">running<Tip text="Jobs currently in running state." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.running)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">done<Tip text="Jobs completed successfully in this run timeline." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.done)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">failed<Tip text="Jobs that ended without usable results and need follow-up." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.failed)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">repair jobs<Tip text="Repair-search jobs created from URL-health failure signals." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.repairSearch)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">refresh jobs<Tip text="Staleness/content-hash refresh jobs derived from repeated hash signals." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.stalenessRefresh)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">deficit jobs<Tip text="NeedSet-driven rediscovery jobs for fields still below quality gates." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.deficitRediscovery)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">domain backoff<Tip text="Host/domain backoff jobs from blocked/cooldown conditions." /></div>
              <div className="font-semibold">{formatNumber(phase6bSummary.domainBackoff)}</div>
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Queue Jobs ({formatNumber(phase6bJobs.length)} shown)
              <Tip text="Current scheduler-style job ledger with dedupe key, source signal, next retry, and reason tags." />
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">type</th>
                  <th className="py-1 pr-3">status</th>
                  <th className="py-1 pr-3">signal</th>
                  <th className="py-1 pr-3">priority</th>
                  <th className="py-1 pr-3">field targets</th>
                  <th className="py-1 pr-3">query / url</th>
                  <th className="py-1 pr-3">domain</th>
                  <th className="py-1 pr-3">attempts</th>
                  <th className="py-1 pr-3">next run</th>
                  <th className="py-1 pr-3">reasons</th>
                </tr>
              </thead>
              <tbody>
                {phase6bJobs.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={10}>no phase 06b jobs yet</td>
                  </tr>
                ) : (
                  phase6bJobs.slice(0, 40).map((row) => (
                    <tr key={`phase6b-job:${row.job_id}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.job_type || '-'}</td>
                      <td className="py-1 pr-3">
                        <span className={`px-1.5 py-0.5 rounded ${
                          normalizeToken(row.status || '') === 'done'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : normalizeToken(row.status || '') === 'running'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                              : normalizeToken(row.status || '') === 'failed'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                : normalizeToken(row.status || '') === 'cooldown'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                        }`}>
                          {row.status || '-'}
                        </span>
                      </td>
                      <td className="py-1 pr-3">{row.source_signal || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.priority || 0))}</td>
                      <td className="py-1 pr-3 font-mono">{(row.field_targets || []).slice(0, 3).join(', ') || '-'}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[24rem]" title={row.query || row.url || ''}>{row.query || row.url || '-'}</td>
                      <td className="py-1 pr-3 font-mono">{row.domain || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.attempt_count || 0))}</td>
                      <td className="py-1 pr-3">{formatDateTime(row.next_run_at || null)}</td>
                      <td className="py-1 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {(row.reason_tags || []).slice(0, 4).map((reason) => (
                            <span key={`phase6b-job-reason:${row.job_id}:${reason}`} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                              {reason}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Transition Feed ({formatNumber(phase6bActions.length)} shown)
              <Tip text="Latest queue transitions/action feed to prove scheduling behavior over time." />
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">time</th>
                  <th className="py-1 pr-3">event</th>
                  <th className="py-1 pr-3">job</th>
                  <th className="py-1 pr-3">status</th>
                  <th className="py-1 pr-3">detail</th>
                </tr>
              </thead>
              <tbody>
                {phase6bActions.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no automation transitions yet</td>
                  </tr>
                ) : (
                  phase6bActions.slice(0, 40).map((row, idx) => (
                    <tr key={`phase6b-action:${row.job_id || idx}:${row.event || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3">{formatDateTime(row.ts || null)}</td>
                      <td className="py-1 pr-3 font-mono">{row.event || '-'}</td>
                      <td className="py-1 pr-3 font-mono">{row.job_type || '-'}</td>
                      <td className="py-1 pr-3">{row.status || '-'}</td>
                      <td className="py-1 pr-3">{row.detail || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
