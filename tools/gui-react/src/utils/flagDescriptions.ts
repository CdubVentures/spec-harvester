export const FLAG_DESCRIPTIONS: Record<string, { label: string; description: string; recommendation: string }> = {
  missing_value: {
    label: 'Missing Value',
    description: 'This field has no extracted value — it is unknown or empty.',
    recommendation: 'Run another extraction round, check source URLs, or manually override.',
  },
  critical_field_below_pass_target: {
    label: 'Critical Field Below Target',
    description: 'This critical field has confidence below the pass threshold.',
    recommendation: 'Review evidence carefully. Consider re-running with thorough profile or manual override.',
  },
  below_pass_target: {
    label: 'Below Pass Target',
    description: 'Field confidence is below the configured pass threshold.',
    recommendation: 'Check candidate values and evidence. Accept a candidate or override manually.',
  },
  missing_required_field: {
    label: 'Missing Required Field',
    description: 'This field is marked required but has no valid value.',
    recommendation: 'This must be resolved before finalization. Override manually if needed.',
  },
  low_confidence: {
    label: 'Low Confidence',
    description: 'Confidence is below 60%. The extracted value may be unreliable.',
    recommendation: 'Review candidates and evidence. Accept the best candidate or override.',
  },
  needs_review_confidence: {
    label: 'Needs Review',
    description: 'Confidence is between 60-85%. Value is likely correct but should be verified.',
    recommendation: 'Verify against evidence. Accept current value if it looks correct.',
  },
  constraint_conflict: {
    label: 'Constraint Conflict',
    description: 'This field contradicts another field based on configured constraints.',
    recommendation: 'Check related fields. One or both values may be incorrect.',
  },
};

export function getFlagInfo(code: string) {
  return FLAG_DESCRIPTIONS[code] || {
    label: code.replace(/_/g, ' '),
    description: `Flagged: ${code}`,
    recommendation: 'Review this field and resolve the issue.',
  };
}
