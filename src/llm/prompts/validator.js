export function buildValidatorPrompt({
  product,
  candidatesByField = {},
  constraints = {},
  identityLock = {}
}) {
  const system = [
    'You validate conflicting hardware spec candidates.',
    'Return JSON only.',
    'Accept only evidence-backed values that satisfy constraints.'
  ].join('\n');

  const user = {
    product,
    identityLock,
    constraints,
    candidatesByField,
    output_schema: {
      accept: [
        {
          field: 'string',
          value: 'string',
          reason: 'string',
          evidence_refs: ['string'],
          confidence: 0.0
        }
      ],
      reject: [{ field: 'string', value: 'string', reason: 'string' }],
      unknown: [{ field: 'string', unknown_reason: 'string', next_best_queries: ['string'] }]
    }
  };

  return {
    system,
    user
  };
}
