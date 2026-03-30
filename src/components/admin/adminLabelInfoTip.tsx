import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/** Matches Tailwind `sm` breakpoint (640px); tips use fixed + measured top below this width. */
export const TIPS_NARROW_MAX_PX = 639;

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
export function narrowAdminTipPanelStyle(topPx: number): React.CSSProperties {
  return {
    top: topPx,
    ['--admin-tip-top' as string]: `${topPx}px`,
  };
}

export type AdminLabelInfoTipProps = {
  /**
   * Only the info control + panel (no outer label row). Parent supplies a flex row with its own label/title.
   */
  controlOnly?: boolean;
  htmlFor?: string;
  /** Applied to the label or span wrapping `label` text. */
  labelClassName?: string;
  /** Ignored when `controlOnly` */
  label?: React.ReactNode;
  tipId: string;
  tipRegionAriaLabel: string;
  /** Short phrase for aria-label, e.g. "Default auto-advance" */
  tipSubject: string;
  children: React.ReactNode;
};

/**
 * Field label + inline info tip (admin). See docs/patterns-admin-label-info-tip.md.
 */
export function AdminLabelInfoTip({
  controlOnly = false,
  htmlFor,
  labelClassName,
  label,
  tipId,
  tipRegionAriaLabel,
  tipSubject,
  children,
}: AdminLabelInfoTipProps) {
  const tipsNarrowViewport = useTipsNarrowViewport();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fixedTop, setFixedTop] = useState(-1);

  const syncTop = useCallback(() => {
    if (!tipsNarrowViewport || !open || !btnRef.current) return;
    setFixedTop(readFixedTipTopBelowAnchor(btnRef.current));
  }, [tipsNarrowViewport, open]);

  useLayoutEffect(() => {
    if (!open) {
      setFixedTop(-1);
      return;
    }
    if (!tipsNarrowViewport || !btnRef.current) {
      setFixedTop(-1);
      return;
    }
    setFixedTop(readFixedTipTopBelowAnchor(btnRef.current));
  }, [open, tipsNarrowViewport]);

  useEffect(() => {
    if (!tipsNarrowViewport) setFixedTop(-1);
  }, [tipsNarrowViewport]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (wrapRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !tipsNarrowViewport || fixedTop < 0) return;
    const onScroll = () => syncTop();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', syncTop);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', syncTop);
    };
  }, [open, tipsNarrowViewport, fixedTop, syncTop]);

  const defaultLabelClass = 'text-xs font-semibold leading-none text-[var(--text-secondary)]';
  const lc = labelClassName ?? defaultLabelClass;

  const ariaOpen = `Open ${tipSubject} tips`;
  const ariaClose = `Close ${tipSubject} tips`;

  const panel = (
    <div
      id={tipId}
      role="region"
      aria-label={tipRegionAriaLabel}
      tabIndex={open && tipsNarrowViewport && fixedTop >= 0 ? -1 : undefined}
      onPointerDown={
        open && tipsNarrowViewport && fixedTop >= 0
          ? (e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })
          : undefined
      }
      className={
        !open
          ? 'hidden'
          : tipsNarrowViewport
            ? fixedTop >= 0
              ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40'
              : 'hidden'
            : 'absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
      }
      style={open && tipsNarrowViewport && fixedTop >= 0 ? narrowAdminTipPanelStyle(fixedTop) : undefined}
    >
      <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-orange-500/70 sm:space-y-1">
        {children}
      </ul>
    </div>
  );

  const control = (
    <span ref={wrapRef} className="relative inline-flex shrink-0 items-center gap-1">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={tipId}
        aria-label={open ? ariaClose : ariaOpen}
        className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 active:opacity-90 ${
          open ? 'border-orange-500/50 text-orange-500' : ''
        }`}
      >
        <Info size={14} className="text-orange-500/90" aria-hidden />
      </button>
      {panel}
    </span>
  );

  if (controlOnly) {
    return control;
  }

  return (
    <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={lc}>
          {label}
        </label>
      ) : (
        <span className={lc}>{label}</span>
      )}
      {control}
    </div>
  );
}
