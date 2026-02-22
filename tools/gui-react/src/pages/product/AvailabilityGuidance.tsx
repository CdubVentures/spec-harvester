import { humanizeField } from '../../utils/fieldNormalize';

interface AvailabilityGuidanceProps {
  fieldsBelow: string[];
  criticalBelow: string[];
  missingRequired: string[];
  getLabel?: (key: string) => string;
}

export function AvailabilityGuidance({ fieldsBelow, criticalBelow, missingRequired, getLabel = humanizeField }: AvailabilityGuidanceProps) {
  if (fieldsBelow.length === 0 && criticalBelow.length === 0 && missingRequired.length === 0) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-3 text-sm text-green-800 dark:text-green-200">
        All fields meet their targets.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 space-y-3">
      <h3 className="text-sm font-semibold">Field Availability Guidance</h3>

      {criticalBelow.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
            Critical Fields Below Target ({criticalBelow.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {criticalBelow.map((f) => (
              <span key={f} className="px-2 py-0.5 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded text-xs">
                {getLabel(f)}
              </span>
            ))}
          </div>
        </div>
      )}

      {missingRequired.length > 0 && (
        <div>
          <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1">
            Missing Required Fields ({missingRequired.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {missingRequired.map((f) => (
              <span key={f} className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 rounded text-xs">
                {getLabel(f)}
              </span>
            ))}
          </div>
        </div>
      )}

      {fieldsBelow.length > 0 && (
        <div>
          <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400 mb-1">
            Fields Below Pass Target ({fieldsBelow.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {fieldsBelow.map((f) => (
              <span key={f} className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded text-xs">
                {getLabel(f)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
