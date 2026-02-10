import { requestOpenAICompatibleChatCompletion } from './openaiCompatible.js';
import { requestDeepSeekChatCompletion } from './deepseek.js';
import { requestGeminiChatCompletion } from './gemini.js';

export function selectLlmProvider(provider) {
  const token = String(provider || '').trim().toLowerCase();
  if (token === 'deepseek') {
    return {
      name: 'deepseek',
      request: requestDeepSeekChatCompletion
    };
  }
  if (token === 'gemini') {
    return {
      name: 'gemini',
      request: requestGeminiChatCompletion
    };
  }
  return {
    name: 'openai',
    request: requestOpenAICompatibleChatCompletion
  };
}
