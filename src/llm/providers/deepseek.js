import { requestOpenAICompatibleChatCompletion } from './openaiCompatible.js';

export async function requestDeepSeekChatCompletion({
  baseUrl = 'https://api.deepseek.com',
  apiKey,
  body,
  signal
}) {
  return requestOpenAICompatibleChatCompletion({
    baseUrl,
    apiKey,
    body,
    signal
  });
}
