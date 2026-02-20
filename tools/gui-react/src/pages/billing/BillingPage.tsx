import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { MetricRow } from '../../components/common/MetricRow';
import { Spinner } from '../../components/common/Spinner';
import { usd, compactNumber } from '../../utils/formatting';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface MonthlyBilling {
  totals?: {
    cost_usd?: number;
    calls?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  by_day?: Record<string, { cost_usd: number; calls: number }>;
  by_model?: Record<string, { cost_usd: number; calls: number }>;
}

interface LearningArtifact {
  name: string;
  path: string;
  size: number;
  updated: string;
}

const sectionCls = 'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4';

// ── Single-category view ────────────────────────────────────────
function SingleCategoryBilling({ category }: { category: string }) {
  const { data: billing, isLoading: billingLoading } = useQuery({
    queryKey: ['billing', category],
    queryFn: () => api.get<MonthlyBilling>(`/billing/${category}/monthly`),
  });

  const { data: artifacts = [] } = useQuery({
    queryKey: ['learning', category],
    queryFn: () => api.get<LearningArtifact[]>(`/learning/${category}/artifacts`),
  });

  if (billingLoading) return <Spinner className="h-8 w-8 mx-auto mt-12" />;

  const totals = billing?.totals || {};
  const dailyData = Object.entries(billing?.by_day || {})
    .map(([day, v]) => ({ day, cost: v.cost_usd, calls: v.calls }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const modelData = Object.entries(billing?.by_model || {})
    .map(([model, v]) => ({ model, cost: v.cost_usd, calls: v.calls }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-6">
      <MetricRow
        metrics={[
          { label: 'Total Cost', value: usd(totals.cost_usd || 0, 2) },
          { label: 'LLM Calls', value: compactNumber(totals.calls || 0) },
          { label: 'Input Tokens', value: compactNumber(totals.input_tokens || 0) },
          { label: 'Output Tokens', value: compactNumber(totals.output_tokens || 0) },
        ]}
      />

      {dailyData.length > 0 && (
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-3">Daily Cost</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="cost" fill="#4361ee" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {modelData.length > 0 && (
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-3">Cost by Model</h3>
          <div className="space-y-2">
            {modelData.map((m) => (
              <div key={m.model} className="flex justify-between text-sm">
                <span className="font-mono text-xs">{m.model}</span>
                <span>{usd(m.cost, 4)} ({m.calls} calls)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={sectionCls}>
        <h3 className="text-sm font-semibold mb-3">Learning Artifacts</h3>
        {artifacts.length === 0 ? (
          <p className="text-gray-400 text-sm">No learning artifacts found.</p>
        ) : (
          <div className="space-y-1 text-sm">
            {artifacts.map((a) => (
              <div key={a.name} className="flex justify-between">
                <span className="font-mono text-xs">{a.name}</span>
                <span className="text-gray-500">{compactNumber(a.size)} bytes</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── All-categories aggregated view ──────────────────────────────
function AllCategoriesBilling({ categories }: { categories: string[] }) {
  const billingQueries = useQueries({
    queries: categories.map((cat) => ({
      queryKey: ['billing', cat],
      queryFn: () => api.get<MonthlyBilling>(`/billing/${cat}/monthly`),
    })),
  });

  const isLoading = billingQueries.some((q) => q.isLoading);

  const { grandTotals, perCategory, dailyAgg, modelAgg } = useMemo(() => {
    const gt = { cost_usd: 0, calls: 0, input_tokens: 0, output_tokens: 0 };
    const perCat: { category: string; cost: number; calls: number }[] = [];
    const dailyMap: Record<string, { cost: number; calls: number }> = {};
    const modelMap: Record<string, { cost: number; calls: number }> = {};

    for (let i = 0; i < categories.length; i++) {
      const billing = billingQueries[i].data;
      const t = billing?.totals || {};
      const cost = t.cost_usd || 0;
      const calls = t.calls || 0;

      gt.cost_usd += cost;
      gt.calls += calls;
      gt.input_tokens += t.input_tokens || 0;
      gt.output_tokens += t.output_tokens || 0;

      if (cost > 0 || calls > 0) {
        perCat.push({ category: categories[i], cost, calls });
      }

      for (const [day, v] of Object.entries(billing?.by_day || {})) {
        const existing = dailyMap[day] || { cost: 0, calls: 0 };
        existing.cost += v.cost_usd;
        existing.calls += v.calls;
        dailyMap[day] = existing;
      }

      for (const [model, v] of Object.entries(billing?.by_model || {})) {
        const existing = modelMap[model] || { cost: 0, calls: 0 };
        existing.cost += v.cost_usd;
        existing.calls += v.calls;
        modelMap[model] = existing;
      }
    }

    perCat.sort((a, b) => b.cost - a.cost);

    const dailyAgg = Object.entries(dailyMap)
      .map(([day, v]) => ({ day, cost: v.cost, calls: v.calls }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const modelAgg = Object.entries(modelMap)
      .map(([model, v]) => ({ model, cost: v.cost, calls: v.calls }))
      .sort((a, b) => b.cost - a.cost);

    return { grandTotals: gt, perCategory: perCat, dailyAgg: dailyAgg, modelAgg: modelAgg };
  }, [billingQueries, categories]);

  if (isLoading) return <Spinner className="h-8 w-8 mx-auto mt-12" />;

  return (
    <div className="space-y-6">
      <MetricRow
        metrics={[
          { label: 'Total Cost', value: usd(grandTotals.cost_usd, 2) },
          { label: 'LLM Calls', value: compactNumber(grandTotals.calls) },
          { label: 'Input Tokens', value: compactNumber(grandTotals.input_tokens) },
          { label: 'Output Tokens', value: compactNumber(grandTotals.output_tokens) },
        ]}
      />

      {perCategory.length > 0 && (
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-3">Cost by Category</h3>
          <div className="space-y-2">
            {perCategory.map((c) => (
              <div key={c.category} className="flex items-center justify-between text-sm">
                <span className="font-medium capitalize">{c.category}</span>
                <span>{usd(c.cost, 2)} <span className="text-gray-500 text-xs ml-1">({compactNumber(c.calls)} calls)</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dailyAgg.length > 0 && (
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-3">Daily Cost (All Categories)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyAgg}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="cost" fill="#4361ee" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {modelAgg.length > 0 && (
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-3">Cost by Model (All Categories)</h3>
          <div className="space-y-2">
            {modelAgg.map((m) => (
              <div key={m.model} className="flex justify-between text-sm">
                <span className="font-mono text-xs">{m.model}</span>
                <span>{usd(m.cost, 4)} ({compactNumber(m.calls)} calls)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {perCategory.length === 0 && (
        <p className="text-gray-400 text-sm text-center">No billing data found across any category.</p>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────
export function BillingPage() {
  const category = useUiStore((s) => s.category);
  const categories = useUiStore((s) => s.categories);

  if (category === 'all') {
    return <AllCategoriesBilling categories={categories} />;
  }

  return <SingleCategoryBilling category={category} />;
}
