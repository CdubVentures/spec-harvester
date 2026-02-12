import {
  computeLlmCostUsd,
  estimateTokensFromText,
  normalizeUsage
} from '../billing/costRates.js';
import { selectLlmProvider } from './providers/index.js';

function normalizeBaseUrl(value) {
  return String(value || 'https://api.openai.com').replace(/\/+$/, '');
}

function normalizeModel(value) {
  return String(value || '').trim().toLowerCase();
}

function isDeepSeekRequest({ baseUrl, model }) {
  const url = normalizeBaseUrl(baseUrl).toLowerCase();
  const modelToken = normalizeModel(model);
  return url.includes('deepseek.com') || modelToken.startsWith('deepseek');
}

function providerName({ baseUrl, model }) {
  if (isDeepSeekRequest({ baseUrl, model })) {
    return 'deepseek';
  }
  const url = normalizeBaseUrl(baseUrl).toLowerCase();
  if (url.includes('googleapis.com') || normalizeModel(model).includes('gemini')) {
    return 'gemini';
  }
  return 'openai';
}

function shouldRetryWithoutJsonSchema(error) {
  const token = String(error?.message || '').toLowerCase();
  return (
    token.includes('response_format') ||
    token.includes('json_schema') ||
    token.includes('unsupported') ||
    token.includes('invalid parameter') ||
    token.includes('invalid_request_error')
  );
}

function sanitizeText(message, secrets = []) {
  let output = String(message || '');
  for (const secret of secrets.filter(Boolean)) {
    output = output.split(secret).join('[redacted]');
  }
  return output;
}

function extractMessageContent(message) {
  if (!message) {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((item) => item && item.type === 'text')
      .map((item) => item.text || '')
      .join('\n');
  }
  return '';
}

function extractJsonCandidate(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return '';
  }

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  const startIndexes = [];
  const objectStart = raw.indexOf('{');
  const arrayStart = raw.indexOf('[');
  if (objectStart >= 0) {
    startIndexes.push(objectStart);
  }
  if (arrayStart >= 0) {
    startIndexes.push(arrayStart);
  }
  if (!startIndexes.length) {
    return raw;
  }

  const start = Math.min(...startIndexes);
  const openChar = raw[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === '\\') {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
      continue;
    }
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1).trim();
      }
    }
  }

  return raw;
}

function parseJsonContent(content) {
  const direct = String(content || '').trim();
  if (!direct) {
    return null;
  }
  try {
    return JSON.parse(direct);
  } catch {
    // continue with relaxed extraction
  }

  const extracted = extractJsonCandidate(direct);
  if (!extracted) {
    return null;
  }
  try {
    return JSON.parse(extracted);
  } catch {
    return null;
  }
}

async function requestChatCompletion({
  providerClient,
  baseUrl,
  apiKey,
  body,
  controller
}) {
  const parsedBody = await providerClient.request({
    baseUrl,
    apiKey,
    body,
    signal: controller.signal
  });

  const message = parsedBody?.choices?.[0]?.message;
  const content = extractMessageContent(message);
  if (!content) {
    throw new Error('OpenAI API response missing message content');
  }

  return {
    message,
    content,
    usage: parsedBody?.usage || {},
    responseModel: parsedBody?.model || ''
  };
}

export function redactOpenAiError(message, apiKey) {
  return sanitizeText(message, [apiKey]);
}

