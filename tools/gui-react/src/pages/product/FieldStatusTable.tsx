import { DataTable } from '../../components/common/DataTable';
import { TrafficLight } from '../../components/common/TrafficLight';
import { pct } from '../../utils/formatting';
import { humanizeField, hasKnownValue } from '../../utils/fieldNormalize';
import type { ColumnDef } from '@tanstack/react-table';

export interface FieldRow {
  field: string;
  value: string;
  confidence: number;
  color: string;
  meetsTarget: boolean;
}

const columns: ColumnDef<FieldRow, unknown>[] = [
  {
    accessorKey: 'color',
    header: '',
    cell: ({ getValue }) => <TrafficLight color={getValue() as string} />,
    size: 30,
  },
  {
    accessorKey: 'field',
    header: 'Field',
    cell: ({ getValue }) => humanizeField(getValue() as string),
    size: 180,
  },
  { accessorKey: 'value', header: 'Value', size: 200 },
  {
    accessorKey: 'confidence',
    header: 'Confidence',
    cell: ({ getValue }) => pct(getValue() as number),
    size: 80,
  },
  {
    accessorKey: 'meetsTarget',
    header: 'Pass',
    cell: ({ getValue }) => (getValue() ? '\u2714' : '\u2716'),
    size: 50,
  },
];

interface FieldStatusTableProps {
  fields: Record<string, unknown>;
  provenance: Record<string, { confidence: number; meets_pass_target?: boolean }>;
  trafficMap: Record<string, string>;
}

export function FieldStatusTable({ fields, provenance, trafficMap }: FieldStatusTableProps) {
  const rows: FieldRow[] = Object.entries(fields).map(([field, value]) => {
    const prov = provenance?.[field] || { confidence: 0, meets_pass_target: false };
    const color = trafficMap[field] ||
      (hasKnownValue(value) ? (prov.confidence >= 0.85 ? 'green' : prov.confidence >= 0.6 ? 'yellow' : 'red') : 'gray');
    return {
      field,
      value: String(value ?? 'unk'),
      confidence: prov.confidence || 0,
      color,
      meetsTarget: !!prov.meets_pass_target,
    };
  });

  return <DataTable data={rows} columns={columns} searchable maxHeight="max-h-[calc(100vh-420px)]" />;
}
