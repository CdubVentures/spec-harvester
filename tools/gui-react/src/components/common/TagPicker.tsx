import { useState, useRef } from 'react';
import { inputCls } from '../../pages/studio/studioConstants';

interface TagPickerProps {
  values: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  allowCustom?: boolean;
  /** Transform the selected suggestion before storing. E.g. strip " — Header" suffix. */
  normalize?: (value: string) => string;
}

export function TagPicker({
  values,
  onChange,
  suggestions = [],
  placeholder = 'Add...',
  allowCustom = true,
  normalize,
}: TagPickerProps) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = suggestions.filter(
    (s) => {
      const norm = normalize ? normalize(s) : s;
      return !values.includes(norm) && s.toLowerCase().includes(input.toLowerCase());
    },
  );

  function add(tag: string) {
    const t = normalize ? normalize(tag.trim()) : tag.trim();
    if (t && !values.includes(t)) {
      onChange([...values, t]);
    }
    setInput('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      add(input);
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      remove(values.length - 1);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div
        className={`${inputCls} flex flex-wrap gap-1 min-h-[34px] items-center cursor-text`}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span
            key={v}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs bg-accent/10 text-accent rounded"
          >
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(i); }}
              className="ml-0.5 text-accent/60 hover:text-accent font-bold leading-none"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[60px] bg-transparent outline-none text-sm"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : ''}
        />
      </div>

      {open && (filtered.length > 0 || (allowCustom && input.trim())) ? (
        <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="block w-full text-left px-2 py-1 text-sm hover:bg-accent/10 hover:text-accent"
            >
              {s}
            </button>
          ))}
          {allowCustom && input.trim() && !suggestions.includes(input.trim()) ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(input)}
              className="block w-full text-left px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 italic"
            >
              Add &ldquo;{input.trim()}&rdquo;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
