import { Tip } from '../../../components/common/Tip';

interface LaneStats {
  name: string;
  concurrency: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
  budget_rejected: number;
  paused: boolean;
}

interface WorkerPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  laneSnapshot: Record<string, LaneStats> | null | undefined;
  budgetSnapshot: {
    urls: number;
    queries: number;
    llm_calls: number;
    high_tier_calls: number;
    cost_usd: number;
    elapsed_ms: number;
    high_tier_utilization_pct: number;
    budgets: Record<string, number>;
  } | null | undefined;
}

const LANE_LABELS: Record<string, string> = {
  search: 'Search',
  fetch: 'Fetch',
  parse: 'Parse',
  llm: 'LLM',
};

const LANE_COLORS: Record<string, string> = {
  search: 'bg-blue-500',
  fetch: 'bg-green-500',
  parse: 'bg-yellow-500',
  llm: 'bg-purple-500',
};

export function WorkerPanel({
  collapsed,
  onToggle,
  laneSnapshot,
  budgetSnapshot,
}: WorkerPanelProps) {
  const lanes = laneSnapshot ? Object.values(laneSnapshot) : [];
  const totalCompleted = lanes.reduce((s, l) => s + l.completed, 0);
  const totalActive = lanes.reduce((s, l) => s + l.active, 0);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 58 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Worker Lanes (Phase 11)</span>
          <Tip text="Per-lane worker queues with independent concurrency, budget enforcement, and pause/resume controls." />
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {totalActive} active | {totalCompleted} completed
        </div>
      </div>
      {!collapsed && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {lanes.map((lane) => (
              <div
                key={lane.name}
                className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                    {LANE_LABELS[lane.name] || lane.name}
                  </span>
                  {lane.paused && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 font-medium">
                      PAUSED
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex-1 h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className={`h-full rounded ${LANE_COLORS[lane.name] || 'bg-gray-500'}`}
                      style={{ width: `${lane.concurrency > 0 ? Math.round((lane.active / lane.concurrency) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {lane.active}/{lane.concurrency}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                  <span>Q:{lane.queued}</span>
                  <span>Done:{lane.completed}</span>
                  <span>Fail:{lane.failed}</span>
                  {lane.budget_rejected > 0 && (
                    <span className="text-red-500">Budget:{lane.budget_rejected}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {budgetSnapshot && (
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Budget</div>
              <div className="flex flex-wrap gap-3 text-[10px] text-gray-600 dark:text-gray-400">
                <span>URLs: {budgetSnapshot.urls}/{budgetSnapshot.budgets?.max_urls_per_product ?? '-'}</span>
                <span>Queries: {budgetSnapshot.queries}/{budgetSnapshot.budgets?.max_queries_per_product ?? '-'}</span>
                <span>LLM: {budgetSnapshot.llm_calls}/{budgetSnapshot.budgets?.max_llm_calls_per_product ?? '-'}</span>
                <span>Cost: ${budgetSnapshot.cost_usd.toFixed(3)}/{budgetSnapshot.budgets?.max_cost_per_product_usd ?? '-'}</span>
                <span>HT: {budgetSnapshot.high_tier_utilization_pct}%</span>
                <span>Elapsed: {Math.round(budgetSnapshot.elapsed_ms / 1000)}s</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
