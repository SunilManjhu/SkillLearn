import { GoogleGenAI } from '@google/genai';
import { isRetryableQuotaError } from './formatGenaiError';
import { getResolvedGeminiModelChain } from './geminiModelSettingsFirestore';

export { getGeminiApiKey, getGeminiModelPrimary, getGeminiModelChain } from './geminiModelEnv';

type GenConfig = Parameters<GoogleGenAI['models']['generateContent']>[0]['config'];

/**
 * Runs `generateContent` with the first model in the chain that succeeds.
 * Model order: Firestore admin list (`siteSettings/geminiAiModels`) when present, else env
 * (`GEMINI_MODEL` + `GEMINI_MODEL_FALLBACK`).
 */
export async function generateContentWithModelChain(
  apiKey: string,
  contents: string,
  config: GenConfig
): Promise<{ text: string | null; error: unknown | null }> {
  const ai = new GoogleGenAI({ apiKey });
  const modelChain = await getResolvedGeminiModelChain();
  if (modelChain.length === 0) {
    return {
      text: null,
      error: new Error(
        'No Gemini models are enabled for this site. An admin can turn models on under Admin → AI.'
      ),
    };
  }
  let lastError: unknown = null;
  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i]!;
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      const text = response.text?.trim() ?? null;
      return { text, error: null };
    } catch (err) {
      lastError = err;
      const tryNext = i < modelChain.length - 1 && isRetryableQuotaError(err);
      if (tryNext) {
        console.warn(`Gemini: ${model} unavailable (quota/rate limit), trying next model…`);
        continue;
      }
      return { text: null, error: err };
    }
  }
  return { text: null, error: lastError };
}
