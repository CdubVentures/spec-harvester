import { Tip } from '../../../components/common/Tip';
import { panelStateChipClasses } from '../helpers';
import type { PanelStateToken } from '../types';

interface ContainerStatusRow {
  label: string;
  state: PanelStateToken;
  detail: string;
}

interface PanelControlsPanelProps {
  containerStatuses: ContainerStatusRow[];
  onOpenAll: () => void;
  onCloseAll: () => void;
}

export function PanelControlsPanel({
  containerStatuses,
  onOpenAll,
  onCloseAll,
}: PanelControlsPanelProps) {
  return (
    <details open className="group rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2" style={{ order: 15 }}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-xs text-gray-700 dark:text-gray-200">
        <span className="inline-flex items-center font-semibold">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-gray-300 text-[10px] leading-none text-gray-700 dark:border-gray-600 dark:text-gray-200 mr-1">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">-</span>
          </span>
          Panel Controls
          <Tip text="Open or close major dashboard containers and inspect each panel state." />
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-gray-600 dark:text-gray-300">Container visibility shortcuts</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenAll}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Open all containers."
            >
              Open all
            </button>
            <button
              onClick={onCloseAll}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Close all containers."
            >
              Close all
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 text-xs">
          {containerStatuses.map((row) => (
            <div key={`container-status:${row.label}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 flex items-center justify-between gap-2">
              <div className="text-gray-600 dark:text-gray-300">{row.label}</div>
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded ${panelStateChipClasses(row.state)}`}>
                  {row.state}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{row.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
