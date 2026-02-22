import {
  computeLlmCostUsd,
  estimateTokensFromText,
  normalizeUsage
} from '../billing/costRates.js';
import { selectLlmProvider } from './providers/index.js';
import { LlmProviderHealth } from './providerHealth.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const _providerHealth = new LlmProviderHealth({
  failureThreshold: 5,
  openMs: 60_000
});

export function getProviderHealth() {
  return _providerHealth;
}

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
  if (url.includes('chatmock') || url.includes('localhost')) {
    return 'chatmock';
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

function inferImageMimeType(uri = '', fallback = 'image/jpeg') {
  const token = String(uri || '').toLowerCase();
  if (token.endsWith('.jpg') || token.endsWith('.jpeg')) return 'image/jpeg';
  if (token.endsWith('.png')) return 'image/png';
  if (token.endsWith('.webp')) return 'image/webp';
  if (token.endsWith('.gif')) return 'image/gif';
  if (token.endsWith('.bmp')) return 'image/bmp';
  return fallback;
}

function isImageMimeType(mime = '') {
  return String(mime || '').trim().toLowerCase().startsWith('image/');
}

function normalizeUserInput(user) {
  if (user && typeof user === 'object' && !Array.isArray(user)) {
    const text = String(user.text ?? user.prompt ?? user.payload ?? '').trim();
    const rawImages = Array.isArray(user.images) ? user.images : [];
    return {
      text,
      images: rawImages
        .map((row) => ({
          id: String(row?.id || '').trim(),
          file_uri: String(row?.file_uri || row?.uri || row?.url || '').trim(),
          mime_type: String(row?.mime_type || '').trim(),
          caption: String(row?.caption || '').trim()
        }))
        .filter((row) => row.file_uri)
    };
  }
  return {
    text: String(user || ''),
    images: []
  };
}

async function resolveImageUrlForPrompt({
  uri = '',
  mimeType = '',
  maxInlineBytes = 700_000
} = {}) {
  const token = String(uri || '').trim();
  if (!token) return null;
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (normalizedMime && !isImageMimeType(normalizedMime)) {
    return null;
  }
  if (/^https?:\/\//i.test(token) || token.startsWith('data:')) {
    if (token.startsWith('data:')) {
      const mimeMatch = token.match(/^data:([^;,]+)[;,]/i);
      const dataMime = String(mimeMatch?.[1] || '').trim().toLowerCase();
      if (dataMime && !isImageMimeType(dataMime)) {
        return null;
      }
    }
    return token;
  }
  if (/^(s3|gs):\/\//i.test(token)) {
    return null;
  }
  const localCandidates = [token];
  if (!path.isAbsolute(token) && token.includes('/')) {
    const outputRoot = String(process.env.LOCAL_OUTPUT_ROOT || 'out').trim() || 'out';
    localCandidates.push(path.resolve(outputRoot, ...token.split('/')));
    const inputRoot = String(process.env.LOCAL_INPUT_ROOT || 'fixtures/s3').trim() || 'fixtures/s3';
    localCandidates.push(path.resolve(inputRoot, ...token.split('/')));
  }
  for (const candidatePath of localCandidates) {
    try {
      const buffer = await fs.readFile(candidatePath);
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) continue;
      if (buffer.length > Math.max(64_000, Number(maxInlineBytes || 700_000))) {
        continue;
      }
      const effectiveMime = mimeType || inferImageMimeType(candidatePath);
      return `data:${effectiveMime};base64,${buffer.toString('base64')}`;
    } catch {
      // try next local candidate
    }
  }
  return null;
}

