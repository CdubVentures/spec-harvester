import { requestOpenAICompatibleChatCompletion } from './openaiCompatible.js';

export async function requestGeminiChatCompletion({
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai',
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
