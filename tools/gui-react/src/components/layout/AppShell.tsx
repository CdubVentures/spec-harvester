import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TabNav } from './TabNav';
import { Sidebar } from './Sidebar';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { isTestCategory } from '../../utils/testMode';
import { wsManager } from '../../api/ws';
import { useEventsStore } from '../../stores/eventsStore';
import { useIndexLabStore, type IndexLabEvent } from '../../stores/indexlabStore';
import type { ProcessStatus } from '../../types/events';
import type { RuntimeEvent } from '../../types/events';

export function AppShell() {
  const setCategories = useUiStore((s) => s.setCategories);
  const category = useUiStore((s) => s.category);
  const darkMode = useUiStore((s) => s.darkMode);
  const devMode = useUiStore((s) => s.devMode);
  const toggleDarkMode = useUiStore((s) => s.toggleDarkMode);
  const toggleDevMode = useUiStore((s) => s.toggleDevMode);
  const setProcessStatus = useRuntimeStore((s) => s.setProcessStatus);
  const appendProcessOutput = useRuntimeStore((s) => s.appendProcessOutput);
  const appendEvents = useEventsStore((s) => s.appendEvents);
  const appendIndexLabEvents = useIndexLabStore((s) => s.appendEvents);
  const queryClient = useQueryClient();

  useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const cats = await api.get<string[]>('/categories?includeTest=true');
      setCategories(cats);
      return cats;
    },
  });

  const testMode = isTestCategory(category);

  useQuery({
    queryKey: ['processStatus'],
    queryFn: async () => {
      const status = await api.get<ProcessStatus>('/process/status');
      setProcessStatus(status);
      return status;
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    wsManager.connect();
    wsManager.subscribe(['events', 'queue', 'process', 'indexlab-event'], category);

    const unsub = wsManager.onMessage((channel, data) => {
      if (channel === 'events' && Array.isArray(data)) {
        appendEvents(data as RuntimeEvent[]);
      }
      if (channel === 'process' && Array.isArray(data)) {
        appendProcessOutput(data as string[]);
      }
      if (channel === 'indexlab-event' && Array.isArray(data)) {
        appendIndexLabEvents(data as IndexLabEvent[]);
      }
      if (channel === 'data-change' && data && typeof data === 'object') {
        const msg = data as { type?: string; category?: string };
        const cat = msg.category;
        if (cat) {
          queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', cat] });
          queryClient.invalidateQueries({ queryKey: ['componentReviewData', cat] });
          queryClient.invalidateQueries({ queryKey: ['componentReviewLayout', cat] });
          queryClient.invalidateQueries({ queryKey: ['enumReviewData', cat] });
          queryClient.invalidateQueries({ queryKey: ['product', cat] });
          queryClient.invalidateQueries({ queryKey: ['catalog', cat] });
          queryClient.invalidateQueries({ queryKey: ['studio-known-values', cat] });
        }
      }
    });

    return () => {
      unsub();
    };
  }, [category, appendEvents, appendIndexLabEvents, appendProcessOutput, queryClient]);

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Spec Factory</h1>
          <span className="text-[9px] text-gray-400 ml-1" title={`Build: ${__BUILD_ID__}`}>v{__BUILD_ID__.slice(0, 8)}</span>
        <div className="flex items-center gap-3">
          {testMode && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
              TEST MODE
            </span>
          )}
          <span className="text-xs text-gray-500">{category}</span>
          <button
            onClick={toggleDevMode}
            className={`px-2 py-1 rounded text-[10px] font-mono ${
              devMode
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
            title="Toggle developer mode (show raw LLM prompts)"
          >
            DEV
          </button>
          <button
            onClick={toggleDarkMode}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
            title="Toggle dark mode"
          >
            {darkMode ? '\u2600' : '\u263E'}
          </button>
        </div>
      </header>
      <TabNav />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
