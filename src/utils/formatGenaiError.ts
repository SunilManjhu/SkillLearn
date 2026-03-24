/** True when retrying with another model may help (rate limit / quota). */
export function isRetryableQuotaError(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return (
    lower.includes('resource_exhausted') ||
    lower.includes('"code":429') ||
    lower.includes(' 429') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  );
}

/** Turn Gemini / SDK errors into short UI copy; avoids dumping raw JSON. */
export function formatGenaiError(error: unknown): string {
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
    return 'Gemini rate limit or quota reached. Wait and retry, or set GEMINI_MODEL to another model (e.g. gemini-2.5-flash-lite). See https://ai.google.dev/gemini-api/docs/rate-limits';
  }

  if (raw.length > 280 && (raw.startsWith('{') || raw.includes('"error"'))) {
    return 'Request failed. Check the browser console for details.';
  }

  return raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
}
