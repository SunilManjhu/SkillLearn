/** Gemini URL context rejects requests when a single lookup includes more than ~20 URLs (model-included links count). */
export function isGeminiUrlContextUrlLimitError(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return (
    lower.includes('urls to lookup exceeds') ||
    (lower.includes('number of urls') &&
      lower.includes('exceeds') &&
      lower.includes('limit'))
  );
}

/** HTTP / SDK status on GenAI errors (e.g. ApiError from `@google/genai`). */
function errorHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const st = (error as { status?: unknown }).status;
  if (typeof st === 'number' && Number.isFinite(st)) return st;
  if (typeof st === 'string' && /^\d+$/.test(st)) return Number(st);
  return undefined;
}

/** Message + useful fields for substring matching (some errors hide 429 only in JSON). */
function errorTextForQuotaMatch(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error && error.message) parts.push(error.message);
  if (typeof error === 'string') parts.push(error);
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.status !== 'undefined') parts.push(String(o.status));
    if (typeof o.code !== 'undefined') parts.push(String(o.code));
    try {
      parts.push(JSON.stringify(error).slice(0, 2500));
    } catch {
      /* ignore */
    }
  }
  return parts.join(' ').toLowerCase();
}

/** True when retrying with another model may help (rate limit / quota). */
export function isRetryableQuotaError(error: unknown): boolean {
  const status = errorHttpStatus(error);
  if (status === 429) return true;

  const lower = errorTextForQuotaMatch(error);
  if (!lower) return false;
  return (
    lower.includes('resource_exhausted') ||
    lower.includes('resource exhausted') ||
    lower.includes('"code":429') ||
    lower.includes('"code": 429') ||
    lower.includes(' 429') ||
    lower.includes('"status":429') ||
    lower.includes('too many requests') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('quota exceeded') ||
    lower.includes('you exceeded') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('throttl')
  );
}

/** Optional context from `generateContentWithModelChain` for clearer quota / model copy. */
export type FormatGenaiErrorContext = {
  lastTriedModel?: string;
  modelChain?: string[];
  /** `firestore` = Smart Hub chain; `env` = GEMINI_MODEL / .env */
  chainSource?: 'firestore' | 'env';
};

/** Turn Gemini / SDK errors into short UI copy; avoids dumping raw JSON. */
export function formatGenaiError(error: unknown, ctx?: FormatGenaiErrorContext): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  if (!raw) {
    return 'Something went wrong. Try again.';
  }

  const lower = raw.toLowerCase();
  if (
    lower.includes('not_found') &&
    (lower.includes('"code":404') || lower.includes(' 404') || lower.includes('is not found'))
  ) {
    return 'That model name is not available for this API. Remove GEMINI_MODEL from .env to use the default (gemini-2.5-flash), or set a current id from https://ai.google.dev/gemini-api/docs/models';
  }

  if (isRetryableQuotaError(error)) {
    const last = ctx?.lastTriedModel?.trim();
    const chain = ctx?.modelChain?.filter(Boolean) ?? [];
    const chainLabel =
      ctx?.chainSource === 'firestore'
        ? 'Smart Hub Gemini model chain'
        : ctx?.chainSource === 'env'
          ? 'configured Gemini chain (.env: GEMINI_MODEL / GEMINI_MODEL_FALLBACK)'
          : 'Gemini model chain';
    if (chain.length > 1) {
      const lastPart = last ? ` Last tried: ${last}.` : '';
      return `All ${chain.length} enabled models in your ${chainLabel} hit rate limits or quota.${lastPart} Wait and retry or check quotas: https://ai.google.dev/gemini-api/docs/rate-limits`;
    }
    if (last) {
      return `Rate limit or quota on ${last}. Wait and retry, or add another model in Admin → Smart Hub → Gemini model chain (or set GEMINI_MODEL in .env). https://ai.google.dev/gemini-api/docs/rate-limits`;
    }
    return 'Gemini rate limit or quota reached. Wait and retry, or configure another model in Admin → Smart Hub → Gemini model chain. See https://ai.google.dev/gemini-api/docs/rate-limits';
  }

  if (raw.length > 280 && (raw.startsWith('{') || raw.includes('"error"'))) {
    return 'Request failed. Check the browser console for details.';
  }

  return raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
}
