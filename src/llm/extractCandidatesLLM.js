import { normalizeWhitespace } from '../utils/common.js';
import { callOpenAI } from './openaiClient.js';

const IDENTITY_KEYS = ['brand', 'model', 'sku', 'mpn', 'gtin', 'variant'];

function llmSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      identityCandidates: {
        type: 'object',
        additionalProperties: false,
        properties: {
          brand: { type: 'string' },
          model: { type: 'string' },
          sku: { type: 'string' },
          mpn: { type: 'string' },
          gtin: { type: 'string' },
          variant: { type: 'string' }
        },
        required: []
      },
      fieldCandidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            value: { type: 'string' },
            keyPath: { type: 'string' },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['field', 'value', 'evidenceRefs']
        }
      },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            values: {
              type: 'array',
              items: { type: 'string' }
            },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['field', 'values', 'evidenceRefs']
        }
      },
      notes: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['identityCandidates', 'fieldCandidates', 'conflicts', 'notes']
  };
}

function sanitizeIdentity(identity, identityLock) {
  const out = {};
  for (const key of IDENTITY_KEYS) {
    const value = normalizeWhitespace(identity?.[key] || '');
    if (!value || value.toLowerCase() === 'unk') {
      continue;
    }
    if (identityLock?.[key] && normalizeWhitespace(identityLock[key])) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function filterEvidenceRefs(refs, validRefs) {
  return [...new Set((refs || []).filter((id) => validRefs.has(id)))];
}

export async function extractCandidatesLLM({
  job,
  categoryConfig,
  evidencePack,
  config,
  logger
}) {
  if (!config.llmEnabled || !config.openaiApiKey) {
    return {
      identityCandidates: {},
      fieldCandidates: [],
      conflicts: [],
      notes: ['LLM disabled']
    };
  }

  const fieldSet = new Set(categoryConfig.fieldOrder || []);
  const validRefs = new Set((evidencePack.references || []).map((item) => item.id));

  const system = [
    'You extract structured hardware spec candidates from evidence snippets.',
    'Rules:',
    '- Only use provided evidence.',
    '- Every proposed field candidate must include evidenceRefs matching provided reference ids.',
    '- If uncertain, omit the candidate.',
    '- No prose; JSON only.'
  ].join('\n');

  const userPayload = {
    product: {
      productId: job.productId,
      brand: job.identityLock?.brand || '',
      model: job.identityLock?.model || '',
      variant: job.identityLock?.variant || '',
      category: job.category || 'mouse'
    },
    schemaFields: categoryConfig.fieldOrder || [],
    anchors: job.anchors || {},
    references: evidencePack.references || [],
    snippets: evidencePack.snippets || []
  };

  try {
    const result = await callOpenAI({
      model: config.openaiModelExtract,
      system,
      user: JSON.stringify(userPayload),
      jsonSchema: llmSchema(),
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      timeoutMs: config.openaiTimeoutMs,
      logger
    });

    const identityCandidates = sanitizeIdentity(result.identityCandidates, job.identityLock || {});

    const fieldCandidates = [];
    for (const row of result.fieldCandidates || []) {
      const field = String(row.field || '').trim();
      const value = normalizeWhitespace(row.value);
      const refs = filterEvidenceRefs(row.evidenceRefs, validRefs);

      if (!fieldSet.has(field)) {
        continue;
      }
      if (!value || value.toLowerCase() === 'unk') {
        continue;
      }
      if (!refs.length) {
        continue;
      }

      fieldCandidates.push({
        field,
        value,
        method: 'llm_extract',
        keyPath: row.keyPath || 'llm.extract',
        evidenceRefs: refs
      });
    }

    const conflicts = [];
    for (const conflict of result.conflicts || []) {
      const refs = filterEvidenceRefs(conflict.evidenceRefs, validRefs);
      if (!refs.length) {
        continue;
      }
      conflicts.push({
        field: String(conflict.field || ''),
        values: (conflict.values || []).map((value) => normalizeWhitespace(value)).filter(Boolean),
        evidenceRefs: refs
      });
    }

    return {
      identityCandidates,
      fieldCandidates,
      conflicts,
      notes: (result.notes || []).map((note) => normalizeWhitespace(note)).filter(Boolean)
    };
  } catch (error) {
    logger?.warn?.('llm_extract_failed', { message: error.message });
    return {
      identityCandidates: {},
      fieldCandidates: [],
      conflicts: [],
      notes: ['LLM extraction failed']
    };
  }
}
