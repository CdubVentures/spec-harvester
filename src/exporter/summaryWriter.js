export function buildMarkdownSummary({ normalized, summary }) {
  const confidence = Number(summary.confidence || 0);
  const completenessRequired = Number(summary.completeness_required_percent || 0);
  const coverageOverall = Number(summary.coverage_overall_percent || 0);
  const lines = [];
  lines.push(`# Mouse Spec Summary: ${normalized.productId}`);
  lines.push('');
  lines.push(`- Run ID: ${normalized.runId}`);
  lines.push(`- Validated: ${summary.validated ? 'yes' : 'no'}`);
  lines.push(`- Reason: ${summary.validated_reason || summary.reason}`);
  lines.push(`- Confidence: ${confidence.toFixed(3)}`);
  lines.push(`- Completeness Required: ${completenessRequired.toFixed(2)}%`);
  lines.push(`- Coverage Overall: ${coverageOverall.toFixed(2)}%`);
  lines.push(`- Sources Used: ${normalized.sources.used.length}`);
  lines.push('');
  lines.push('## Identity');
  lines.push('');
  lines.push(`- Brand: ${normalized.identity.brand}`);
  lines.push(`- Model: ${normalized.identity.model}`);
  lines.push(`- Variant: ${normalized.identity.variant}`);
  lines.push(`- SKU: ${normalized.identity.sku}`);
  lines.push('');
  lines.push('## Key Fields');
  lines.push('');
  for (const field of ['connection', 'weight', 'sensor', 'polling_rate', 'dpi', 'side_buttons']) {
    lines.push(`- ${field}: ${normalized.fields[field]}`);
  }

  if (summary.anchor_conflicts?.length) {
    lines.push('');
    lines.push('## Anchor Conflicts');
    lines.push('');
    for (const conflict of summary.anchor_conflicts) {
      lines.push(
        `- ${conflict.field}: expected=${conflict.expected}, actual=${conflict.actual}, severity=${conflict.severity}`
      );
    }
  }

  if (summary.fields_below_pass_target?.length) {
    lines.push('');
    lines.push('## Fields Below Pass Target');
    lines.push('');
    for (const field of summary.fields_below_pass_target) {
      lines.push(`- ${field}`);
    }
  }

  return lines.join('\n') + '\n';
}
