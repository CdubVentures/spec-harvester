export function buildMarkdownSummary({ normalized, summary }) {
  const lines = [];
  lines.push(`# Mouse Spec Summary: ${normalized.productId}`);
  lines.push('');
  lines.push(`- Run ID: ${normalized.runId}`);
  lines.push(`- Validated: ${summary.validated ? 'yes' : 'no'}`);
  lines.push(`- Reason: ${summary.reason}`);
  lines.push(`- Confidence: ${summary.confidence.toFixed(3)}`);
  lines.push(`- Completeness: ${summary.completeness.toFixed(3)}`);
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
