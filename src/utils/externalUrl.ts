/** Normalize admin/user input into a safe external href, or null if unusable. */
export function normalizeExternalHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return null;
  }
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(t)) {
    return `https://${t}`;
  }
  return null;
}
