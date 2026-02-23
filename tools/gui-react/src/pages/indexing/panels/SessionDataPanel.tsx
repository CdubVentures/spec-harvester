import { Tip } from '../../../components/common/Tip';

interface SessionCrawledCell {
  key: string;
  label: string;
  value: string;
  tooltip: string;
  placeholder?: boolean;
}

interface SessionDataPanelProps {
  selectedIndexLabRunId: string;
  sessionCrawledCells: SessionCrawledCell[];
}

export function SessionDataPanel({
  selectedIndexLabRunId,
  sessionCrawledCells,
}: SessionDataPanelProps) {
  return (
    <details open className="group rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3" style={{ order: 16 }}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-gray-300 text-[10px] leading-none text-gray-700 dark:border-gray-600 dark:text-gray-200 mr-1">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">-</span>
          </span>
          Session Data
          <Tip text="High-level run summary for crawl/fetch coverage and phase progression signals." />
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          run {selectedIndexLabRunId || '-'}
        </span>
      </summary>
      <div className="mt-2 grid grid-cols-1 xl:grid-cols-1 gap-2 text-xs">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {sessionCrawledCells.slice(0, 5).map((cell) => (
            <div key={`session-craweds:top:${cell.key}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                {cell.label}
                <Tip text={cell.tooltip} />
              </div>
              <div className={`font-semibold ${cell.placeholder ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                {cell.value}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {sessionCrawledCells.slice(5).map((cell) => (
            <div key={`session-craweds:extra:${cell.key}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                {cell.label}
                <Tip text={cell.tooltip} />
              </div>
              <div className={`font-semibold ${cell.placeholder ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
