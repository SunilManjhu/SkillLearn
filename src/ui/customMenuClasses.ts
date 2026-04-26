/**
 * Dense custom menus: portaled listboxes, in-page scroll lists, path-builder pick rows,
 * navbar shell dropdowns. Single source of truth — update with `docs/custom-dropdown-menus.md`.
 *
 * @see docs/custom-dropdown-menus.md
 */

/** Single-line label: tight line box, no extra vertical slack from leading. */
export const MENU_ROW_TEXT = 'text-left text-sm leading-none';

/** Horizontal inset for admin listbox rows (Course picker, etc.). */
export const MENU_LISTBOX_PAD_X = 'px-2 sm:px-2.5';

/** Horizontal inset for shell nav dropdowns (paths, skills) with icons or wider tap area. */
export const MENU_SHELL_PAD_X = 'px-3';

/** Horizontal inset for account menu rows (icons + label). */
export const MENU_SHELL_PAD_X_WIDE = 'px-4';

/** Vertical padding for one dense row (~36–40px total with text-sm). */
export const MENU_ROW_PAD_Y = 'py-1.5';

/** Scrollable listbox panel (theme vars, admin primary surface). */
export const CUSTOM_LISTBOX_PANEL =
  'box-border overflow-y-auto overscroll-y-contain rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-0 shadow-xl [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]';

/** Single-line listbox option (Course catalog picker). */
export const CUSTOM_LISTBOX_OPTION_SINGLE = `flex w-full touch-manipulation items-center ${MENU_LISTBOX_PAD_X} ${MENU_ROW_PAD_Y} ${MENU_ROW_TEXT} hover:bg-[var(--hover-bg)]`;

/** Two-line listbox option (e.g. creator inventory: title + subtitle). */
export const CUSTOM_LISTBOX_OPTION_TWO_LINE = `flex w-full touch-manipulation flex-col items-start gap-0.5 ${MENU_LISTBOX_PAD_X} ${MENU_ROW_PAD_Y} ${MENU_ROW_TEXT} hover:bg-[var(--hover-bg)]`;

/** Portaled admin listbox trigger layout (add `border-[var(--border-color)]` or invalid border + optional surface). */
export const ADMIN_LISTBOX_TRIGGER_BODY =
  'box-border flex min-h-11 w-full min-w-0 touch-manipulation items-center justify-between gap-2 rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-left text-base text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#a1a2a2]/45 md:text-sm';

/** Default trigger: primary surface + theme border. */
export const ADMIN_LISTBOX_TRIGGER = `${ADMIN_LISTBOX_TRIGGER_BODY} border-[var(--border-color)]`;

/** Empty / loading row inside a listbox panel. */
export const CUSTOM_LISTBOX_LOADING = `${MENU_LISTBOX_PAD_X} ${MENU_ROW_PAD_Y} text-sm leading-tight text-[var(--text-muted)]`;

/**
 * In-page bordered scroll list (no shadow). Append `max-h-*`, scrollbar utilities, or `bg-…/50` as needed.
 * Used for creator inventory tables, taxonomy confirm lists, etc.
 */
export const ADMIN_EMBEDDED_SCROLL_LIST =
  'box-border overflow-y-auto overflow-x-hidden overscroll-y-contain rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-0 text-sm [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]';

/** Path builder “place duplicate” folder drill: muted surface + row dividers. */
export const ADMIN_EMBEDDED_SCROLL_LIST_DIVIDED =
  'min-h-0 min-w-0 flex-1 divide-y divide-[var(--border-color)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/25 py-0 text-sm [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]';

/** Path branch modal: single-line course row (title + id). */
export const PATH_MODAL_LIST_ROW_COURSE = `${CUSTOM_LISTBOX_OPTION_SINGLE} gap-2 rounded-lg border border-transparent`;

/** Path branch modal: two-line module / lesson pick row. */
export const PATH_MODAL_LIST_ROW_TWO_LINE = `${CUSTOM_LISTBOX_OPTION_TWO_LINE} rounded-lg border border-transparent`;

/** Navbar “Learning Paths” / “Skills” dropdown container. */
export const SHELL_DROPDOWN_PANEL =
  'absolute left-0 top-full z-50 w-56 rounded-b-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-xl';

/** Path row: anchor styled as menu row. */
export const SHELL_DROPDOWN_PATH_LINK = `block w-full cursor-pointer ${MENU_SHELL_PAD_X} ${MENU_ROW_PAD_Y} ${MENU_ROW_TEXT} no-underline transition-colors focus:outline-none`;

/** Skills toggle row. */
export const SHELL_DROPDOWN_SKILLS_BUTTON = `w-full ${MENU_SHELL_PAD_X} ${MENU_ROW_PAD_Y} ${MENU_ROW_TEXT} transition-colors focus:outline-none`;

/** Account menu items (profile / creator / admin / logout). */
export const SHELL_PROFILE_MENUITEM = `flex w-full items-center gap-3 ${MENU_SHELL_PAD_X_WIDE} ${MENU_ROW_PAD_Y} text-left text-sm leading-tight transition-colors`;

/**
 * Course player overlay listbox rows (speed, etc.): spacing only — keep local colors
 * (`text-white`, `hover:bg-white/[0.06]`, …) in the component.
 */
export const OVERLAY_LISTBOX_OPTION_ROW =
  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left leading-none tabular-nums transition-colors';
