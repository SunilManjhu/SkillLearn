import type { CSSProperties } from 'react';

/** Above path/catalog modals that use `z-[200]` so portaled menus stay on top. */
export const ADMIN_LISTBOX_PANEL_Z = 280;

const VIEW_MARGIN = 8;
const GAP = 4;
/** Prefer below; flip above only when below is tight and above is clearly roomier. */
const MIN_SPACE_TO_PREFER_BELOW = 80;

export type AdminListboxPanelLayoutOpts = {
  /** Minimum panel width in px; default `280` (course lists). Use `0` to match trigger width (compact enums). */
  minPanelWidth?: number;
};

/** Fixed-position panel under (or above) a trigger; used by portaled admin listboxes. */
export function computeAdminListboxPanelStyle(
  trigger: DOMRect,
  opts?: AdminListboxPanelLayoutOpts
): CSSProperties {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const spaceBelow = vh - trigger.bottom - VIEW_MARGIN;
  const spaceAbove = trigger.top - VIEW_MARGIN;
  const openBelow =
    spaceBelow >= MIN_SPACE_TO_PREFER_BELOW ||
    (spaceBelow < MIN_SPACE_TO_PREFER_BELOW && spaceBelow >= spaceAbove);

  const minPanel = opts?.minPanelWidth ?? 280;
  const width = Math.min(Math.max(trigger.width, minPanel), vw - VIEW_MARGIN * 2);
  let left = trigger.left;
  left = Math.max(VIEW_MARGIN, Math.min(left, vw - width - VIEW_MARGIN));

  if (openBelow) {
    const top = trigger.bottom + GAP;
    const maxHeight = Math.max(120, vh - top - VIEW_MARGIN);
    return {
      position: 'fixed',
      left,
      top,
      width,
      maxHeight,
      zIndex: ADMIN_LISTBOX_PANEL_Z,
    };
  }

  const maxHeight = Math.max(120, spaceAbove - GAP);
  const bottom = vh - trigger.top + GAP;
  return {
    position: 'fixed',
    left,
    bottom,
    width,
    maxHeight,
    zIndex: ADMIN_LISTBOX_PANEL_Z,
  };
}
