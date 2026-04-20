import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const WIDE_TIP_MAX_WIDTH_PX = 22 * 16; // 22rem
const TIP_VIEWPORT_EDGE_PX = 12;
const TIP_ANCHOR_GAP_PX = 8;

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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fixedTop, setFixedTop] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const [wideLayout, setWideLayout] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const syncTop = useCallback(() => {
    if (!tipsNarrowViewport || !open || !btnRef.current) return;
    setFixedTop(readFixedTipTopBelowAnchor(btnRef.current));
  }, [tipsNarrowViewport, open]);

  const syncWideLayout = useCallback(() => {
    if (!open || tipsNarrowViewport || !btnRef.current) {
      setWideLayout(null);
      return;
    }
    const rect = btnRef.current.getBoundingClientRect();
    const width = Math.min(WIDE_TIP_MAX_WIDTH_PX, window.innerWidth - 2 * TIP_VIEWPORT_EDGE_PX);
    let left = rect.left;
    left = Math.min(left, window.innerWidth - TIP_VIEWPORT_EDGE_PX - width);
    left = Math.max(TIP_VIEWPORT_EDGE_PX, left);
    const top = rect.bottom + TIP_ANCHOR_GAP_PX;
    setWideLayout({ top, left, width });
  }, [open, tipsNarrowViewport]);

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

  useLayoutEffect(() => {
    if (!open) {
      setWideLayout(null);
      return;
    }
    if (tipsNarrowViewport) {
      setWideLayout(null);
      return;
    }
    syncWideLayout();
  }, [open, tipsNarrowViewport, syncWideLayout]);

  useEffect(() => {
    if (!tipsNarrowViewport) setFixedTop(-1);
  }, [tipsNarrowViewport]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
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

  useEffect(() => {
    if (!open || tipsNarrowViewport) return;
    const onScroll = () => syncWideLayout();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', syncWideLayout);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', syncWideLayout);
    };
  }, [open, tipsNarrowViewport, syncWideLayout]);

  const defaultLabelClass = 'text-xs font-semibold leading-none text-[var(--text-secondary)]';
  const lc = labelClassName ?? defaultLabelClass;

  const ariaOpen = `Open ${tipSubject} tips`;
  const ariaClose = `Close ${tipSubject} tips`;

  const showNarrowPanel = open && tipsNarrowViewport && fixedTop >= 0;
  const showWidePanel = open && !tipsNarrowViewport && wideLayout !== null;
  const portaledPanelFocusable = showNarrowPanel || showWidePanel;

  const portaledPanel =
    showNarrowPanel || showWidePanel ? (
      <div
        ref={panelRef}
        id={tipId}
        role="region"
        aria-label={tipRegionAriaLabel}
        tabIndex={portaledPanelFocusable ? -1 : undefined}
        onPointerDown={
          portaledPanelFocusable
            ? (e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })
            : undefined
        }
        className={
          showNarrowPanel
            ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/50 app-dark:border-[var(--tone-500)] app-dark:bg-[var(--tone-800)] app-dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)] app-dark:ring-1 app-dark:ring-[#e7e7e7]/15'
            : 'fixed z-[120] overflow-y-auto overflow-x-hidden overscroll-y-contain rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/50 max-h-[min(20rem,calc(100dvh-var(--admin-tip-wide-top)-env(safe-area-inset-bottom,0px)-0.75rem))] app-dark:border-[var(--tone-500)] app-dark:bg-[var(--tone-800)] app-dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)] app-dark:ring-1 app-dark:ring-[#e7e7e7]/15'
        }
        style={
          showNarrowPanel
            ? narrowAdminTipPanelStyle(fixedTop)
            : wideLayout
              ? {
                  top: wideLayout.top,
                  left: wideLayout.left,
                  width: wideLayout.width,
                  ['--admin-tip-wide-top' as string]: `${wideLayout.top}px`,
                }
              : undefined
        }
      >
        <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-secondary)] marker:text-[var(--text-primary)] sm:space-y-1 app-dark:text-[var(--tone-100)] app-dark:marker:text-[var(--tone-200)]">
          {children}
        </ul>
      </div>
    ) : null;

  const control = (
    <>
      <span ref={wrapRef} className="relative inline-flex shrink-0 items-center gap-1">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={tipId}
          aria-label={open ? ariaClose : ariaOpen}
          className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/50 active:opacity-90 app-dark:border-[var(--tone-500)] app-dark:bg-[var(--tone-800)] app-dark:text-[var(--tone-100)] app-dark:hover:bg-[var(--tone-700)] ${
            open ? 'border-[#8b8c8c] text-[#393a3a] app-dark:border-[#cfcfcf] app-dark:text-[#e7e7e7]' : ''
          }`}
        >
          <Info size={14} className="opacity-90 app-dark:opacity-100" aria-hidden />
        </button>
      </span>
      {mounted && portaledPanel ? createPortal(portaledPanel, document.body) : null}
    </>
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
