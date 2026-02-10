export function evaluateSearchLoopStop({
  noNewUrlsRounds = 0,
  noNewFieldsRounds = 0,
  budgetReached = false,
  repeatedLowQualityRounds = 0,
  maxNoProgressRounds = 2,
  maxLowQualityRounds = 3
}) {
  if (budgetReached) {
    return {
      stop: true,
      reason: 'budget_reached'
    };
  }
  if (noNewUrlsRounds >= maxNoProgressRounds && noNewFieldsRounds >= maxNoProgressRounds) {
    return {
      stop: true,
      reason: 'no_new_urls_and_fields'
    };
  }
  if (noNewFieldsRounds >= maxNoProgressRounds) {
    return {
      stop: true,
      reason: 'no_new_fields'
    };
  }
  if (repeatedLowQualityRounds >= maxLowQualityRounds) {
    return {
      stop: true,
      reason: 'low_quality_results'
    };
  }
  return {
    stop: false,
    reason: 'continue'
  };
}
