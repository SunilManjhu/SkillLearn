import { useEffect } from 'react';

/**
 * Locks document scroll while overlays/modals are open. Reference-counted so nested
 * overlays (e.g. Completed Courses on Profile) do not unlock the body early.
 */
let lockDepth = 0;
let frozen: {
  htmlOverflow: string;
  bodyOverflow: string;
  htmlOverscroll: string;
  bodyOverscroll: string;
} | null = null;

function acquire() {
  if (lockDepth === 0) {
    const html = document.documentElement;
    const body = document.body;
    frozen = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
  }
  lockDepth += 1;
}

function release() {
  lockDepth = Math.max(0, lockDepth - 1);
  if (lockDepth === 0 && frozen) {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = frozen.htmlOverflow;
    body.style.overflow = frozen.bodyOverflow;
    html.style.overscrollBehavior = frozen.htmlOverscroll;
    body.style.overscrollBehavior = frozen.bodyOverscroll;
    frozen = null;
  }
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquire();
    return () => release();
  }, [active]);
}
