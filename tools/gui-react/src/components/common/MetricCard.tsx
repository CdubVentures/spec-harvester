interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaColor?: 'green' | 'red' | 'gray';
}

export function MetricCard({ label, value, delta, deltaColor = 'gray' }: MetricCardProps) {
  const colorMap = { green: 'text-green-600', red: 'text-red-600', gray: 'text-gray-500' };
  return (
    <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {delta && <p className={`mt-1 text-sm ${colorMap[deltaColor]}`}>{delta}</p>}
    </div>
  );
}
