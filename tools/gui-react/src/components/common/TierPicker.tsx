import { TIER_DEFS } from '../../pages/studio/studioConstants';

// Canonical order map: tier id → sort index
const CANONICAL_ORDER: Record<string, number> = {};
TIER_DEFS.forEach((t, i) => { CANONICAL_ORDER[t.id] = i; });

interface TierPickerProps {
  value: string[];
  onChange: (v: string[]) => void;
}

export function TierPicker({ value, onChange }: TierPickerProps) {
  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      // Insert in canonical order
      const next = [...value, id].sort(
        (a, b) => (CANONICAL_ORDER[a] ?? 99) - (CANONICAL_ORDER[b] ?? 99),
      );
      onChange(next);
    }
  }

  return (
    <div className="space-y-1">
      {TIER_DEFS.map((tier) => {
        const checked = value.includes(tier.id);
        const position = checked ? value.indexOf(tier.id) + 1 : null;
        return (
          <label key={tier.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(tier.id)}
              className="rounded border-gray-300"
            />
            <span className="text-xs text-gray-600 dark:text-gray-300">
              {position != null ? (
                <span className="inline-flex items-center justify-center w-4 h-4 mr-1 text-[10px] font-bold text-white bg-accent rounded-full">
                  {position}
                </span>
              ) : null}
              {tier.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
