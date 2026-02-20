import { useCallback, useEffect, useRef } from 'react';

interface InlineCellEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
  stopClickPropagation?: boolean;
}

const DEFAULT_CLASS =
  'w-full h-full px-1 text-[11px] bg-white dark:bg-gray-800 border-0 outline-none ring-2 ring-accent';

export function InlineCellEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
  stopClickPropagation = false,
}: InlineCellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    committedRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      // Mark as committed so any post-unmount blur event (which fires AFTER
      // cleanup when the DOM element is removed) cannot create an uncancellable
      // timer that would commit/close the edit on a different cell.
      committedRef.current = true;
      if (blurTimerRef.current != null) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const handleCommit = useCallback(() => {
    if (blurTimerRef.current != null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit();
  }, [onCommit]);

  // Delay blur-commit by one frame so re-render-induced focus loss
  // (e.g. virtualizer remount) can be cancelled when focus returns.
  const handleBlur = useCallback(() => {
    if (committedRef.current) return;
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      if (committedRef.current) return;
      committedRef.current = true;
      onCommit();
    }, 0);
  }, [onCommit]);

  // If focus returns before the blur timer fires, cancel the commit.
  const handleFocus = useCallback(() => {
    if (blurTimerRef.current != null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          handleCommit();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (blurTimerRef.current != null) {
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          onCancel();
        }
      }}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onClick={stopClickPropagation ? (event) => event.stopPropagation() : undefined}
      className={className || DEFAULT_CLASS}
    />
  );
}
