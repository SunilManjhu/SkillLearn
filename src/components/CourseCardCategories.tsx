import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

const CHIP_CLASS =
  'max-w-[min(100%,7rem)] shrink-0 truncate rounded bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-500';
const SUFFIX_CLASS = 'shrink-0 text-[9px] font-bold tabular-nums text-[var(--text-muted)]';

/** Tailwind `gap-1` → 4px at default root font size. */
const GAP_PX = 4;

function sumWidths(widths: number[], count: number, gapPx: number): number {
  if (count <= 0) return 0;
  let s = 0;
  for (let i = 0; i < count; i += 1) s += widths[i] ?? 0;
  return s + gapPx * Math.max(0, count - 1);
}

type CourseCardCategoriesProps = {
  categories: readonly string[];
};

/**
 * One row of category chips; shows as many as fit (ResizeObserver), then `+N` for the rest.
 */
export function CourseCardCategories({ categories }: CourseCardCategoriesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const suffixMeasureRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => Math.max(1, categories.length));

  const recompute = useCallback(() => {
    const list = [...categories];
    if (list.length === 0) {
      setVisible(0);
      return;
    }
    if (list.length === 1) {
      setVisible(1);
      return;
    }

    const measureEl = measureRef.current;
    const suffixEl = suffixMeasureRef.current;
    const containerEl = containerRef.current;
    if (!measureEl || !suffixEl || !containerEl) return;

    const avail = containerEl.clientWidth;
    if (avail <= 0) return;

    const chipEls = [...measureEl.querySelectorAll('[data-cat-chip]')] as HTMLElement[];
    if (chipEls.length !== list.length) return;

    const chipWidths = chipEls.map((el) => el.getBoundingClientRect().width);

    const suffixWidth = (hidden: number): number => {
      if (hidden <= 0) return 0;
      suffixEl.textContent = `+${hidden}`;
      return suffixEl.getBoundingClientRect().width;
    };

    const totalAll = sumWidths(chipWidths, list.length, GAP_PX);
    if (totalAll <= avail) {
      setVisible(list.length);
      return;
    }

    let best = 1;
    for (let k = list.length; k >= 1; k -= 1) {
      const hidden = list.length - k;
      const chipsW = sumWidths(chipWidths, k, GAP_PX);
      const sw = hidden > 0 ? suffixWidth(hidden) + GAP_PX : 0;
      if (chipsW + sw <= avail) {
        best = k;
        break;
      }
    }
    setVisible(best);
  }, [categories]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recompute]);

  if (categories.length === 0) {
    return (
      <span className="line-clamp-1 text-[10px] font-bold uppercase tracking-wider text-orange-500">
        Uncategorized
      </span>
    );
  }

  const fullLabel = categories.join(', ');
  const hiddenCount = Math.max(0, categories.length - visible);
  const showSuffix = hiddenCount > 0;

  return (
    <div className="relative min-h-[1.125rem] min-w-0">
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute inset-x-0 top-0 z-0 flex max-w-full flex-nowrap gap-1"
        aria-hidden
      >
        {categories.map((cat) => (
          <span key={cat} data-cat-chip className={CHIP_CLASS}>
            {cat}
          </span>
        ))}
        <span ref={suffixMeasureRef} data-cat-suffix className={SUFFIX_CLASS}>
          +0
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative z-[1] flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
        title={fullLabel}
      >
        {categories.slice(0, visible).map((cat) => (
          <span key={cat} className={CHIP_CLASS}>
            {cat}
          </span>
        ))}
        {showSuffix ? <span className={SUFFIX_CLASS}>+{hiddenCount}</span> : null}
      </div>
    </div>
  );
}