async function buildUserMessageContent({
  user,
  usageContext = {}
} = {}) {
  const normalized = normalizeUserInput(user);
  const text = normalized.text || '';
  const maxImages = Math.max(0, Number.parseInt(String(usageContext?.multimodal_max_images || 6), 10) || 6);
  const maxInlineBytes = Math.max(64_000, Number.parseInt(String(usageContext?.multimodal_max_inline_bytes || 700_000), 10) || 700_000);
  const images = [];
  const imageSources = [];
  const imageDebug = [];
  for (const image of normalized.images.slice(0, maxImages)) {
    const effectiveMime = String(image.mime_type || inferImageMimeType(image.file_uri, 'image/jpeg')).trim();
    if (!isImageMimeType(effectiveMime)) {
      imageDebug.push({
        file_uri: image.file_uri,
        mime_type: effectiveMime,
        resolved: false,
        skipped_reason: 'unsupported_mime'
      });
      continue;
    }
    const resolved = await resolveImageUrlForPrompt({
      uri: image.file_uri,
      mimeType: effectiveMime,
      maxInlineBytes
    });
    imageDebug.push({
      file_uri: image.file_uri,
      mime_type: effectiveMime,
      resolved: Boolean(resolved)
    });
    if (!resolved) {
      continue;
    }
    images.push({
      type: 'image_url',
      image_url: {
        url: resolved
      }
    });
    imageSources.push({
      id: image.id || '',
      file_uri: image.file_uri,
      mime_type: effectiveMime,
      caption: image.caption || ''
    });
  }
  if (images.length === 0) {
    return {
      content: text,
      text,
      imageCount: 0,
      imageSources,
      imageDebug
    };
  }
  const content = [
    { type: 'text', text },
    ...images
  ];
  return {
    content,
    text,
    imageCount: images.length,
    imageSources,
    imageDebug
  };
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

function stripThinkTags(text) {
  const raw = String(text || '');
  if (!raw) return '';
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractBalancedJsonSegments(text) {
  const raw = String(text || '');
  if (!raw) return [];
  const segments = [];
  for (let start = 0; start < raw.length; start += 1) {
    const open = raw[start];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
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
      if (ch === open) {
        depth += 1;
        continue;
      }
      if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          segments.push(raw.slice(start, i + 1).trim());
          start = i;
          break;
        }
      }
    }
  }
  return segments;
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

  const candidates = [];
  const pushCandidate = (value) => {
    const token = String(value || '').trim();
    if (token && !candidates.includes(token)) {
      candidates.push(token);
    }
  };
  pushCandidate(stripThinkTags(direct));
  pushCandidate(extractJsonCandidate(direct));
  for (const segment of extractBalancedJsonSegments(direct)) {
    pushCandidate(segment);
  }
  // Prefer later candidates because models often append the final strict JSON at the end.
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(candidates[i]);
    } catch {
      // continue
    }
  }
  return null;
}

function resolveModelTokenProfile(profileMap = {}, model = '') {
  const token = normalizeModel(model);
  if (!token || !profileMap || typeof profileMap !== 'object') {
    return { defaultOutputTokens: 0, maxOutputTokens: 0 };
  }
  let selected = null;
  let selectedKey = '';
  for (const [rawModel, rawProfile] of Object.entries(profileMap || {})) {
    const key = normalizeModel(rawModel);
    if (!key || !rawProfile || typeof rawProfile !== 'object') continue;
    const matches = token === key || token.startsWith(key) || key.startsWith(token);
    if (!matches) continue;
    if (!selected || key.length > selectedKey.length) {
      selected = rawProfile;
      selectedKey = key;
    }
  }
  if (!selected) {
    return { defaultOutputTokens: 0, maxOutputTokens: 0 };
  }
  const defaultOutputTokens = Number.parseInt(String(
    selected.defaultOutputTokens
    ?? selected.default_output_tokens
    ?? selected.default
    ?? 0
  ), 10);
  const maxOutputTokens = Number.parseInt(String(
    selected.maxOutputTokens
    ?? selected.max_output_tokens
    ?? selected.max
    ?? selected.maximum
    ?? 0
  ), 10);
  return {
    defaultOutputTokens: Number.isFinite(defaultOutputTokens) ? Math.max(0, defaultOutputTokens) : 0,
    maxOutputTokens: Number.isFinite(maxOutputTokens) ? Math.max(0, maxOutputTokens) : 0
  };
}

function resolveEffectiveMaxTokens({
  model = '',
  deepSeekMode = false,
  reasoningMode = false,
  reasoningBudget = 0,
  maxTokens = 0,
  usageContext = {}
} = {}) {
  const profile = resolveModelTokenProfile(usageContext?.model_token_profile_map || {}, model);
  const defaultCap = Number.parseInt(String(usageContext?.default_output_token_cap || 0), 10);
  let requested = 0;
  if (reasoningMode && Number(reasoningBudget || 0) > 0) {
    requested = Number(reasoningBudget || 0);
  } else if (Number(maxTokens || 0) > 0) {
    requested = Number(maxTokens || 0);
  } else if (Number(profile.defaultOutputTokens || 0) > 0) {
    requested = Number(profile.defaultOutputTokens || 0);
  } else if (Number(defaultCap || 0) > 0) {
    requested = Number(defaultCap || 0);
  }
  let capped = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  const modelMax = Number(profile.maxOutputTokens || 0);
  if (modelMax > 0) {
    capped = Math.min(capped || modelMax, modelMax);
  }
  if (deepSeekMode) {
    const deepSeekCap = Number.parseInt(String(usageContext?.deepseek_default_max_output_tokens || 8192), 10);
    if (Number.isFinite(deepSeekCap) && deepSeekCap > 0) {
      capped = Math.min(capped || deepSeekCap, deepSeekCap);
    }
  }
  if (capped > 0 && capped < 128) {
    capped = 128;
  }
  return capped;
}

