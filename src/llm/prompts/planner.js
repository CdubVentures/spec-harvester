export function buildPlannerPrompt({
  product,
  missingFields = [],
  queryTemplates = {},
  preferredDomains = []
}) {
  const system = [
    'You are a research planner for hardware specs.',
    'Return JSON only.',
    'Generate focused search queries for missing fields and trusted domains.'
  ].join('\n');

  const user = {
    product,
    missingFields,
    queryTemplates,
    preferredDomains,
    output_schema: {
      search_queries: ['string'],
      preferred_domains: ['string'],
      url_patterns: ['string'],
      field_priorities: ['string'],
      stop_when: {
        no_new_urls_rounds: 2,
        no_new_fields_rounds: 2
      }
    }
  };

  return {
    system,
    user
  };
}
