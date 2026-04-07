/** Structured assistant turn: conversational text plus optional catalog course. */
export interface AssistantReply {
  reply: string;
  /** Present only when gently offering an i-Golden course. */
  recommendCourseId: string | null;
}

export function parseAssistantReplyJson(
  raw: string,
  allowedIds: Set<string>
): { ok: true; data: AssistantReply } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Could not parse response as JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid response shape.' };
  }

  const rec = parsed as Record<string, unknown>;
  const reply = rec.reply;
  const rid = rec.recommendCourseId;

  if (typeof reply !== 'string' || !reply.trim()) {
    return { ok: false, error: 'Response missing reply text.' };
  }

  if (rid === null || rid === undefined || rid === '') {
    return { ok: true, data: { reply: reply.trim(), recommendCourseId: null } };
  }

  if (typeof rid !== 'string') {
    return { ok: false, error: 'Invalid recommendCourseId.' };
  }

  if (!allowedIds.has(rid)) {
    return { ok: false, error: 'Suggested course is not in our catalog.' };
  }

  return { ok: true, data: { reply: reply.trim(), recommendCourseId: rid } };
}
