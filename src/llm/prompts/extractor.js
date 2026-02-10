export function buildExtractorPrompt({
  product,
  missingFields = [],
  lexicon = {},
  constraints = {},
  evidencePack
}) {
  const system = [
    'You extract field candidates from evidence for hardware products.',
    'Return JSON only.',
    'Do not guess. Every candidate requires evidence references.'
  ].join('\n');

  const user = {
    product,
    missingFields,
    lexicon,
    constraints,
    evidence: evidencePack,
    output_schema: {
      fieldCandidates: [
        {
          field: 'string',
          value: 'string',
          unit: 'string',
          normalized_value: 'string',
          confidence: 0.0,
          evidence: [{ url: 'string', snippet_id: 'string', quote: 'string<=200chars' }]
        }
      ],
      identityCandidates: {},
      notes: ['string'],
      conflicts: [{ field: 'string', values: ['string'], evidence_refs: ['string'] }]
    }
  };

  return {
    system,
    user
  };
}
