/** Default second model when `GEMINI_MODEL_FALLBACK` is unset — used for automatic quota / rate-limit failover. */
export const DEFAULT_GEMINI_QUOTA_FALLBACK_MODEL = 'gemini-2.5-flash-lite';

/** Build-time env (Vite `define`) — primary Gemini model id. */
export function getGeminiModelPrimary(): string {
  const m = process.env.GEMINI_MODEL;
  return typeof m === 'string' && m.trim().length > 0 ? m.trim() : 'gemini-2.5-flash';
}

/**
 * Ordered chain from env: primary first, then comma-separated GEMINI_MODEL_FALLBACK (deduped).
 * Used when Firestore has no admin-configured list.
 * If no explicit fallbacks are set, appends {@link DEFAULT_GEMINI_QUOTA_FALLBACK_MODEL} when not already present
 * so `generateContentWithModelChain` can try another model on 429 / quota errors.
 */
export function getGeminiModelChain(): string[] {
  const primary = getGeminiModelPrimary();
  const raw = process.env.GEMINI_MODEL_FALLBACK;
  const rest =
    typeof raw === 'string' && raw.trim().length > 0
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [primary, ...rest]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  if (rest.length === 0 && !seen.has(DEFAULT_GEMINI_QUOTA_FALLBACK_MODEL)) {
    seen.add(DEFAULT_GEMINI_QUOTA_FALLBACK_MODEL);
    out.push(DEFAULT_GEMINI_QUOTA_FALLBACK_MODEL);
  }
  return out;
}

export function getGeminiApiKey(): string | undefined {
  const k = process.env.GEMINI_API_KEY;
  return typeof k === 'string' && k.trim().length > 0 ? k.trim() : undefined;
}
