function normalizeBaseUrl(value) {
  return String(value || 'https://api.openai.com').replace(/\/+$/, '');
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
  timeoutMs = 40_000,
  logger
}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const endpoint = `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: String(system || '') },
      { role: 'user', content: String(user || '') }
    ]
  };

  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        strict: true,
        schema: jsonSchema
      }
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 1000)}`);
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      throw new Error('OpenAI API returned non-JSON payload');
    }

    const message = parsedBody?.choices?.[0]?.message;
    const content = extractMessageContent(message);
    if (!content) {
      throw new Error('OpenAI API response missing message content');
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new Error('OpenAI API content was not valid JSON');
    }
  } catch (error) {
    const safeMessage = sanitizeText(error.message, [apiKey]);
    logger?.warn?.('openai_call_failed', {
      model,
      message: safeMessage
    });
    throw new Error(safeMessage);
  } finally {
    clearTimeout(timer);
  }
}
