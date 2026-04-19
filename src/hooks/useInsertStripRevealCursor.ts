import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { ADMIN_INSERT_STRIP_REVEAL_DELAY_MS } from '../components/admin/adminInsertStripClasses';

/**
 * md+ hover-reveal insert strips: hide the system wait cursor until the reveal delay elapses; pair with
 * {@link InsertStripWaitCursorPortal} for a custom rotating indicator.
 */
export function useInsertStripRevealCursor(delayHoverReveal: boolean) {
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const active = pointerInside || focusInside;
  const [revealComplete, setRevealComplete] = useState(false);
  const [clientPos, setClientPos] = useState<{ x: number; y: number } | null>(null);

  const waitingForRevealRef = useRef(false);
  waitingForRevealRef.current = Boolean(delayHoverReveal && active && !revealComplete);

  useEffect(() => {
    if (!delayHoverReveal) {
      setRevealComplete(true);
      return;
    }
    if (!active) {
      setRevealComplete(false);
      return;
    }
    setRevealComplete(false);
    const id = window.setTimeout(() => setRevealComplete(true), ADMIN_INSERT_STRIP_REVEAL_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [active, delayHoverReveal]);

  useEffect(() => {
    if (!active || revealComplete) setClientPos(null);
  }, [active, revealComplete]);

  const stripOuterCursorClass =
    delayHoverReveal && active && !revealComplete ? 'md:cursor-none' : '';

  const waitCursorOverlayOpen = Boolean(delayHoverReveal && active && !revealComplete);

  const onPointerEnter = useCallback((e: PointerEvent<HTMLElement>) => {
    setPointerInside(true);
    setClientPos({ x: e.clientX, y: e.clientY });
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!waitingForRevealRef.current) return;
    setClientPos({ x: e.clientX, y: e.clientY });
  }, []);

  const onPointerLeave = useCallback(() => {
    setPointerInside(false);
    setClientPos(null);
  }, []);

  const onFocusCapture = useCallback(() => setFocusInside(true), []);
  const onBlurCapture = useCallback((e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusInside(false);
  }, []);

  return {
    stripOuterCursorClass,
    waitCursorOverlayOpen,
    waitCursorClientX: clientPos?.x ?? null,
    waitCursorClientY: clientPos?.y ?? null,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onFocusCapture,
    onBlurCapture,
  };
}
