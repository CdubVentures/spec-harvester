import * as Tooltip from '@radix-ui/react-tooltip';

export function Tip({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center justify-center w-4 h-4 ml-1 text-[10px] font-bold leading-none text-gray-400 dark:text-gray-500 border border-gray-300 dark:border-gray-600 rounded-full cursor-help hover:text-accent hover:border-accent focus:text-accent focus:border-accent focus:outline-none align-middle"
        >
          ?
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 max-w-xs px-3 py-2 text-xs leading-snug text-white bg-gray-900 dark:bg-gray-950 rounded shadow-lg"
          sideOffset={5}
        >
          {text}
          <Tooltip.Arrow className="fill-gray-900 dark:fill-gray-950" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
