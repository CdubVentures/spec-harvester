import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { MetricRow } from '../../components/common/MetricRow';
import { ProgressBar } from '../../components/common/ProgressBar';
import { DataTable } from '../../components/common/DataTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { TrafficLight } from '../../components/common/TrafficLight';
import { Spinner } from '../../components/common/Spinner';
import { pct, usd, relativeTime } from '../../utils/formatting';
import { useProductStore } from '../../stores/productStore';
import type { CatalogRow } from '../../types/product';
import type { ColumnDef } from '@tanstack/react-table';

const columns: ColumnDef<CatalogRow, unknown>[] = [
  { accessorKey: 'brand', header: 'Brand', size: 100 },
  { accessorKey: 'model', header: 'Model', size: 150 },
  {
    accessorKey: 'variant',
    header: 'Variant',
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v ? <span className="text-xs">{v}</span> : <span className="text-gray-400 text-xs italic">—</span>;
    },
    size: 100,
  },
  {
    accessorKey: 'id',
    header: 'ID#',
    size: 55,
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return v ? <span className="font-mono text-xs">{v}</span> : null;
    },
  },
  {
    accessorKey: 'identifier',
    header: 'Identifier',
    size: 90,
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v ? <span className="font-mono text-xs" title={v}>{v.length > 6 ? v.slice(0, 6) + '...' : v}</span> : null;
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    size: 100,
  },
  {
    accessorKey: 'confidence',
    header: 'Conf',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      const color = v >= 0.85 ? 'green' : v >= 0.6 ? 'yellow' : v > 0 ? 'red' : 'gray';
      return (
        <span className="flex items-center gap-1">
          <TrafficLight color={color} />
          {pct(v)}
        </span>
      );
    },
    size: 80,
  },
  {
    accessorKey: 'coverage',
    header: 'Coverage',
    cell: ({ getValue }) => pct(getValue() as number),
    size: 80,
  },
  {
    accessorKey: 'fieldsFilled',
    header: 'Fields',
    cell: ({ row }) => `${row.original.fieldsFilled}/${row.original.fieldsTotal}`,
    size: 70,
  },
  {
    accessorKey: 'hasFinal',
    header: 'Final',
    cell: ({ getValue }) => (getValue() ? '\u2714' : ''),
    size: 50,
  },
  {
    accessorKey: 'validated',
    header: 'Valid',
    cell: ({ getValue }) => (getValue() ? '\u2714' : ''),
    size: 50,
  },
  {
    accessorKey: 'lastRun',
    header: 'Last Run',
    cell: ({ getValue }) => relativeTime(getValue() as string),
    size: 80,
  },
];

export function OverviewPage() {
  const category = useUiStore((s) => s.category);
  const setSelectedProduct = useProductStore((s) => s.setSelectedProduct);

  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ['catalog', category],
    queryFn: () => api.get<CatalogRow[]>(`/catalog/${category}`),
    refetchInterval: 10_000,
  });

  const { data: billing } = useQuery({
    queryKey: ['billing', category],
    queryFn: () => api.get<{ totals?: { cost_usd?: number; calls?: number } }>(`/billing/${category}/monthly`),
  });

  if (isLoading) return <Spinner className="h-8 w-8 mx-auto mt-12" />;

  const targets = catalog.filter((r) => r.inActive).length;
  const finals = catalog.filter((r) => r.hasFinal).length;
  const validated = catalog.filter((r) => r.hasFinal && r.validated).length;
  const coverageAvg = targets > 0 ? finals / targets : 0;
  const avgConf = catalog.length > 0
    ? catalog.reduce((sum, r) => sum + r.confidence, 0) / catalog.length
    : 0;
  const totals = billing?.totals || {};

  return (
    <div className="space-y-6">
      <MetricRow
        metrics={[
          { label: 'Products', value: catalog.length },
          { label: 'Active Targets', value: targets },
          { label: 'Finals', value: finals },
          { label: 'Validated', value: validated },
          { label: 'Avg Confidence', value: pct(avgConf) },
          { label: 'Monthly Cost', value: usd(totals.cost_usd || 0, 2) },
        ]}
      />

      <ProgressBar value={coverageAvg} label="Overall Coverage" color="bg-green-500" />

      <DataTable
        data={catalog}
        columns={columns}
        searchable
        maxHeight="max-h-[calc(100vh-340px)]"
        onRowClick={(row) => setSelectedProduct(row.productId, row.brand, row.model)}
      />
    </div>
  );
}
