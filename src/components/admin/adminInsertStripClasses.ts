/**
 * Shared “add row” gutter + full-width chip for catalog (modules/lessons) and path branch outline inserts.
 * md+: collapsed strip expands in layout (hover/focus-within max-height), not absolute overlay.
 */

/** Keep in sync with `delay-[250ms]` on chip opacity / max-height below. */
export const ADMIN_INSERT_STRIP_REVEAL_DELAY_MS = 250;

export const ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER =
  'max-md:overflow-visible max-md:py-0 md:overflow-hidden md:py-0 md:transition-[max-height] md:duration-200 md:ease-out md:delay-0 md:max-h-3 md:hover:max-h-[4.25rem] md:hover:delay-[250ms] md:focus-within:max-h-[4.25rem] md:focus-within:delay-[250ms]';

export const ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST =
  'cursor-pointer flex w-full min-w-0 max-w-full min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/25 px-4 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] opacity-90 transition-[background-color,border-color,color,opacity] duration-150 ease-out hover:border-orange-500/50 hover:bg-orange-500/15 hover:text-orange-600 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:hover:bg-orange-500/20 dark:hover:text-orange-300 sm:px-6';

/** md+: chip invisible until gutter opens (parent `group/ins`); 250ms hover delay before fade-in. */
export const ADMIN_INSERT_STRIP_CHIP_BTN_EXPAND_ROW = `${ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST} md:opacity-0 md:pointer-events-none md:transition-opacity md:duration-200 md:delay-0 md:group-hover/ins:pointer-events-auto md:group-hover/ins:opacity-100 md:group-hover/ins:delay-[250ms] md:group-focus-within/ins:pointer-events-auto md:group-focus-within/ins:opacity-100 md:group-focus-within/ins:delay-[250ms]`;

/** Half-width style for two chips on one row (catalog: add branch + add module at module boundary). */
export const ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST_PAIR =
  'cursor-pointer flex min-h-11 min-w-0 w-full max-w-full flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/25 px-2 py-1.5 text-[10px] font-semibold leading-tight text-[var(--text-muted)] opacity-90 transition-[background-color,border-color,color,opacity] duration-150 ease-out hover:border-orange-500/50 hover:bg-orange-500/15 hover:text-orange-600 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:hover:bg-orange-500/20 dark:hover:text-orange-300 sm:px-3 sm:text-[11px] sm:leading-snug';

export const ADMIN_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR = `${ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST_PAIR} md:opacity-0 md:pointer-events-none md:transition-opacity md:duration-200 md:delay-0 md:group-hover/ins:pointer-events-auto md:group-hover/ins:opacity-100 md:group-hover/ins:delay-[250ms] md:group-focus-within/ins:pointer-events-auto md:group-focus-within/ins:opacity-100 md:group-focus-within/ins:delay-[250ms]`;

/**
 * Learning-path outline inserts: own named group so chips never match catalog `group/ins` (paths stay mounted under
 * Catalog with `hidden` while other tabs are open).
 */
export const PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW = `${ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST} md:opacity-0 md:pointer-events-none md:transition-opacity md:duration-200 md:delay-0 md:group-hover/pathStrip:pointer-events-auto md:group-hover/pathStrip:opacity-100 md:group-hover/pathStrip:delay-[250ms] md:group-focus-within/pathStrip:pointer-events-auto md:group-focus-within/pathStrip:opacity-100 md:group-focus-within/pathStrip:delay-[250ms]`;

/** Path outline top-level gutter: two chips (section vs full kind picker) share one hover strip; uses `group/pathStrip` not `group/ins`. */
export const PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR = `${ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST_PAIR} md:opacity-0 md:pointer-events-none md:transition-opacity md:duration-200 md:delay-0 md:group-hover/pathStrip:pointer-events-auto md:group-hover/pathStrip:opacity-100 md:group-hover/pathStrip:delay-[250ms] md:group-focus-within/pathStrip:pointer-events-auto md:group-focus-within/pathStrip:opacity-100 md:group-focus-within/pathStrip:delay-[250ms]`;
