function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(html) {
  return normalizeWhitespace(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function fieldToPattern(field) {
  const token = String(field || '').trim().toLowerCase().replace(/_/g, ' ');
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFieldValueFromText(text, field) {
  const pattern = fieldToPattern(field);
  if (!pattern) {
    return '';
  }
  const regex = new RegExp(`${pattern}\\s*[:\\-]?\\s*([^.;|\\n]{1,80})`, 'i');
  const match = text.match(regex);
  if (!match?.[1]) {
    return '';
  }
  return normalizeWhitespace(match[1]);
}

function parseAssistantJsonContent(response = {}) {
  const content = String(response?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export class AggressiveDomExtractor {
  constructor({
    cortexClient,
    config = {}
  } = {}) {
    this.cortexClient = cortexClient;
    this.modelFast = String(config.cortexModelDom || 'gpt-5-low');
    this.modelDeep = String(config.cortexModelReasoningDeep || 'gpt-5-high');
  }

  async extractFromDom(rawHtml, targetFields = [], identity = {}, sourceMetadata = {}, opts = {}) {
    const fields = Array.isArray(targetFields) ? targetFields : [];
    const text = stripHtml(rawHtml);
    const fieldCandidates = [];
    for (const field of fields) {
      const value = extractFieldValueFromText(text, field);
      if (!value) {
        continue;
      }
      fieldCandidates.push({
        field,
        value,
        method: 'aggressive_dom',
        confidence: 0.62,
        evidenceRefs: [],
        source_id: String(sourceMetadata?.source_id || sourceMetadata?.host || 'dom'),
        quote: value
      });
    }

    const forceDeep = Boolean(opts.forceDeep);
    const selectedModel = forceDeep ? this.modelDeep : this.modelFast;
    let sidecar = null;
    if (this.cortexClient && typeof this.cortexClient.runPass === 'function') {
      const pass = await this.cortexClient.runPass({
        tasks: [{
          id: 'aggressive-dom',
          type: forceDeep ? 'dom_deep' : 'dom',
          critical: forceDeep,
          payload: {
            product_id: identity?.productId || '',
            field_count: fields.length,
            model_hint: selectedModel
          }
        }],
        context: {
          confidence: Number(opts.confidence || 0.9),
          critical_conflicts_remain: Boolean(opts.criticalConflictsRemain),
          critical_gaps_remain: Boolean(opts.criticalGapsRemain)
        }
      });
      sidecar = {
        mode: pass.mode,
        deep_task_count: Number(pass?.plan?.deep_task_count || 0),
        fallback_to_non_sidecar: Boolean(pass.fallback_to_non_sidecar)
      };

      const responsePayload = pass?.results?.[0]?.response;
      const parsed = parseAssistantJsonContent(responsePayload);
      if (parsed?.fieldCandidates && Array.isArray(parsed.fieldCandidates)) {
        for (const row of parsed.fieldCandidates) {
          const field = String(row?.field || '').trim();
          const value = normalizeWhitespace(row?.value || '');
          if (!field || !value || !fields.includes(field)) {
            continue;
          }
          fieldCandidates.push({
            field,
            value,
            method: 'aggressive_dom_sidecar',
            confidence: Number(row?.confidence || 0.66),
            evidenceRefs: Array.isArray(row?.evidenceRefs) ? row.evidenceRefs : [],
            source_id: String(sourceMetadata?.source_id || sourceMetadata?.host || 'dom'),
            quote: String(row?.quote || value)
          });
        }
      }
    }

    return {
      model: selectedModel,
      force_deep: forceDeep,
      fieldCandidates,
      sidecar
    };
  }
}
