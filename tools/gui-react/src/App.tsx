import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { OverviewPage } from './pages/overview/OverviewPage';
import { ProductPage } from './pages/product/ProductPage';
import { LlmSettingsPage } from './pages/llm-settings/LlmSettingsPage';
import { BillingPage } from './pages/billing/BillingPage';
import { StudioPage } from './pages/studio/StudioPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { CategoryManager } from './pages/catalog/CategoryManager';
import { ReviewPage } from './pages/review/ReviewPage';
import { ComponentReviewPage } from './pages/component-review/ComponentReviewPage';
import { TestModePage } from './pages/test-mode/TestModePage';
import { IndexingPage } from './pages/indexing/IndexingPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function wrap(Component: React.ComponentType) {
  return (
    <ErrorBoundary>
      <Component />
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
