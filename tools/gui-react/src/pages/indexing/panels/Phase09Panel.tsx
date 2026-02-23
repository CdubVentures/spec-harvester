import { Tip } from '../../../components/common/Tip';
import { formatNumber } from '../helpers';
import type { RoundSummaryResponse } from '../types';

interface Phase09PanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  roundSummaryResp: RoundSummaryResponse | null | undefined;
}

export function Phase09Panel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  roundSummaryResp,
}: Phase09PanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 54 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Convergence Round Summary (Phase 09)</span>
          <Tip text="Per-round convergence progress: NeedSet size, missing required fields, confidence progression, improvement tracking, and stop reason. Works with single-pass runs (synthesized round 0) and multi-round convergence loops." />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'} | {roundSummaryResp?.round_count ?? 0} round{(roundSummaryResp?.round_count ?? 0) !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
      {!collapsed ? (() => {
        const rounds = roundSummaryResp?.rounds ?? [];
        const stopReason = roundSummaryResp?.stop_reason ?? null;
        return (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">rounds</div>
                <div className="font-semibold">{rounds.length}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">stop reason</div>
                <div className="font-semibold">
                  {stopReason ? (
                    <span className={`px-1.5 py-0.5 rounded ${
                      stopReason === 'complete'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : stopReason === 'max_rounds_reached'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                    }`}>
                      {stopReason}
                    </span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">-</span>
                  )}
                </div>
              </div>
              {rounds.length > 0 && (
                <>
                  <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                    <div className="text-gray-500 dark:text-gray-400">final confidence</div>
                    <div className="font-semibold">{(rounds[rounds.length - 1].confidence * 100).toFixed(1)}%</div>
                  </div>
                  <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                    <div className="text-gray-500 dark:text-gray-400">validated</div>
                    <div className="font-semibold">
                      {rounds[rounds.length - 1].validated ? (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">yes</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">no</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">round</th>
                    <th className="py-1 pr-3">NeedSet size</th>
                    <th className="py-1 pr-3">missing req</th>
                    <th className="py-1 pr-3">critical</th>
                    <th className="py-1 pr-3">confidence</th>
                    <th className="py-1 pr-3">improved</th>
                    <th className="py-1 pr-3">reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={7}>no round data yet</td>
                    </tr>
                  ) : (
                    rounds.map((row, idx) => {
                      const prevConf = idx > 0 ? rounds[idx - 1].confidence : null;
                      const confDelta = prevConf !== null ? row.confidence - prevConf : null;
                      const prevNeedset = idx > 0 ? rounds[idx - 1].needset_size : null;
                      const needsetDelta = prevNeedset !== null ? row.needset_size - prevNeedset : null;
                      return (
                        <tr key={`phase9-round:${row.round}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3 font-mono">{row.round}</td>
                          <td className="py-1 pr-3">
                            {row.needset_size}
                            {needsetDelta !== null && needsetDelta !== 0 && (
                              <span className={`ml-1 ${needsetDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {needsetDelta > 0 ? '+' : ''}{needsetDelta}
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-3">{row.missing_required_count}</td>
                          <td className="py-1 pr-3">{row.critical_count}</td>
                          <td className="py-1 pr-3">
                            <div className="flex items-center gap-1">
                              <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                                <div
                                  className={`h-full rounded ${row.confidence >= 0.8 ? 'bg-emerald-500' : row.confidence >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                  style={{ width: `${Math.min(100, row.confidence * 100)}%` }}
                                />
                              </div>
                              <span>{(row.confidence * 100).toFixed(1)}%</span>
                              {confDelta !== null && confDelta !== 0 && (
                                <span className={`${confDelta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                  {confDelta > 0 ? '+' : ''}{(confDelta * 100).toFixed(1)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1 pr-3">
                            {row.improved ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">yes</span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">no</span>
                            )}
                          </td>
                          <td className="py-1 pr-3 font-mono text-[10px]">
                            {(row.improvement_reasons || []).join(', ') || '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        );
      })() : null}
    </div>
  );
}
