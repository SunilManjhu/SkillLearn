import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/** Matches Tailwind `sm` breakpoint (640px); tips use fixed + measured top below this width. */
const TIPS_NARROW_MAX_PX = 639;

export function useTipsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= TIPS_NARROW_MAX_PX : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${TIPS_NARROW_MAX_PX}px)`);
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return narrow;
}

/** Fixed-position `top` (viewport px): strictly below the anchor — never overlaps the tab/button. */
export function readFixedTipTopBelowAnchor(anchorEl: HTMLElement, gapPx = 8): number {
  return anchorEl.getBoundingClientRect().bottom + gapPx;
}

/** Narrow-only: `top` + CSS var for `max-h` so the panel shrink-wraps content up to remaining viewport. */
export function narrowAdminTipPanelStyle(topPx: number): CSSProperties {
  return {
    top: topPx,
    ['--admin-tip-top' as string]: `${topPx}px`,
  };
}
