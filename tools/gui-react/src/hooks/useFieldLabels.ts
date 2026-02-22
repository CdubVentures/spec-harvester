import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { humanizeField } from '../utils/fieldNormalize';

export function useFieldLabels(category: string) {
  const { data } = useQuery({
    queryKey: ['fieldLabels', category],
    queryFn: () => api.get<{ category: string; labels: Record<string, string> }>(`/field-labels/${category}`),
    staleTime: 5 * 60 * 1000,
    enabled: !!category && category !== 'all',
  });
  const labels = data?.labels ?? {};
  const getLabel = (key: string): string => labels[key] || humanizeField(key);
  return { labels, getLabel };
}
