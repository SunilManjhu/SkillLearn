/**
 * Shared “add row” gutter + full-width chip for catalog (modules/lessons) and path branch outline inserts.
 * md+: collapsed strip expands in layout (hover/focus-within max-height), not absolute overlay.
 */

export const ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER =
  'max-md:overflow-visible max-md:py-0.5 md:overflow-hidden md:py-0 md:transition-[max-height] md:duration-200 md:ease-out md:max-h-3 md:hover:max-h-[4.25rem] md:focus-within:max-h-[4.25rem]';

export const ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST =
  'flex w-full min-w-0 max-w-full min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/25 px-4 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] opacity-90 transition-[background-color,border-color,color,opacity] duration-150 ease-out hover:border-orange-500/50 hover:bg-orange-500/15 hover:text-orange-600 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:hover:bg-orange-500/20 dark:hover:text-orange-300 sm:px-6';

/** md+: chip invisible until gutter opens (parent `group/ins`). */
export const ADMIN_INSERT_STRIP_CHIP_BTN_EXPAND_ROW = `${ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST} md:opacity-0 md:pointer-events-none md:transition-opacity md:duration-200 md:group-hover/ins:pointer-events-auto md:group-hover/ins:opacity-100 md:group-focus-within/ins:pointer-events-auto md:group-focus-within/ins:opacity-100`;
