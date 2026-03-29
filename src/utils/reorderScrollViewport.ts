/**
 * Shared helpers for list reorder UX: after React commits a new order, keep the same ↑/↓ control
 * at the same viewport Y (stationary mouse) using window scroll, then focus without scrolling again.
 *
 * Use with: measure `getBoundingClientRect().top` on the clicked control before `flushSync`/`setState`,
 * then in `useLayoutEffect` find the row and call {@link applyReorderViewportScrollAndFocus}.
 *
 * **Human/AI guide:** `docs/admin-reorder-scroll-viewport.md` (Strict Mode, scroll sign, consumers, checklist).
 */

export type ReorderControlRole = 'up' | 'down';

export type ReorderButtonSelectors = { up: string; down: string };

/** `data-*-reorder="up"|"down"` pairs used across admin editors. */
export const REORDER_DATA_ATTR_SELECTORS = {
  module: {
    up: 'button[data-module-reorder="up"]',
    down: 'button[data-module-reorder="down"]',
  },
  lesson: {
    up: 'button[data-lesson-reorder="up"]',
    down: 'button[data-lesson-reorder="down"]',
  },
  branch: {
    up: 'button[data-branch-reorder="up"]',
    down: 'button[data-branch-reorder="down"]',
  },
  gemini: {
    up: 'button[data-gemini-reorder="up"]',
    down: 'button[data-gemini-reorder="down"]',
  },
} as const;

/**
 * After reorder reflow, the control’s `getBoundingClientRect().top` changes. Adjust window scroll so
 * it returns to `viewportTopBeforeReorder`. Uses negative `scrollBy` delta (same convention as
 * `window.scrollBy`: positive scroll moves document down and lowers element tops).
 */
export function scrollWindowToKeepReorderControlViewportY(
  anchor: HTMLElement,
  viewportTopBeforeReorder: number
): void {
  const afterTop = anchor.getBoundingClientRect().top;
  const delta = viewportTopBeforeReorder - afterTop;
  if (Math.abs(delta) < 1) return;
  window.scrollBy({ top: -delta, left: 0, behavior: 'auto' });
}

/** Escape a string for use inside `[attr="…"]` selectors. Uses `globalThis.CSS` to avoid clashing with imports named `CSS`. */
export function escapeSelectorAttrValue(value: string): string {
  if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(value);
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function queryElementInScopeOrDocument(
  scopeRoot: HTMLElement | null | undefined,
  selector: string
): HTMLElement | null {
  return scopeRoot?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
}

export type ReorderScrollFocusJob = { beforeTop: number; control: ReorderControlRole };

/**
 * Find ↑/↓ inside `row`, restore viewport Y for the chosen control, then focus (prefer the role
 * the user clicked; fall back to enabled sibling or row).
 */
export function applyReorderViewportScrollAndFocus(
  row: HTMLElement | null,
  job: ReorderScrollFocusJob,
  selectors: ReorderButtonSelectors
): void {
  if (!row) return;
  const up = row.querySelector<HTMLButtonElement>(selectors.up);
  const down = row.querySelector<HTMLButtonElement>(selectors.down);
  const preferred = job.control === 'up' ? up : down;
  const alignTarget = preferred ?? up ?? down ?? row;
  scrollWindowToKeepReorderControlViewportY(alignTarget, job.beforeTop);
  if (preferred && !preferred.disabled) {
    preferred.focus({ preventScroll: true });
  } else if (up && !up.disabled) {
    up.focus({ preventScroll: true });
  } else if (down && !down.disabled) {
    down.focus({ preventScroll: true });
  }
}
