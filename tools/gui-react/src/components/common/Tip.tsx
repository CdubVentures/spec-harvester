import * as Tooltip from '@radix-ui/react-tooltip';
import type { CSSProperties } from 'react';

export function Tip({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  if (!text) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          tabIndex={0}
          className={`inline-flex shrink-0 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-gray-600 align-middle cursor-help hover:bg-gray-200 hover:border-gray-400 hover:text-gray-700 focus:bg-gray-200 focus:border-gray-500 focus:text-gray-700 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:border-gray-500 dark:hover:text-white dark:focus:bg-gray-600 dark:focus:border-gray-400 dark:focus:text-white ml-1 ${className || ''}`.trim()}
          style={{
            width: '0.95em',
            height: '0.95em',
            ...style
          }}
        >
          ?
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 max-w-xs px-3 py-2 text-xs leading-snug whitespace-pre-line text-gray-900 bg-white border border-gray-200 rounded shadow-lg dark:text-gray-100 dark:bg-gray-900 dark:border-gray-700"
          sideOffset={5}
        >
          {text}
          <Tooltip.Arrow className="fill-white dark:fill-gray-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