function validateParsedShape(parsed, schema) {
  if (!schema || parsed === null || parsed === undefined) {
    return { valid: parsed !== null && parsed !== undefined, errors: [] };
  }
  const errors = [];
  if (schema.type === 'object' && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    errors.push(`expected object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
  }
  if (schema.type === 'array' && !Array.isArray(parsed)) {
    errors.push(`expected array, got ${typeof parsed}`);
  }
  if (schema.type === 'object' && Array.isArray(schema.required) && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const key of schema.required) {
      if (parsed[key] === undefined) {
        errors.push(`missing required key: ${key}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
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
  requestOptions = null,
  apiKey,
  baseUrl,
  provider,
  costRates,
  usageContext = {},
  onUsage,
  reasoningMode = false,
  reasoningBudget = 0,
  maxTokens = 0,
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
  const routeRole = String(usageContext?.route_role || '').trim();
  const traceWriter = usageContext?.traceWriter || null;
  const traceContext = usageContext?.trace_context || {};
  const traceTargetFields = Array.isArray(traceContext?.target_fields)
    ? traceContext.target_fields.filter(Boolean)
    : [];
  const developerMode = Boolean(usageContext?.developer_mode);
  const traceRingSize = Math.max(5, Number.parseInt(String(usageContext?.trace_ring_size || 50), 10) || 50);
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
  const effectiveMaxTokens = resolveEffectiveMaxTokens({
    model,
    deepSeekMode,
    reasoningMode: Boolean(reasoningMode),
    reasoningBudget: Number(reasoningBudget || 0),
    maxTokens: Number(maxTokens || 0),
    usageContext
  });
  const userMessage = await buildUserMessageContent({
    user,
    usageContext
  });
  let promptPreview = '';
  try {
    const promptPayload = developerMode
      ? {
        system: String(effectiveSystem || '').slice(0, 2000),
        user: String(userMessage.text || '').slice(0, 10_000),
        multimodal_image_count: userMessage.imageCount,
        images: userMessage.imageSources
      }
      : {
        redacted: true,
        system_chars: String(effectiveSystem || '').length,
        user_chars: String(userMessage.text || '').length,
        multimodal_image_count: userMessage.imageCount
      };
    promptPreview = JSON.stringify(promptPayload).slice(0, 8000);
  } catch {
    promptPreview = '';
  }

  const buildBody = ({ useJsonSchema }) => {
    const body = {
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: effectiveSystem },
        { role: 'user', content: userMessage.content }
      ]
    };

    if (effectiveMaxTokens > 0) {
      body.max_tokens = effectiveMaxTokens;
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
    if (requestOptions && typeof requestOptions === 'object') {
      body.request_options = requestOptions;
    }

    return body;
  };

  const parseStructuredResult = (content, { fallbackExtraction = false } = {}) => {
    const parsed = parseJsonContent(content);
    if (parsed === null) {
      throw new Error('OpenAI API content was not valid JSON');
    }
    if (jsonSchema) {
      const schemaToValidate = jsonSchema?.schema || jsonSchema;
      const validation = validateParsedShape(parsed, schemaToValidate);
      if (!validation.valid) {
        logger?.warn?.('structured_output_shape_mismatch', {
          reason,
          provider: providerLabel,
          model,
          base_url: baseUrlNormalized,
          endpoint: `${baseUrlNormalized}/v1/chat/completions`,
          errors: validation.errors,
          fallback_extraction: Boolean(fallbackExtraction)
        });
      }
    }
    if (fallbackExtraction) {
      logger?.info?.('structured_output_fallback_used', {
        reason,
        provider: providerLabel,
        model
      });
    }
    return parsed;
  };

  const emitFailure = (safeMessage) => {
    logger?.warn?.('llm_call_failed', {
      reason,
      route_role: routeRole,
      provider: providerLabel,
      model,
      base_url: baseUrlNormalized,
      endpoint: `${baseUrlNormalized}/v1/chat/completions`,
      message: safeMessage,
      deepseek_mode_detected: Boolean(deepSeekMode),
      json_schema_requested: Boolean(jsonSchemaRequested),
      multimodal_image_count: Number(userMessage.imageCount || 0)
    });
  };

  const emitTrace = async ({
    status = 'ok',
    retryWithoutSchema = false,
    responseModel = '',
    usage = {},
    responseText = '',
    error = '',
    requestBody = null
  } = {}) => {
    if (!traceWriter || typeof traceWriter.writeJson !== 'function') {
      return;
    }
    try {
      const trace = await traceWriter.writeJson({
        section: 'llm',
        prefix: 'call',
        payload: {
          ts: new Date().toISOString(),
          status,
          provider: providerLabel,
          model: responseModel || model,
          purpose: reason,
          target_fields: traceTargetFields.slice(0, 80),
          target_fields_count: traceTargetFields.length,
          route_role: usageContext?.route_role || null,
          retry_without_schema: Boolean(retryWithoutSchema),
          deepseek_mode_detected: Boolean(deepSeekMode),
          json_schema_requested: Boolean(jsonSchemaRequested),
          prompt: developerMode
            ? {
              system: String(effectiveSystem || '').slice(0, 2000),
              user: String(userMessage.text || '').slice(0, 10_000),
              multimodal_image_count: userMessage.imageCount,
              images: userMessage.imageSources
            }
            : {
              redacted: true,
              system_chars: String(effectiveSystem || '').length,
              user_chars: String(userMessage.text || '').length,
              multimodal_image_count: userMessage.imageCount
            },
          request_body: developerMode
            ? requestBody
            : {
              redacted: true,
              has_request_body: Boolean(requestBody)
            },
          response: developerMode
            ? { text: String(responseText || '').slice(0, 10_000) }
            : {
              redacted: true,
              chars: String(responseText || '').length
            },
          usage: usage || {},
          max_tokens_applied: effectiveMaxTokens,
          error: String(error || '').slice(0, 1500)
        },
        ringSize: traceRingSize
      });
      logger?.info?.('llm_trace_written', {
        provider: providerLabel,
        model: responseModel || model,
        base_url: baseUrlNormalized,
        endpoint: `${baseUrlNormalized}/v1/chat/completions`,
        purpose: reason,
        target_fields_count: traceTargetFields.length,
        trace_path: trace.trace_path
      });
    } catch (traceError) {
      logger?.warn?.('llm_trace_write_failed', {
        purpose: reason,
        message: traceError.message
      });
    }
  };

  const emitUsage = async ({ usage, content, responseModel, retryWithoutSchema = false }) => {
    if (typeof onUsage !== 'function') {
      return;
    }

    const fallbackUsage = {
      promptTokens: estimateTokensFromText(`${effectiveSystem}\n${String(userMessage.text || '')}`),
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
      route_role: routeRole,
      provider: providerLabel,
      model: responseModel || model,
      base_url: baseUrlNormalized,
      endpoint: `${baseUrlNormalized}/v1/chat/completions`,
      prompt_tokens: normalizedUsage.promptTokens,
      completion_tokens: normalizedUsage.completionTokens,
      cached_prompt_tokens: normalizedUsage.cachedPromptTokens,
      total_tokens: normalizedUsage.totalTokens,
      cost_usd: cost.costUsd,
      estimated_usage: Boolean(normalizedUsage.estimated),
      deepseek_mode_detected: Boolean(deepSeekMode),
      json_schema_requested: Boolean(jsonSchemaRequested),
      multimodal_image_count: Number(userMessage.imageCount || 0),
      retry_without_schema: Boolean(retryWithoutSchema)
    });
  };

  if (!_providerHealth.canRequest(providerLabel)) {
    const snap = _providerHealth.snapshot(providerLabel);
    const safeMessage = `Provider '${providerLabel}' circuit open (${snap.failure_count} consecutive failures). Retry after cooldown.`;
    logger?.warn?.('llm_provider_circuit_open', {
      provider: providerLabel,
      model,
      base_url: baseUrlNormalized,
      endpoint: `${baseUrlNormalized}/v1/chat/completions`,
      failure_count: snap.failure_count,
      state: snap.state,
      open_until_ms: snap.open_until_ms
    });
    throw new Error(safeMessage);
  }

  logger?.info?.('llm_call_started', {
    purpose: reason,
    reason,
    route_role: routeRole,
    provider: providerLabel,
    model,
    base_url: baseUrlNormalized,
    endpoint: `${baseUrlNormalized}/v1/chat/completions`,
    deepseek_mode_detected: Boolean(deepSeekMode),
    json_schema_requested: Boolean(jsonSchemaRequested),
    max_tokens_requested: Math.max(Number(reasoningMode ? reasoningBudget : maxTokens) || 0, 0),
    max_tokens_applied: effectiveMaxTokens,
    multimodal_image_count: Number(userMessage.imageCount || 0),
    multimodal_image_sources: userMessage.imageSources,
    multimodal_image_debug: Array.isArray(userMessage.imageDebug)
      ? userMessage.imageDebug.slice(0, 8)
      : [],
    prompt_preview: promptPreview
  });

  try {
    const useJsonSchema = Boolean(jsonSchemaRequested);
    const firstBody = buildBody({ useJsonSchema });
    const first = await requestChatCompletion({
      providerClient,
      baseUrl: baseUrlNormalized,
      apiKey,
      body: firstBody,
      controller
    });
    await emitUsage({
      usage: first.usage,
      content: first.content,
      responseModel: first.responseModel
    });
    const parsed = parseStructuredResult(first.content);
    _providerHealth.recordSuccess(providerLabel);
    logger?.info?.('llm_call_completed', {
      purpose: reason,
      reason,
      route_role: routeRole,
      provider: providerLabel,
      model: first.responseModel || model,
      base_url: baseUrlNormalized,
      endpoint: `${baseUrlNormalized}/v1/chat/completions`,
      deepseek_mode_detected: Boolean(deepSeekMode),
      json_schema_requested: Boolean(jsonSchemaRequested),
      retry_without_schema: false,
      multimodal_image_count: Number(userMessage.imageCount || 0),
      response_preview: String(first.content || '').slice(0, 12_000)
    });
    await emitTrace({
      status: 'ok',
      retryWithoutSchema: false,
      responseModel: first.responseModel || model,
      usage: first.usage,
      responseText: first.content,
      requestBody: firstBody
    });
    return parsed;
  } catch (firstError) {
    if (!jsonSchema || !shouldRetryWithoutJsonSchema(firstError)) {
      _providerHealth.recordFailure(providerLabel, firstError);
      const safeMessage = sanitizeText(firstError.message, [apiKey]);
      emitFailure(safeMessage);
      await emitTrace({
        status: 'error',
        retryWithoutSchema: false,
        responseModel: model,
        usage: {},
        responseText: '',
        error: safeMessage,
        requestBody: buildBody({ useJsonSchema: Boolean(jsonSchemaRequested) })
      });
      throw new Error(safeMessage);
    }

    try {
      const retryBody = buildBody({ useJsonSchema: false });
      const retry = await requestChatCompletion({
        providerClient,
        baseUrl: baseUrlNormalized,
        apiKey,
        body: retryBody,
        controller
      });
      await emitUsage({
        usage: retry.usage,
        content: retry.content,
        responseModel: retry.responseModel,
        retryWithoutSchema: true
      });
      const parsed = parseStructuredResult(retry.content, { fallbackExtraction: true });
      _providerHealth.recordSuccess(providerLabel);
      logger?.info?.('llm_call_completed', {
        purpose: reason,
        reason,
        route_role: routeRole,
        provider: providerLabel,
        model: retry.responseModel || model,
        base_url: baseUrlNormalized,
        endpoint: `${baseUrlNormalized}/v1/chat/completions`,
        deepseek_mode_detected: Boolean(deepSeekMode),
        json_schema_requested: Boolean(jsonSchemaRequested),
        retry_without_schema: true,
        multimodal_image_count: Number(userMessage.imageCount || 0),
        response_preview: String(retry.content || '').slice(0, 12_000)
      });
      await emitTrace({
        status: 'ok',
        retryWithoutSchema: true,
        responseModel: retry.responseModel || model,
        usage: retry.usage,
        responseText: retry.content,
        requestBody: retryBody
      });
      return parsed;
    } catch (retryError) {
      _providerHealth.recordFailure(providerLabel, retryError);
      const safeMessage = sanitizeText(retryError.message, [apiKey]);
      emitFailure(safeMessage);
      await emitTrace({
        status: 'error',
        retryWithoutSchema: true,
        responseModel: model,
        usage: {},
        responseText: '',
        error: safeMessage,
        requestBody: buildBody({ useJsonSchema: false })
      });
      throw new Error(safeMessage);
    }
  } finally {
    clearTimeout(timer);
  }
}
