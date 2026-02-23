import { Tip } from '../../../components/common/Tip';
import type { LearningFeedResponse } from '../../../types/learning';

interface LearningPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  learningFeedResp: LearningFeedResponse | null | undefined;
}

export function LearningPanel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  learningFeedResp,
}: LearningPanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 55 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Learning Feed (Phase 10)</span>
          <Tip text="Acceptance-gated learning updates: which field values passed confidence, evidence, and tier gates for compounding into future runs." />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'} | {learningFeedResp?.gate_summary?.total ?? 0} evaluated | {learningFeedResp?.gate_summary?.accepted ?? 0} accepted
          </div>
        </div>
      </div>
      {!collapsed ? (() => {
        const updates = learningFeedResp?.updates ?? [];
        const summary = learningFeedResp?.gate_summary;
        const rejReasons = summary?.rejection_reasons ?? {};
        if (!updates.length) {
          return (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic py-4 text-center">
              No learning gate results yet for this run.
            </div>
          );
        }
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <div className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                Total: {summary?.total ?? 0}
              </div>
              <div className="px-2 py-1 rounded text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">
                Accepted: {summary?.accepted ?? 0}
              </div>
              <div className="px-2 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300">
                Rejected: {summary?.rejected ?? 0}
              </div>
              {Object.entries(rejReasons).map(([reason, count]) => (
                <div key={reason} className="px-2 py-1 rounded text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300">
                  {reason}: {count as number}
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                    <th className="py-1 pr-3 font-medium">Field</th>
                    <th className="py-1 pr-3 font-medium">Value</th>
                    <th className="py-1 pr-3 font-medium">Confidence</th>
                    <th className="py-1 pr-3 font-medium">Refs</th>
                    <th className="py-1 pr-3 font-medium">Tiers</th>
                    <th className="py-1 pr-3 font-medium">Status</th>
                    <th className="py-1 pr-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {updates.map((u, i) => (
                    <tr key={`${u.field}-${i}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono text-gray-800 dark:text-gray-200">{u.field}</td>
                      <td className="py-1 pr-3 text-gray-700 dark:text-gray-300 max-w-[200px] truncate" title={u.value}>{u.value}</td>
                      <td className="py-1 pr-3">
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className={`h-full rounded ${u.confidence >= 0.85 ? 'bg-green-500' : u.confidence >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'}`}
                              style={{ width: `${Math.round(u.confidence * 100)}%` }}
                            />
                          </div>
                          <span className="text-gray-600 dark:text-gray-400">{(u.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{u.refs_found}</td>
                      <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{(u.tier_history || []).join(', ') || '-'}</td>
                      <td className="py-1 pr-3">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${u.accepted ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'}`}>
                          {u.accepted ? 'accepted' : 'rejected'}
                        </span>
                      </td>
                      <td className="py-1 pr-3 text-gray-500 dark:text-gray-400">{u.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
