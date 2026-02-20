import { FieldRulesEngine } from '../engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../engine/runtimeGate.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasKnownValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

export async function runQaJudge({
  storage,
  config,
  category,
  productId,
  logger = null
}) {
  if (!category || !productId) {
    return { ok: false, error: 'category and productId are required' };
  }

  const specKey = storage.resolveOutputKey(category, productId, 'final', 'spec.json');
  const spec = await storage.readJsonOrNull(specKey);
  if (!spec) {
    return { ok: false, error: `spec not found: ${specKey}` };
  }

  const provenanceKey = storage.resolveOutputKey(category, productId, 'final', 'provenance.json');
  const provenance = await storage.readJsonOrNull(provenanceKey) || {};

  let engine = null;
  try {
    engine = await FieldRulesEngine.create(category, { config });
  } catch {
    // No field rules for this category — run without engine
  }

  const fields = spec.fields || spec;
  const fieldOrder = Object.keys(fields);
  const totalFields = fieldOrder.length;
  const knownFields = fieldOrder.filter((f) => hasKnownValue(fields[f]));
  const unknownFields = fieldOrder.filter((f) => !hasKnownValue(fields[f]));

  // Evidence audit
  const evidenceIssues = [];
  for (const field of knownFields) {
    const prov = provenance[field];
    if (!prov || typeof prov !== 'object') {
      evidenceIssues.push({
        field,
        issue: 'no_provenance',
        value: String(fields[field] || '')
      });
      continue;
    }
    if (!prov.url && !prov.source_id) {
      evidenceIssues.push({
        field,
        issue: 'no_source_url',
        value: String(fields[field] || '')
      });
    }
    if (!prov.snippet_id && !prov.quote) {
      evidenceIssues.push({
        field,
        issue: 'no_evidence_link',
        value: String(fields[field] || '')
      });
    }
  }

  // Contract validation via runtime gate
  let gateResult = null;
  if (engine) {
    gateResult = applyRuntimeFieldRules({
      engine,
      fields: { ...fields },
      provenance,
      fieldOrder,
      enforceEvidence: false,
      respectPerFieldEvidence: false
    });
  }

  const contractFailures = toArray(gateResult?.failures);
  const contractWarnings = toArray(gateResult?.warnings);

  const coverage = totalFields > 0 ? knownFields.length / totalFields : 0;

  return {
    ok: true,
    category,
    productId,
    summary: {
      total_fields: totalFields,
      known_fields: knownFields.length,
      unknown_fields: unknownFields.length,
      coverage_ratio: Math.round(coverage * 1000) / 1000,
      evidence_issues: evidenceIssues.length,
      contract_failures: contractFailures.length,
      contract_warnings: contractWarnings.length
    },
    evidence_issues: evidenceIssues,
    contract_failures: contractFailures,
    contract_warnings: contractWarnings,
    unknown_field_list: unknownFields
  };
}
