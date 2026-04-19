import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';

/** Inline-ish HTML for module/lesson titles, lesson about, course description — no links/scripts. */
const PURIFY: Config = {
  USE_PROFILES: { html: true },
  ADD_TAGS: ['sub', 'sup'],
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sanitizeCatalogMiniRichHtml(html: string): string {
  return DOMPurify.sanitize(html?.trim() ? html : '', PURIFY);
}

/** Plain text for duplicate checks, search, aria-labels. */
export function catalogMiniRichPlainText(raw: string): string {
  const t = raw?.trim() ?? '';
  if (!t) return '';
  if (typeof document === 'undefined') {
    return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const el = document.createElement('div');
  el.innerHTML = sanitizeCatalogMiniRichHtml(catalogMiniRichEnsureWrapped(t));
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function catalogMiniRichIsEffectivelyEmpty(raw: string): boolean {
  return catalogMiniRichPlainText(raw).length === 0;
}

/** Wrap legacy plain strings as a single paragraph for the editor / display. */
export function catalogMiniRichEnsureWrapped(raw: string): string {
  const t = raw?.trim() ?? '';
  if (!t) return '';
  if (!/<[a-z]/i.test(t)) {
    return `<p>${escapeHtml(t)}</p>`;
  }
  return t;
}

/** Initial HTML for TipTap from stored value (plain or HTML). */
export function catalogMiniRichEditorContent(raw: string): string {
  const t = raw?.trim() ?? '';
  if (!t) return '<p></p>';
  return sanitizeCatalogMiniRichHtml(catalogMiniRichEnsureWrapped(t));
}

/** Safe fragment for learner/admin read-only HTML (always sanitize). */
export function catalogMiniRichDisplayHtml(raw: string): string {
  const t = raw?.trim() ?? '';
  if (!t) return '';
  return sanitizeCatalogMiniRichHtml(catalogMiniRichEnsureWrapped(t));
}

/** Strip to empty string when editor has no visible text. */
export function normalizeCatalogMiniRichForSave(html: string): string {
  const s = sanitizeCatalogMiniRichHtml(html);
  if (!s.trim()) return '';
  return catalogMiniRichIsEffectivelyEmpty(s) ? '' : s;
}

/** Focus the TipTap surface inside a `CatalogMiniRichEditor` wrapper (`id` on the outer div). */
export function focusCatalogMiniRichById(elementId: string, options?: FocusOptions): void {
  const wrap = document.getElementById(elementId);
  const pm = wrap?.querySelector('.ProseMirror');
  if (pm instanceof HTMLElement) {
    pm.focus(options);
    return;
  }
  if (wrap instanceof HTMLElement) wrap.focus(options);
}
