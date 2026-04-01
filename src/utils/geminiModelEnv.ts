/** Build-time env (Vite `define`) — primary Gemini model id. */
export function getGeminiModelPrimary(): string {
  const m = process.env.GEMINI_MODEL;
  return typeof m === 'string' && m.trim().length > 0 ? m.trim() : 'gemini-2.5-flash';
}

/**
 * Ordered chain from env: primary first, then comma-separated GEMINI_MODEL_FALLBACK (deduped).
 * Used when Firestore has no admin-configured list.
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
  return out;
}

export function getGeminiApiKey(): string | undefined {
  const k = process.env.GEMINI_API_KEY;
  return typeof k === 'string' && k.trim().length > 0 ? k.trim() : undefined;
}
