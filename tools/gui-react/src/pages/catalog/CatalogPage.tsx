import { useState } from 'react';
import { BrandManager } from '../studio/BrandManager';
import { ProductManager } from './ProductManager';

const subTabs = [
  { id: 'brands', label: 'Brands' },
  { id: 'models', label: 'Models' },
];

export function CatalogPage() {
  const [activeTab, setActiveTab] = useState('brands');

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-accent text-accent dark:border-accent-dark dark:text-accent-dark'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'brands' && <BrandManager />}
      {activeTab === 'models' && <ProductManager />}
    </div>
  );
}
