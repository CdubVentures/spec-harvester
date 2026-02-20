import { MetricCard } from './MetricCard';

interface Metric {
  label: string;
  value: string | number;
  delta?: string;
  deltaColor?: 'green' | 'red' | 'gray';
}

export function MetricRow({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {metrics.map((m) => (
        <MetricCard key={m.label} {...m} />
      ))}
    </div>
  );
}
