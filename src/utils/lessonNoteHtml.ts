import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';
import { marked } from 'marked';

/** Keep divider marker on `<hr>` after save/load (`data-divider-style` is always thick). */
const PURIFY: Config = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['data-divider-style'],
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * True when saved HTML has no visible text (empty editor, only breaks, etc.).
 */
export function isLessonNoteContentEmpty(html: string): boolean {
  if (!html?.trim()) return true;
  if (/<hr\b/i.test(html)) return false;
  const stripped = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length === 0;
}

/** First visible line as plain text for the collapsed notes strip. */
export function plainFirstLineFromHtml(html: string, maxLen: number): string {
  if (!html?.trim()) return '';
  if (typeof document !== 'undefined') {
    const el = document.createElement('div');
    el.innerHTML = DOMPurify.sanitize(html, PURIFY);
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1))}…` : text;
  }
  const stripped = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return '';
  return stripped.length > maxLen ? `${stripped.slice(0, Math.max(0, maxLen - 1))}…` : stripped;
}

/**
 * Normalize editor output before save: empty-looking notes become "".
 */
export function normalizeLessonNoteHtmlForSave(html: string): string {
  return isLessonNoteContentEmpty(html) ? '' : html;
}

/** True if the string is clearly HTML from the rich editor (not only “starts with <”). */
function storedNotesLookLikeHtml(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^</.test(t)) return true;
  return /<\/?(?:p|ol|ul|li|div|h[1-6]|strong|em|u|span|br|hr)\b/i.test(s);
}

/**
 * Convert stored note to safe HTML for the rich editor: existing HTML is sanitized;
 * legacy Markdown is parsed; plain text becomes paragraphs / line breaks.
 */
export function migrateStoredNoteToHtml(raw: string): string {
  const t = raw.trim();
  if (!t) return '';

  if (storedNotesLookLikeHtml(raw)) {
    return DOMPurify.sanitize(raw, PURIFY);
  }

  const hasMdBulletLine = /^\s*[-*+](?:\s+\S|\s*)$/m.test(raw);
  if (/\*\*|__|\*[^*\n]+\*|^#{1,6}\s|^\s*\d+\.\s/m.test(raw) || hasMdBulletLine) {
    const html = marked.parse(raw, { async: false });
    if (typeof html !== 'string') {
      return `<p>${escapeHtml(raw)}</p>`;
    }
    return DOMPurify.sanitize(html, PURIFY);
  }

  const body = escapeHtml(raw).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
  return DOMPurify.sanitize(`<p>${body}</p>`, PURIFY);
}
