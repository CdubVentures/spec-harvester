import { NavLink } from 'react-router-dom';
import { useUiStore } from '../../stores/uiStore';
import { isTestCategory } from '../../utils/testMode';

interface TabDef {
  path: string;
  label: string;
  disabledOnAll?: boolean;
  disabledOnTest?: boolean;
}

const CATALOG_TABS: TabDef[] = [
  { path: '/', label: 'Overview' },
  { path: '/categories', label: 'Categories' },
  { path: '/catalog', label: 'Catalog' },
  { path: '/product', label: 'Selected Product' },
  { path: '/studio', label: 'Field Rules Studio', disabledOnAll: true, disabledOnTest: true },
  { path: '/review', label: 'Review Grid', disabledOnAll: true },
  { path: '/review-components', label: 'Review Components', disabledOnAll: true },
  { path: '/test-mode', label: 'Test Mode' },
];

const OPS_TABS: TabDef[] = [
  { path: '/llm-settings', label: 'LLM Settings', disabledOnAll: true },
  { path: '/indexing', label: 'Indexing Lab', disabledOnAll: true },
  { path: '/billing', label: 'Billing & Learning', disabledOnTest: true },
];

const activeCls = 'border-accent text-accent dark:border-accent-dark dark:text-accent-dark';
const inactiveCls = 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200';
const baseCls = 'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors';
const disabledCls = `${baseCls} border-transparent opacity-40 cursor-not-allowed text-gray-600 dark:text-gray-400`;

function TabGroup({ tabs, isAll, isTestMode }: { tabs: TabDef[]; isAll: boolean; isTestMode: boolean }) {
  return (
    <>
      {tabs.map((tab) => {
        const disabled = (isAll && tab.disabledOnAll) || (isTestMode && tab.disabledOnTest);
        if (disabled) {
          const title = isTestMode && tab.disabledOnTest
            ? 'This tab is disabled in test mode'
            : 'Select a specific category to use this tab';
          return (
            <span
              key={tab.path}
              className={disabledCls}
              title={title}
            >
              {tab.label}
            </span>
          );
        }
        return (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/'}
            className={({ isActive }) => `${baseCls} ${isActive ? activeCls : inactiveCls}`}
          >
            {tab.label}
          </NavLink>
        );
      })}
    </>
  );
}

export function TabNav() {
  const category = useUiStore((s) => s.category);
  const isAll = category === 'all';
  const testMode = isTestCategory(category);

  const borderCls = testMode
    ? 'border-b-2 border-amber-400 dark:border-amber-500'
    : 'border-b border-gray-200 dark:border-gray-700';

  return (
    <nav className={`flex ${borderCls} bg-white dark:bg-gray-800 px-4 overflow-x-auto`}>
      <TabGroup tabs={CATALOG_TABS} isAll={isAll} isTestMode={testMode} />
      <span className="self-center mx-1 text-gray-300 dark:text-gray-600 select-none">|</span>
      <TabGroup tabs={OPS_TABS} isAll={isAll} isTestMode={testMode} />
    </nav>
  );
}
