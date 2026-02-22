import { runConsensusEngine, applySelectionPolicyReducers } from '../scoring/consensusEngine.js';
import { applyListUnionReducers } from '../scoring/listUnionReducer.js';

export function executeConsensusPhase({
  sourceResults,
  categoryConfig,
  fieldOrder,
  anchors,
  identityLock,
  productId,
  category,
  config,
  fieldRulesEngine
}) {
  const consensus = runConsensusEngine({
    sourceResults,
    categoryConfig,
    fieldOrder,
    anchors,
    identityLock,
    productId,
    category,
    config,
    fieldRulesEngine
  });

  if (fieldRulesEngine) {
    const reduced = applySelectionPolicyReducers({
      fields: consensus.fields,
      candidates: consensus.candidates,
      fieldRulesEngine
    });
    Object.assign(consensus.fields, reduced.fields);
  }

  if (fieldRulesEngine) {
    const unionResult = applyListUnionReducers({
      fields: consensus.fields,
      candidates: consensus.candidates,
      fieldRulesEngine
    });
    Object.assign(consensus.fields, unionResult.fields);
  }

  return consensus;
}
