import { lazy, Suspense, type ComponentType } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/common/ErrorBoundary';

function lazyNamedPage(loader: () => Promise<Record<string, unknown>>, exportName: string) {
  return lazy(async () => {
    const module = await loader();
    const component = module[exportName];
    if (typeof component !== 'function') {
      throw new Error(`Lazy page export "${exportName}" was not found.`);
    }
    return { default: component as ComponentType };
  });
}

const OverviewPage = lazyNamedPage(() => import('./pages/overview/OverviewPage'), 'OverviewPage');
const ProductPage = lazyNamedPage(() => import('./pages/product/ProductPage'), 'ProductPage');
const LlmSettingsPage = lazyNamedPage(() => import('./pages/llm-settings/LlmSettingsPage'), 'LlmSettingsPage');
const BillingPage = lazyNamedPage(() => import('./pages/billing/BillingPage'), 'BillingPage');
const StudioPage = lazyNamedPage(() => import('./pages/studio/StudioPage'), 'StudioPage');
const CatalogPage = lazyNamedPage(() => import('./pages/catalog/CatalogPage'), 'CatalogPage');
const CategoryManager = lazyNamedPage(() => import('./pages/catalog/CategoryManager'), 'CategoryManager');
const ReviewPage = lazyNamedPage(() => import('./pages/review/ReviewPage'), 'ReviewPage');
const ComponentReviewPage = lazyNamedPage(() => import('./pages/component-review/ComponentReviewPage'), 'ComponentReviewPage');
const TestModePage = lazyNamedPage(() => import('./pages/test-mode/TestModePage'), 'TestModePage');
const IndexingPage = lazyNamedPage(() => import('./pages/indexing/IndexingPage'), 'IndexingPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RouteFallback() {
  return (
    <div className="text-sm text-gray-500 dark:text-gray-400">
      Loading page...
    </div>
  );
}

function wrap(Component: ComponentType) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={wrap(OverviewPage)} />
            <Route path="categories" element={wrap(CategoryManager)} />
            <Route path="catalog" element={wrap(CatalogPage)} />
            <Route path="product" element={wrap(ProductPage)} />
            <Route path="llm-settings" element={wrap(LlmSettingsPage)} />
            <Route path="indexing" element={wrap(IndexingPage)} />
            <Route path="billing" element={wrap(BillingPage)} />
            <Route path="studio" element={wrap(StudioPage)} />
            <Route path="review" element={wrap(ReviewPage)} />
            <Route path="review-components" element={wrap(ComponentReviewPage)} />
            <Route path="test-mode" element={wrap(TestModePage)} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
