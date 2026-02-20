import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useProductStore } from '../../stores/productStore';
import { MetricRow } from '../../components/common/MetricRow';
import { DataTable } from '../../components/common/DataTable';
import { TrafficLight } from '../../components/common/TrafficLight';
import { ProgressBar } from '../../components/common/ProgressBar';
import { Spinner } from '../../components/common/Spinner';
import { pct, relativeTime } from '../../utils/formatting';
import { hasKnownValue, humanizeField } from '../../utils/fieldNormalize';
import { PIPELINE_STAGE_DEFS } from '../../utils/constants';
import { useEventsStore } from '../../stores/eventsStore';
import type { ProductSummary, NormalizedProduct } from '../../types/product';
import type { ColumnDef } from '@tanstack/react-table';

interface ProductDetail {
  summary: ProductSummary;
  normalized: NormalizedProduct;
  provenance: Record<string, { confidence: number; value: unknown; meets_pass_target?: boolean }>;
  trafficLight: { by_field: Record<string, string> };
}

interface FieldRow {
  field: string;
  value: string;
  confidence: number;
  color: string;
  meetsTarget: boolean;
}

const fieldColumns: ColumnDef<FieldRow, unknown>[] = [
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

function computePipelineStage(events: Array<{ event: string }>) {
  let reached = -1;
  for (const evt of events) {
    for (let i = 0; i < PIPELINE_STAGE_DEFS.length; i++) {
      if (PIPELINE_STAGE_DEFS[i].events.has(evt.event) && i > reached) {
        reached = i;
      }
    }
  }
  return reached;
}

export function ProductPage() {
  const category = useUiStore((s) => s.category);
  const productId = useProductStore((s) => s.selectedProductId);
  const events = useEventsStore((s) => s.events);

  const { data, isLoading } = useQuery({
    queryKey: ['product', category, productId],
    queryFn: () => api.get<ProductDetail>(`/product/${category}/${productId}`),
    enabled: !!productId,
    refetchInterval: 10_000,
  });

  if (!productId) {
    return <p className="text-gray-500 mt-8 text-center">Select a product — choose a Brand and Model from the sidebar, or click a row in the Overview tab.</p>;
  }
  if (isLoading) return <Spinner className="h-8 w-8 mx-auto mt-12" />;
  if (!data) return <p className="text-gray-500 mt-8 text-center">No data found.</p>;

  const { summary, normalized, provenance, trafficLight } = data;
  const fields = normalized?.fields || {};
  const traffic = trafficLight?.by_field || {};

  const fieldRows: FieldRow[] = Object.entries(fields).map(([field, value]) => {
    const prov = provenance?.[field] || { confidence: 0, meets_pass_target: false };
    const color = traffic[field] || (hasKnownValue(value) ? (prov.confidence >= 0.85 ? 'green' : prov.confidence >= 0.6 ? 'yellow' : 'red') : 'gray');
    return {
      field,
      value: String(value ?? 'unk'),
      confidence: prov.confidence || 0,
      color,
      meetsTarget: !!prov.meets_pass_target,
    };
  });

  const productEvents = events.filter((e) => e.productId === productId);
  const stageIndex = computePipelineStage(productEvents);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">
          {normalized?.identity?.brand} {normalized?.identity?.model}
        </h2>
        {normalized?.identity?.variant && !['unk', 'unknown', 'na', 'n/a', 'none', 'null'].includes(String(normalized.identity.variant).toLowerCase().trim()) && (
          <span className="text-sm text-gray-500">({normalized.identity.variant})</span>
        )}
        <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
          {(normalized?.identity as Record<string, unknown>)?.id
            ? `#${(normalized.identity as Record<string, unknown>).id}`
            : '#—'}
          {' | '}
          {(normalized?.identity as Record<string, unknown>)?.identifier
            ? String((normalized.identity as Record<string, unknown>).identifier).slice(0, 8)
            : 'no-id'}
        </span>
      </div>

      <MetricRow
        metrics={[
          { label: 'Confidence', value: pct(summary?.confidence || 0) },
          { label: 'Coverage', value: pct(summary?.coverage_overall || 0) },
          { label: 'Fields Filled', value: `${summary?.fields_filled || 0}/${summary?.fields_total || 0}` },
          { label: 'Below Target', value: summary?.fields_below_pass_target?.length || 0 },
          { label: 'Critical Missing', value: summary?.critical_fields_below_pass_target?.length || 0 },
          { label: 'Last Updated', value: relativeTime(summary?.generated_at || '') },
        ]}
      />

      <div>
        <h3 className="text-sm font-medium mb-2">Pipeline Progress</h3>
        <div className="flex gap-1">
          {PIPELINE_STAGE_DEFS.map((stage, i) => (
            <div key={stage.id} className="flex-1">
              <div
                className={`h-2 rounded ${
                  i <= stageIndex ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
              <p className="text-[10px] text-center mt-1 text-gray-500">{stage.label}</p>
            </div>
          ))}
        </div>
      </div>

      <DataTable
        data={fieldRows}
        columns={fieldColumns}
        searchable
        maxHeight="max-h-[calc(100vh-420px)]"
      />
    </div>
  );
}
