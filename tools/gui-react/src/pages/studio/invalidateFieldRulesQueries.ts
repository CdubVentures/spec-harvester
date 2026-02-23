import type { QueryClient } from '@tanstack/react-query';

export function invalidateFieldRulesQueries(qc: QueryClient, category: string) {
  const keys = [
    ['studio', category],
    ['studio-drafts', category],
    ['studio-config', category],
    ['studio-known-values', category],
    ['studio-component-db', category],
    ['studio-artifacts', category],
    ['fieldLabels', category],
    ['reviewLayout', category],
    ['reviewProductsIndex', category],
    ['product', category],
    ['catalog', category],
    ['componentReview', category],
    ['componentReviewData', category],
    ['componentReviewLayout', category],
    ['enumReview', category],
    ['enumReviewData', category],
  ];
  for (const queryKey of keys) qc.invalidateQueries({ queryKey });
}
