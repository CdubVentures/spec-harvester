import { useState, useRef, useCallback, useEffect } from 'react';

export interface BulkGridRow {
  col1: string;
  col2: string;
}

interface BulkPasteGridProps {
  col1Header: string;
  col2Header: string;
  col1Placeholder?: string;
  col2Placeholder?: string;
  rows: BulkGridRow[];
  onChange: (rows: BulkGridRow[]) => void;
  disabled?: boolean;
  minRows?: number;
  col1Mono?: boolean;
}

export default function BulkPasteGrid({
  col1Header,
  col2Header,
  col1Placeholder = '',
  col2Placeholder = '',
  rows,
  onChange,
  disabled = false,
  minRows = 8,
  col1Mono = false,
}: BulkPasteGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusCell, setFocusCell] = useState<{ row: number; col: number } | null>(null);

  const visibleRows: BulkGridRow[] = rows.length >= minRows
    ? [...rows, { col1: '', col2: '' }]
    : [...rows, ...Array.from({ length: minRows - rows.length }, () => ({ col1: '', col2: '' }))];

  const updateCell = useCallback((rowIdx: number, col: number, value: string) => {
    const next = [...rows];
    while (next.length <= rowIdx) next.push({ col1: '', col2: '' });
    next[rowIdx] = col === 0
      ? { ...next[rowIdx], col1: value }
      : { ...next[rowIdx], col2: value };
    const trimmed = trimTrailingEmpty(next);
    onChange(trimmed);
  }, [rows, onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>, rowIdx: number, col: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const pasteLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (pasteLines.length <= 1 && !pasteLines[0].includes('\t')) return;
    e.preventDefault();
    const next = [...rows];
    while (next.length <= rowIdx) next.push({ col1: '', col2: '' });
    for (let i = 0; i < pasteLines.length; i++) {
      const line = pasteLines[i];
      if (!line.trim()) continue;
      const targetRow = rowIdx + i;
      while (next.length <= targetRow) next.push({ col1: '', col2: '' });
      const parts = line.split('\t');
      if (col === 0) {
        next[targetRow] = { col1: parts[0]?.trim() || '', col2: parts[1]?.trim() || next[targetRow].col2 };
      } else {
        next[targetRow] = { ...next[targetRow], col2: parts[0]?.trim() || '' };
      }
    }
    onChange(trimTrailingEmpty(next));
    setFocusCell({ row: Math.min(rowIdx + pasteLines.length, next.length), col: 0 });
  }, [rows, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, col: number) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (col === 1) setFocusCell({ row: rowIdx, col: 0 });
        else if (rowIdx > 0) setFocusCell({ row: rowIdx - 1, col: 1 });
      } else {
        if (col === 0) setFocusCell({ row: rowIdx, col: 1 });
        else setFocusCell({ row: rowIdx + 1, col: 0 });
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      setFocusCell({ row: rowIdx + 1, col });
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusCell({ row: rowIdx + 1, col }); }
    if (e.key === 'ArrowUp' && rowIdx > 0) { e.preventDefault(); setFocusCell({ row: rowIdx - 1, col }); }
  }, []);

  useEffect(() => {
    if (!focusCell || !gridRef.current) return;
    const input = gridRef.current.querySelector(
      `input[data-row="${focusCell.row}"][data-col="${focusCell.col}"]`
    ) as HTMLInputElement | null;
    if (input) { input.focus(); input.select(); }
  }, [focusCell]);

  return (
    <div ref={gridRef} className="border border-gray-200 dark:border-gray-700 rounded overflow-auto max-h-[40vh]">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-50 dark:bg-gray-900/70">
            <th className="text-left px-2 py-1.5 w-10 text-gray-400 border-b border-r border-gray-200 dark:border-gray-700">#</th>
            <th className="text-left px-2 py-1.5 font-medium text-gray-600 dark:text-gray-300 border-b border-r border-gray-200 dark:border-gray-700">{col1Header}</th>
            <th className="text-left px-2 py-1.5 font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">{col2Header}</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, idx) => (
            <tr key={idx} className="group">
              <td className="px-2 py-0 text-gray-300 dark:text-gray-600 border-r border-b border-gray-100 dark:border-gray-700/40 w-10 text-center select-none">
                {idx + 1}
              </td>
              <td className="p-0 border-r border-b border-gray-100 dark:border-gray-700/40">
                <input
                  data-row={idx}
                  data-col={0}
                  className={`w-full px-2 py-1 text-xs bg-transparent outline-none focus:bg-accent/5 ${col1Mono ? 'font-mono' : ''}`}
                  placeholder={idx === 0 ? col1Placeholder : ''}
                  value={row.col1}
                  disabled={disabled}
                  onChange={(e) => updateCell(idx, 0, e.target.value)}
                  onPaste={(e) => handlePaste(e, idx, 0)}
                  onKeyDown={(e) => handleKeyDown(e, idx, 0)}
                  onFocus={() => setFocusCell({ row: idx, col: 0 })}
                />
              </td>
              <td className="p-0 border-b border-gray-100 dark:border-gray-700/40">
                <input
                  data-row={idx}
                  data-col={1}
                  className="w-full px-2 py-1 text-xs bg-transparent outline-none focus:bg-accent/5"
                  placeholder={idx === 0 ? col2Placeholder : ''}
                  value={row.col2}
                  disabled={disabled}
                  onChange={(e) => updateCell(idx, 1, e.target.value)}
                  onPaste={(e) => handlePaste(e, idx, 1)}
                  onKeyDown={(e) => handleKeyDown(e, idx, 1)}
                  onFocus={() => setFocusCell({ row: idx, col: 1 })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function trimTrailingEmpty(rows: BulkGridRow[]): BulkGridRow[] {
  const result = [...rows];
  while (result.length > 0 && !result[result.length - 1].col1.trim() && !result[result.length - 1].col2.trim()) {
    result.pop();
  }
  return result;
}
