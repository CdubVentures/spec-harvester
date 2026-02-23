export const FLAG_DESCRIPTIONS: Record<string, { label: string; description: string; recommendation: string }> = {
  constraint_conflict: {
    label: 'Constraint Conflict',
    description: 'This field contradicts another field based on configured constraints.',
    recommendation: 'Check related fields. One or both values may be incorrect.',
  },
  compound_range_conflict: {
    label: 'Compound Range Conflict',
    description: 'Value falls outside the effective range from both field rules and component properties.',
    recommendation: 'The effective range is tighter than either constraint alone.',
  },
};

export function getFlagInfo(code: string) {
  return FLAG_DESCRIPTIONS[code] || {
    label: code.replace(/_/g, ' '),
    description: `Flagged: ${code}`,
    recommendation: 'Review this field and resolve the issue.',
  };
}
