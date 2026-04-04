import { GoogleGenAI, type GroundingMetadata, type UrlContextMetadata } from '@google/genai';
import { isRetryableQuotaError, type FormatGenaiErrorContext } from './formatGenaiError';
import { getResolvedGeminiModelChainWithSource, type GeminiModelChainSource } from './geminiModelSettingsFirestore';

export { getGeminiApiKey, getGeminiModelPrimary, getGeminiModelChain } from './geminiModelEnv';

type GenConfig = Parameters<GoogleGenAI['models']['generateContent']>[0]['config'];

export type GenerateContentWithModelChainResult = {
  text: string | null;
  error: unknown | null;
  /** Model id that returned `text` when `error` is null. */
  modelUsed: string | null;
  chainSource?: GeminiModelChainSource;
  /** Chain used for this request (for quota error copy). */
  modelChain?: string[];
  /** Last model attempted when `error` is set. */
  lastAttemptedModel?: string | null;
  groundingMetadata?: GroundingMetadata;
  urlContextMetadata?: UrlContextMetadata;
};

/** Pass into `formatGenaiError` when `generateContentWithModelChain` returns an error. */
export function formatContextForGenaiError(
  res: Pick<GenerateContentWithModelChainResult, 'lastAttemptedModel' | 'modelChain' | 'chainSource'>
): FormatGenaiErrorContext {
  return {
    lastTriedModel: res.lastAttemptedModel ?? undefined,
    modelChain: res.modelChain,
    chainSource: res.chainSource,
  };
}

/**
 * Runs `generateContent` with the first model in the chain that succeeds.
 * Model order: Admin → Smart Hub → Gemini model chain (Firestore) when configured, else build-time env
 * (`GEMINI_MODEL` + `GEMINI_MODEL_FALLBACK` + default lite). Quota failover walks that list in order only.
 */
export async function generateContentWithModelChain(
  apiKey: string,
  contents: string,
  config: GenConfig
): Promise<GenerateContentWithModelChainResult> {
  const ai = new GoogleGenAI({ apiKey });
  const { chain: modelChain, source: chainSource } = await getResolvedGeminiModelChainWithSource();
  if (modelChain.length === 0) {
    return {
      text: null,
      error: new Error(
        'No Gemini models are enabled for this site. An admin can turn models on under Admin → Smart Hub → Gemini model chain.'
      ),
      modelUsed: null,
      chainSource,
      modelChain: [],
    };
  }
  let lastError: unknown = null;
  let lastAttemptedModel: string | null = null;
  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i]!;
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      const text = response.text?.trim() ?? null;
      const cand = response.candidates?.[0];
      return {
        text,
        error: null,
        modelUsed: model,
        chainSource,
        modelChain: [...modelChain],
        groundingMetadata: cand?.groundingMetadata,
        urlContextMetadata: cand?.urlContextMetadata,
      };
    } catch (err) {
      lastError = err;
      lastAttemptedModel = model;
      const tryNext = i < modelChain.length - 1 && isRetryableQuotaError(err);
      if (tryNext) {
        console.warn(`Gemini: ${model} unavailable (quota/rate limit), trying next model…`);
        continue;
      }
      return {
        text: null,
        error: err,
        modelUsed: null,
        chainSource,
        modelChain: [...modelChain],
        lastAttemptedModel: model,
      };
    }
  }
  return {
    text: null,
    error: lastError,
    modelUsed: null,
    chainSource,
    modelChain: [...modelChain],
    lastAttemptedModel: lastAttemptedModel ?? modelChain[modelChain.length - 1] ?? null,
  };
}
