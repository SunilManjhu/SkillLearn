/**
 * Firestore / JSON sometimes stores indices as strings. Normalize for MCQ comparison.
 */
export function coerceQuizIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export function mcqIndicesMatch(chosen: unknown, correct: unknown): boolean {
  const c = coerceQuizIndex(chosen);
  const r = coerceQuizIndex(correct);
  return c !== null && r !== null && c === r;
}

/** Parse model score whether the API returns number or string. */
export function coerceScore0to100(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = parseFloat(t);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  return null;
}
