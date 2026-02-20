import { useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useComponentReviewStore } from '../../stores/componentReviewStore';
import { MetricRow } from '../../components/common/MetricRow';
import { Spinner } from '../../components/common/Spinner';
import { ComponentSubTab } from './ComponentSubTab';
import { EnumSubTab } from './EnumSubTab';
import { pct } from '../../utils/formatting';
import type { ComponentReviewLayout, ComponentReviewPayload, EnumReviewPayload } from '../../types/componentReview';

const baseCls = 'px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer';
const activeCls = 'border-accent text-accent dark:border-accent-dark dark:text-accent-dark';
const inactiveCls = 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200';

export function ComponentReviewPage() {
  const category = useUiStore((s) => s.category);
  // Individual selectors: only re-render when activeSubTab changes,
  // NOT when cellEditValue or other unrelated store slices change.
  const activeSubTab = useComponentReviewStore((s) => s.activeSubTab);
  const setActiveSubTab = useComponentReviewStore((s) => s.setActiveSubTab);
  const queryClient = useQueryClient();

  const { data: layout, isLoading: layoutLoading } = useQuery({
    queryKey: ['componentReviewLayout', category],
    queryFn: () => api.get<ComponentReviewLayout>(`/review-components/${category}/layout`),
    enabled: category !== 'all',
  });

  // Auto-select first sub-tab when layout loads
  useEffect(() => {
    if (layout && layout.types.length > 0 && !activeSubTab) {
      setActiveSubTab(layout.types[0].type);
    }
  }, [layout, activeSubTab, setActiveSubTab]);

  // Fetch component data for active sub-tab (skip for enums)
  const { data: componentData, isLoading: componentLoading } = useQuery({
    queryKey: ['componentReviewData', category, activeSubTab],
    queryFn: () => api.get<ComponentReviewPayload>(`/review-components/${category}/components?type=${activeSubTab}`),
    enabled: category !== 'all' && !!activeSubTab && activeSubTab !== 'enums',
  });

  // Fetch enum data
  const { data: enumData, isLoading: enumLoading } = useQuery({
    queryKey: ['enumReviewData', category],
    queryFn: () => api.get<EnumReviewPayload>(`/review-components/${category}/enums`),
    enabled: category !== 'all' && activeSubTab === 'enums',
  });

  // Build sub-tab list from layout + enums
  const subTabs = useMemo(() => {
    if (!layout) return [];
    const tabs = layout.types.map((t) => ({
      key: t.type,
      label: t.type.charAt(0).toUpperCase() + t.type.slice(1),
      count: t.item_count,
    }));
    tabs.push({ key: 'enums', label: 'Enum Lists', count: 0 });
    return tabs;
  }, [layout]);

  // Aggregate metrics
  const metrics = useMemo(() => {
    if (activeSubTab === 'enums' && enumData) {
      const totalValues = enumData.fields.reduce((s, f) => s + f.metrics.total, 0);
      const totalFlags = enumData.fields.reduce((s, f) => s + f.metrics.flags, 0);
      return [
        { label: 'Fields', value: enumData.fields.length },
        { label: 'Total Values', value: totalValues },
        { label: 'Flags', value: totalFlags },
      ];
    }
    if (componentData) {
      return [
        { label: 'Components', value: componentData.metrics.total },
        { label: 'Avg Confidence', value: pct(componentData.metrics.avg_confidence) },
        { label: 'Flags', value: componentData.metrics.flags },
      ];
    }
    return null;
  }, [activeSubTab, componentData, enumData]);

  if (category === 'all') {
    return <p className="text-gray-500 mt-8 text-center">Select a specific category to review components.</p>;
  }
  if (layoutLoading) return <Spinner className="h-8 w-8 mx-auto mt-12" />;
  if (!layout || layout.types.length === 0) {
    return <p className="text-gray-500 mt-8 text-center">No component data found. Run a compile first.</p>;
  }

  const isLoading = activeSubTab === 'enums' ? enumLoading : componentLoading;

  return (
    <div className="space-y-3">
      {/* Metrics */}
      {metrics && <MetricRow metrics={metrics} />}

      {/* Sub-tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            className={`${baseCls} ${activeSubTab === tab.key ? activeCls : inactiveCls}`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-[10px] bg-gray-200 dark:bg-gray-700 rounded-full px-1.5 py-0.5">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && <Spinner className="h-6 w-6 mx-auto mt-8" />}

      {!isLoading && activeSubTab === 'enums' && enumData && (
        <EnumSubTab data={enumData} category={category} queryClient={queryClient} />
      )}

      {!isLoading && activeSubTab !== 'enums' && componentData && (
        <ComponentSubTab data={componentData} category={category} queryClient={queryClient} />
      )}
    </div>
  );
}
