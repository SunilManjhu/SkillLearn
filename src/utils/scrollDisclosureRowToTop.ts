export type ScrollDisclosureRowOptions = {
  behavior?: ScrollBehavior;
  /** Skip scroll when the row is already aligned within this many pixels of the container top. */
  epsilonPx?: number;
};

/**
 * Scroll so `element`'s top aligns with the top of `scrollContainer`'s visible area.
 * If `scrollContainer` is omitted or null, uses `scrollIntoView({ block: 'start' })` on the viewport.
 */
export function scrollDisclosureRowToTop(
  scrollContainer: HTMLElement | null | undefined,
  element: HTMLElement | null | undefined,
  options?: ScrollDisclosureRowOptions
): void {
  if (!element) return;
  const behavior = options?.behavior ?? 'smooth';
  const epsilon = options?.epsilonPx ?? 4;

  if (scrollContainer) {
    const delta = element.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
    if (Math.abs(delta) < epsilon) return;
    const nextTop = Math.max(0, scrollContainer.scrollTop + delta);
    scrollContainer.scrollTo({ top: nextTop, behavior });
    return;
  }

  element.scrollIntoView({ block: 'start', behavior });
}
