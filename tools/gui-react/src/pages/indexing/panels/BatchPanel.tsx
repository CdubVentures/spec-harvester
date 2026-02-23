import { Tip } from '../../../components/common/Tip';

interface BatchProduct {
  productId: string;
  status: string;
  retries: number;
  error: string | null;
}

interface BatchSnapshot {
  batchId: string;
  category: string;
  status: string;
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  skipped: number;
  createdAt: string;
  updatedAt: string;
}

interface BatchDetail {
  batchId: string;
  category: string;
  status: string;
  products: BatchProduct[];
  createdAt: string;
  updatedAt: string;
}

interface BatchPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  batches: BatchSnapshot[];
  activeBatch: BatchDetail | null | undefined;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  running: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
  paused: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
  completed: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  cancelled: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
  done: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  failed: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
  skipped: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[status] || STATUS_COLORS.pending}`}>
      {status}
    </span>
  );
}

export function BatchPanel({
  collapsed,
  onToggle,
  batches,
  activeBatch,
}: BatchPanelProps) {
  const totalProducts = batches.reduce((s, b) => s + b.total, 0);
  const doneProducts = batches.reduce((s, b) => s + b.done, 0);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 60 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Batch Automation (Phase 12)</span>
          <Tip text="Multi-product batch runs with state machine, priority ordering, and retry policy. Learning from earlier products benefits later ones." />
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {batches.length} batches | {doneProducts}/{totalProducts} products
        </div>
      </div>
      {!collapsed && (
        <div className="space-y-3">
          {batches.length === 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic py-4 text-center">
              No batches created yet.
            </div>
          )}
          {batches.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                    <th className="py-1 pr-3 font-medium">Batch</th>
                    <th className="py-1 pr-3 font-medium">Category</th>
                    <th className="py-1 pr-3 font-medium">Status</th>
                    <th className="py-1 pr-3 font-medium">Progress</th>
                    <th className="py-1 pr-3 font-medium">Pending</th>
                    <th className="py-1 pr-3 font-medium">Done</th>
                    <th className="py-1 pr-3 font-medium">Failed</th>
                    <th className="py-1 pr-3 font-medium">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.batchId} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono text-gray-800 dark:text-gray-200">{b.batchId}</td>
                      <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{b.category}</td>
                      <td className="py-1 pr-3"><StatusBadge status={b.status} /></td>
                      <td className="py-1 pr-3">
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className="h-full rounded bg-green-500"
                              style={{ width: `${b.total > 0 ? Math.round((b.done / b.total) * 100) : 0}%` }}
                            />
                          </div>
                          <span className="text-gray-500 dark:text-gray-400">{b.done}/{b.total}</span>
                        </div>
                      </td>
                      <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{b.pending}</td>
                      <td className="py-1 pr-3 text-green-600 dark:text-green-400">{b.done}</td>
                      <td className="py-1 pr-3 text-red-600 dark:text-red-400">{b.failed}</td>
                      <td className="py-1 pr-3 text-orange-600 dark:text-orange-400">{b.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeBatch && activeBatch.products.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Active: {activeBatch.batchId} — {activeBatch.category}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                      <th className="py-1 pr-3 font-medium">Product</th>
                      <th className="py-1 pr-3 font-medium">Status</th>
                      <th className="py-1 pr-3 font-medium">Retries</th>
                      <th className="py-1 pr-3 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBatch.products.map((p) => (
                      <tr key={p.productId} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono text-gray-800 dark:text-gray-200">{p.productId}</td>
                        <td className="py-1 pr-3"><StatusBadge status={p.status} /></td>
                        <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{p.retries}</td>
                        <td className="py-1 pr-3 text-red-500 dark:text-red-400 max-w-[200px] truncate" title={p.error || ''}>
                          {p.error || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