export async function callOpenAI({
  model,
  system,
  user,
  jsonSchema,
  apiKey,
  baseUrl,
  provider,
  costRates,
  usageContext = {},
  onUsage,
  reasoningMode = false,
  reasoningBudget = 0,
  timeoutMs = 40_000,
  logger
}) {
  if (!apiKey) {
    throw new Error('LLM_API_KEY is not configured');
  }

  const baseUrlNormalized = normalizeBaseUrl(baseUrl);
  const providerClient = selectLlmProvider(
    provider || providerName({ baseUrl: baseUrlNormalized, model })
  );
  const providerLabel = providerClient.name;
  const deepSeekMode = isDeepSeekRequest({ baseUrl, model });
  const reason = String(usageContext?.reason || 'extract');
  const jsonSchemaRequested = Boolean(jsonSchema && !deepSeekMode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const forceJsonOutput = Boolean(jsonSchema && deepSeekMode);
  const effectiveSystem = [
    String(system || ''),
    reasoningMode ? 'Use deliberate internal reasoning before finalizing output.' : '',
    forceJsonOutput ? 'Return strict JSON only. Do not include markdown or explanations.' : ''
  ]
    .filter(Boolean)
    .join('\n');

  const buildBody = ({ useJsonSchema }) => {
    const body = {
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: effectiveSystem },
        { role: 'user', content: String(user || '') }
      ]
    };

    if (reasoningMode && Number(reasoningBudget || 0) > 0) {
      body.max_tokens = Math.max(256, Number(reasoningBudget || 0));
    }

    if (useJsonSchema && jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'structured_output',
          strict: true,
          schema: jsonSchema
        }
      };
    }

    return body;
  };

  const parseStructuredResult = (content) => {
    const parsed = parseJsonContent(content);
    if (parsed === null) {
      throw new Error('OpenAI API content was not valid JSON');
    }
    return parsed;
  };

  const emitFailure = (safeMessage) => {
    logger?.warn?.('llm_call_failed', {
      reason,
      provider: providerLabel,
      model,
      message: safeMessage,
      deepseek_mode_detected: Boolean(deepSeekMode),
      json_schema_requested: Boolean(jsonSchemaRequested)
    });
  };

  const emitUsage = async ({ usage, content, responseModel, retryWithoutSchema = false }) => {
    if (typeof onUsage !== 'function') {
      return;
    }

    const fallbackUsage = {
      promptTokens: estimateTokensFromText(`${effectiveSystem}\n${String(user || '')}`),
      completionTokens: estimateTokensFromText(content),
      cachedPromptTokens: 0,
      estimated: !usage || Object.keys(usage || {}).length === 0
    };
    const normalizedUsage = normalizeUsage(usage, fallbackUsage);
    const cost = computeLlmCostUsd({
      usage: normalizedUsage,
      rates: costRates || {},
      model: responseModel || model
    });

    await onUsage({
      provider: providerLabel,
      model: responseModel || model,
      prompt_tokens: normalizedUsage.promptTokens,
      completion_tokens: normalizedUsage.completionTokens,
      cached_prompt_tokens: normalizedUsage.cachedPromptTokens,
      total_tokens: normalizedUsage.totalTokens,
      cost_usd: cost.costUsd,
      estimated_usage: Boolean(normalizedUsage.estimated),
      retry_without_schema: Boolean(retryWithoutSchema),
      deepseek_mode_detected: Boolean(deepSeekMode),
      json_schema_requested: Boolean(jsonSchemaRequested),
      ...usageContext
    });
    logger?.info?.('llm_call_usage', {
      purpose: reason,
      reason,
      provider: providerLabel,
      model: responseModel || model,
      prompt_tokens: normalizedUsage.promptTokens,
      completion_tokens: normalizedUsage.completionTokens,
      cached_prompt_tokens: normalizedUsage.cachedPromptTokens,
      total_tokens: normalizedUsage.totalTokens,
      cost_usd: cost.costUsd,
      estimated_usage: Boolean(normalizedUsage.estimated),
      deepseek_mode_detected: Boolean(deepSeekMode),
      json_schema_requested: Boolean(jsonSchemaRequested),
      retry_without_schema: Boolean(retryWithoutSchema)
    });
  };

  logger?.info?.('llm_call_started', {
    purpose: reason,
    reason,
    provider: providerLabel,
    model,
    deepseek_mode_detected: Boolean(deepSeekMode),
    json_schema_requested: Boolean(jsonSchemaRequested)
  });

  try {
    const useJsonSchema = Boolean(jsonSchemaRequested);
    const first = await requestChatCompletion({
      providerClient,
      baseUrl: baseUrlNormalized,
      apiKey,
      body: buildBody({ useJsonSchema }),
      controller
    });
    await emitUsage({
      usage: first.usage,
      content: first.content,
      responseModel: first.responseModel
    });
    const parsed = parseStructuredResult(first.content);
    logger?.info?.('llm_call_completed', {
      purpose: reason,
      reason,
      provider: providerLabel,
      model: first.responseModel || model,
      deepseek_mode_detected: Boolean(deepSeekMode),
      json_schema_requested: Boolean(jsonSchemaRequested),
      retry_without_schema: false
    });
    return parsed;
  } catch (firstError) {
    if (!jsonSchema || !shouldRetryWithoutJsonSchema(firstError)) {
      const safeMessage = sanitizeText(firstError.message, [apiKey]);
      emitFailure(safeMessage);
      throw new Error(safeMessage);
    }

    try {
      const retry = await requestChatCompletion({
        providerClient,
        baseUrl: baseUrlNormalized,
        apiKey,
        body: buildBody({ useJsonSchema: false }),
        controller
      });
      await emitUsage({
        usage: retry.usage,
        content: retry.content,
        responseModel: retry.responseModel,
        retryWithoutSchema: true
      });
      const parsed = parseStructuredResult(retry.content);
      logger?.info?.('llm_call_completed', {
        purpose: reason,
        reason,
        provider: providerLabel,
        model: retry.responseModel || model,
        deepseek_mode_detected: Boolean(deepSeekMode),
        json_schema_requested: Boolean(jsonSchemaRequested),
        retry_without_schema: true
      });
      return parsed;
    } catch (retryError) {
      const safeMessage = sanitizeText(retryError.message, [apiKey]);
      emitFailure(safeMessage);
      throw new Error(safeMessage);
    }
  } finally {
    clearTimeout(timer);
  }
}
