import { useMemo } from 'react';
import { DataTable } from '../../components/common/DataTable';
import { EVENT_MEANINGS } from '../../utils/constants';
import type { RuntimeEvent } from '../../types/events';
import type { ColumnDef } from '@tanstack/react-table';
import * as Tooltip from '@radix-ui/react-tooltip';

function truncateText(value: unknown, limit = 180) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

function buildEventDetail(evt: RuntimeEvent) {
  const details: string[] = [];
  const url = truncateText(evt.url, 220);
  if (url) details.push(url);

  const provider = truncateText(evt.provider || evt.primary_provider, 80);
  const model = truncateText(evt.model || evt.primary_model, 120);
  const baseUrl = truncateText(evt.base_url || evt.primary_base_url, 220);
  const endpoint = truncateText(evt.endpoint, 220);
  const fallbackProvider = truncateText(evt.fallback_provider, 80);
  const fallbackModel = truncateText(evt.fallback_model, 120);
  const fallbackBaseUrl = truncateText(evt.fallback_base_url, 220);

  if (provider || model || baseUrl || endpoint) {
    const routeBits: string[] = [];
    if (provider || model) routeBits.push(`llm=${provider || '?'}:${model || '?'}`);
    if (baseUrl) routeBits.push(`base=${baseUrl}`);
    if (endpoint) routeBits.push(`endpoint=${endpoint}`);
    details.push(routeBits.join(' | '));
  }

  if (fallbackProvider || fallbackModel || fallbackBaseUrl) {
    details.push(
      `fallback=${fallbackProvider || '?'}:${fallbackModel || '?'}${fallbackBaseUrl ? ` @ ${fallbackBaseUrl}` : ''}`
    );
  }

  const field = truncateText(evt.field, 100);
  if (field) details.push(`field=${field}`);
  const reason = truncateText(evt.reason, 100);
  if (reason) details.push(`reason=${reason}`);
  const role = truncateText(evt.role, 40);
  if (role) details.push(`role=${role}`);

  if (Array.isArray(evt.errors) && evt.errors.length > 0) {
    details.push(`schema=${truncateText(evt.errors.join('; '), 260)}`);
  }

  const message = truncateText(evt.message, 220);
  if (message) details.push(`msg=${message}`);

  const fallbackDetail = truncateText(evt.detail, 220);
  if (fallbackDetail && !details.some((row) => row.includes(fallbackDetail))) {
    details.push(fallbackDetail);
  }

  return details.filter(Boolean).join(' | ');
}

const columns: ColumnDef<RuntimeEvent, unknown>[] = [
  {
    accessorKey: 'ts',
    header: 'Time',
    cell: ({ getValue }) => {
      const ts = getValue() as string;
      return ts ? new Date(ts).toLocaleTimeString() : '';
    },
    size: 80,
  },
  {
    accessorKey: 'event',
    header: 'Event',
    cell: ({ getValue }) => {
      const event = getValue() as string;
      const meaning = EVENT_MEANINGS[event];
      if (!meaning) return <span className="font-mono text-xs">{event}</span>;
      return (
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className="font-mono text-xs cursor-help">{event}</span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="bg-gray-900 text-white text-xs rounded px-2 py-1 max-w-xs"
                sideOffset={5}
              >
                {meaning}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      );
    },
    size: 200,
  },
  { accessorKey: 'productId', header: 'Product', size: 150 },
  {
    id: 'detail',
    header: 'Detail',
    cell: ({ row }) => {
      const evt = row.original;
      const detail = buildEventDetail(evt);
      return (
        <span className="font-mono text-[11px]" title={detail}>
          {detail}
        </span>
      );
    },
    size: 300,
  },
];

interface EventLogProps {
  events: RuntimeEvent[];
  maxHeight?: string;
}

export function EventLog({ events, maxHeight = 'max-h-72' }: EventLogProps) {
  const reversed = useMemo(() => [...events].reverse(), [events]);

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Event Log ({events.length})</h3>
      <DataTable data={reversed} columns={columns} searchable maxHeight={maxHeight} />
    </div>
  );
}
