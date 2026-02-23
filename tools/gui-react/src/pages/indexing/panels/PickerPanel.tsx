import { Tip } from '../../../components/common/Tip';
import { ActivityGauge, formatNumber } from '../helpers';
import type { CatalogRow } from '../../../types/product';

interface AmbiguityMeterShape {
  count: number;
  level: string;
  label: string;
  badgeCls: string;
  barCls: string;
  widthPct: number;
}

interface VariantOption {
  productId: string;
  label: string;
}

interface PickerPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  isAll: boolean;
  busy: boolean;
  processRunning: boolean;
  singleBrand: string;
  onBrandChange: (brand: string) => void;
  singleModel: string;
  onModelChange: (model: string) => void;
  singleProductId: string;
  onProductIdChange: (productId: string) => void;
  brandOptions: string[];
  modelOptions: string[];
  variantOptions: VariantOption[];
  selectedCatalogProduct: CatalogRow | null;
  displayVariant: (variant: string) => string;
  selectedAmbiguityMeter: AmbiguityMeterShape;
  canRunSingle: boolean;
  onRunIndexLab: () => void;
  productPickerActivity: { currentPerMin: number; peakPerMin: number };
}

export function PickerPanel({
  collapsed,
  onToggle,
  isAll,
  busy,
  processRunning,
  singleBrand,
  onBrandChange,
  singleModel,
  onModelChange,
  singleProductId,
  onProductIdChange,
  brandOptions,
  modelOptions,
  variantOptions,
  selectedCatalogProduct,
  displayVariant,
  selectedAmbiguityMeter,
  canRunSingle,
  onRunIndexLab,
  productPickerActivity,
}: PickerPanelProps) {
  return (
    <div className="rounded-lg border-2 border-emerald-300 dark:border-emerald-600 ring-1 ring-emerald-100 dark:ring-emerald-900/40 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 20 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Product Picker</span>
          <Tip text="Pick one exact product, then run IndexLab." />
          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            Start Here
          </span>
        </div>
        <ActivityGauge
          label="selected product activity"
          currentPerMin={productPickerActivity.currentPerMin}
          peakPerMin={productPickerActivity.peakPerMin}
          active={processRunning}
        />
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select
          value={singleBrand}
          onChange={(e) => {
            onBrandChange(e.target.value);
          }}
          disabled={isAll || busy}
          className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
          title="Step 1: Choose brand."
        >
          <option value="">1) select brand</option>
          {brandOptions.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
        <select
          value={singleModel}
          onChange={(e) => {
            onModelChange(e.target.value);
          }}
          disabled={isAll || busy || !singleBrand}
          className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
          title="Step 2: Choose model."
        >
          <option value="">2) select model</option>
          {modelOptions.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <select
          value={singleProductId}
          onChange={(e) => onProductIdChange(e.target.value)}
          disabled={isAll || busy || !singleModel}
          className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
          title="Step 3: Choose variant."
        >
          <option value="">3) select variant</option>
          {variantOptions.map((option) => (
            <option key={option.productId} value={option.productId}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs text-gray-600 dark:text-gray-300">
        selected product id: <span className="font-mono">{singleProductId || '(none)'}</span>
        {selectedCatalogProduct ? (
          <span>
            {' '}| {selectedCatalogProduct.brand} {selectedCatalogProduct.model} {displayVariant(selectedCatalogProduct.variant || '')}
          </span>
        ) : null}
      </div>
      <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-gray-800 dark:text-gray-200 inline-flex items-center">
            ambiguity meter
            <Tip text={`Brand + model family size in catalog:
- easy: 1 sibling (green)
- medium: 2-3 siblings (amber/yellow)
- hard: 4-5 siblings (red)
- very hard: 6-8 siblings (fuchsia)
- extra hard: 9+ siblings (purple, hardest)

Variant-empty extraction policy:
- easy/medium: less strict extraction gate
- hard/very hard/extra hard: strict extraction gate`} />
          </span>
          <span className={`px-2 py-0.5 rounded ${selectedAmbiguityMeter.badgeCls}`}>
            {selectedAmbiguityMeter.label}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            family count {formatNumber(selectedAmbiguityMeter.count)}
          </span>
        </div>
        <div className="mt-2 h-2 w-full rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full ${selectedAmbiguityMeter.barCls}`}
            style={{ width: `${selectedAmbiguityMeter.widthPct}%` }}
          />
        </div>
      </div>
          <button
            onClick={onRunIndexLab}
            disabled={!canRunSingle || busy || processRunning}
            className="w-full px-3 py-2 text-sm rounded bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-40"
            title="Run IndexLab for selected product and stream events."
          >
            Run IndexLab
          </button>
        </>
      ) : null}
    </div>
  );
}
