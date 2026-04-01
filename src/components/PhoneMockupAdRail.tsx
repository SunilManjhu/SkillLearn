import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';
import {
  DEFAULT_HERO_PHONE_AD_SLIDES,
  slideAriaLabel,
  type PhoneMockupAdBlock,
  type PhoneMockupAdSlide,
} from '../utils/heroPhoneAdsShared';

export type { PhoneMockupAdSlide } from '../utils/heroPhoneAdsShared';

export interface PhoneMockupAdRailProps {
  imageSrc: string;
  imageAlt: string;
  slides?: PhoneMockupAdSlide[];
}

/** One row grid + minmax(0,1fr) so the scroller always gets a definite height (single-slide path was short vs multi-slide). */
const SCREEN_BOX =
  'absolute left-[5.75%] right-[5.75%] top-[10.25%] bottom-[20.5%] z-10 grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[1.2rem]';

const TAP_MOVE_PX = 14;
const TAP_MAX_MS = 450;

function maxScrollLeft(el: HTMLDivElement): number {
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

/** Scroll to a slide using each child's offsetLeft — not i×clientWidth (padding/subpixels break the last slide). */
function scrollScrollerToSlideIndex(el: HTMLDivElement, index: number, slideCount: number) {
  if (slideCount < 1) return;
  const i = Math.min(Math.max(0, index), slideCount - 1);
  const children = el.children;
  const maxSl = maxScrollLeft(el);
  if (children.length === slideCount && children[i]) {
    const target = (children[i] as HTMLElement).offsetLeft;
    el.scrollTo({ left: Math.min(target, maxSl), behavior: 'auto' });
    return;
  }
  const w = el.clientWidth;
  if (w <= 0) return;
  el.scrollTo({ left: Math.min(i * w, maxSl), behavior: 'auto' });
}

/** Which slide is aligned with the viewport — nearest offsetLeft to scrollLeft (handles max scroll vs last slide). */
function activeIndexFromScroller(el: HTMLDivElement, n: number): number {
  if (n < 2) return 0;
  const sl = el.scrollLeft;
  const children = el.children;
  const maxSl = maxScrollLeft(el);
  if (maxSl > 0 && sl >= maxSl - 0.5) return n - 1;
  if (children.length !== n) {
    const w = el.clientWidth;
    if (w <= 0) return 0;
    return Math.min(Math.max(0, Math.round(sl / w)), n - 1);
  }
  let best = 0;
  let bestDist = Infinity;
  for (let k = 0; k < n; k++) {
    const left = (children[k] as HTMLElement).offsetLeft;
    const dist = Math.abs(sl - left);
    if (dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }
  return best;
}

function AdBlockText({ block }: { block: Extract<PhoneMockupAdBlock, { kind: 'text' }> }) {
  if (block.style === 'headline') {
    return <h3 className="shrink-0 text-sm font-bold leading-snug sm:text-[0.95rem]">{block.content}</h3>;
  }
  if (block.style === 'caption') {
    return (
      <p className="shrink-0 whitespace-pre-wrap break-words text-[0.65rem] leading-relaxed text-white/85">
        {block.content}
      </p>
    );
  }
  return (
    <p className="shrink-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-white/90">{block.content}</p>
  );
}

function AdBlockImage({ block }: { block: Extract<PhoneMockupAdBlock, { kind: 'image' }> }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const oh = block.overlayHeadline?.trim();
  const ob = block.overlayBody?.trim();
  const hasOverlay = !!(oh || ob);
  const maxPct = block.maxHeightPct;

  return (
    <div
      className="flex min-h-0 w-full min-w-0 flex-1 flex-col basis-0"
      style={{
        minHeight: '3.5rem',
        // cqh = % of slide article ([container-type:size]); % max-height vs flex parent often mis-resolves.
        maxHeight: `${maxPct}cqh`,
      }}
    >
      <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg bg-black/20 ring-1 ring-white/25">
        <img
          src={block.url}
          alt=""
          className="h-full w-full min-h-[3.5rem]"
          style={{ objectFit: block.fit }}
          loading="lazy"
          decoding="async"
          onError={() => setHidden(true)}
        />
        {hasOverlay ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2 pb-2 pt-10">
            {oh ? <p className="text-xs font-bold leading-tight text-white drop-shadow-sm">{oh}</p> : null}
            {ob ? (
              <p className="mt-0.5 text-[0.65rem] leading-snug text-white/95 drop-shadow-sm line-clamp-5">
                {ob}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SlideProgressTrack({
  isActive,
  progress,
  showTrack,
}: {
  isActive: boolean;
  progress: number;
  showTrack: boolean;
}) {
  if (!showTrack) return null;
  const p = isActive ? progress : 0;
  return (
    <div
      className="mb-1.5 h-1 w-full shrink-0 overflow-hidden rounded-full bg-white/25"
      aria-hidden={false}
    >
      <div
        className="h-full rounded-full bg-white/95"
        style={{ width: `${p * 100}%`, transition: 'none' }}
      />
    </div>
  );
}

export const PhoneMockupAdRail: React.FC<PhoneMockupAdRailProps> = ({
  imageSrc,
  imageAlt,
  slides = DEFAULT_HERO_PHONE_AD_SLIDES,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const [carouselProgress, setCarouselProgress] = useState(0);
  const accumulatedMsRef = useRef(0);

  const [holdPaused, setHoldPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const pointersDownRef = useRef(new Set<number>());
  const [finePointerHover, setFinePointerHover] = useState(false);

  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const pausedRef = useRef(false);
  pausedRef.current = holdPaused || (finePointerHover && hoverPaused);

  const syncActiveFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    const list = slidesRef.current;
    if (!el || list.length === 0) return;
    if (el.clientWidth <= 0) return;
    const n = list.length;
    const next = activeIndexFromScroller(el, n);
    setActive(next);
  }, []);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const slideCount = slides.length;
  const advanceKey = `${slideCount}:${slides.map((s) => `${s.id}:${s.autoAdvanceSec}`).join('|')}`;

  useEffect(() => {
    accumulatedMsRef.current = 0;
    setCarouselProgress(0);
  }, [active, advanceKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setFinePointerHover(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    syncActiveFromScroll();
    el.addEventListener('scroll', syncActiveFromScroll, { passive: true });
    return () => el.removeEventListener('scroll', syncActiveFromScroll);
  }, [syncActiveFromScroll, slideCount]);

  const goTo = useCallback(
    (index: number) => {
      const el = scrollerRef.current;
      const list = slidesRef.current;
      if (!el || list.length === 0) return;
      const i = Math.min(Math.max(0, index), list.length - 1);
      const w = el.clientWidth;
      if (w <= 0) return;
      // Always instant: smooth + scroll listener updates active mid-tween and misaligns snap/layout.
      scrollScrollerToSlideIndex(el, i, list.length);
      // Keep tabs/progress in sync: scroll events can lag or not fire; subpixel scrollLeft can mis-round vs tabs.
      activeRef.current = i;
      setActive(i);
    },
    []
  );

  // Clamp index when slide count changes and resync scroll offset + tabs.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const list = slidesRef.current;
    if (!el || list.length === 0) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const n = list.length;
    let prevForLog: number | null = null;
    let nextForScroll = 0;
    setActive((prev) => {
      prevForLog = prev;
      const next = Math.min(Math.max(0, prev), n - 1);
      nextForScroll = next;
      if (next !== prev) {
        activeRef.current = next;
        return next;
      }
      return prev;
    });
    if (prevForLog !== null && prevForLog !== nextForScroll) {
      scrollScrollerToSlideIndex(el, nextForScroll, n);
    }
  }, [slides.length]);

  // Phone mockup width changes (breakpoints, font): resnap scroll so active index matches pixels.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const list = slidesRef.current;
    if (!el || list.length <= 1) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const listNow = slidesRef.current;
      const idx = Math.min(Math.max(0, activeRef.current), listNow.length - 1);
      scrollScrollerToSlideIndex(el, idx, listNow.length);
      syncActiveFromScroll();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length, syncActiveFromScroll]);

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (slideCount <= 1) {
      setCarouselProgress(0);
      return;
    }

    let raf = 0;
    let lastTs = performance.now();

    let lastProgressEmit = -1;
    let lastEmitTs = 0;

    const loop = (ts: number) => {
      const dt = Math.min(64, ts - lastTs);
      lastTs = ts;

      const list = slidesRef.current;
      const count = list.length;
      const idx = activeRef.current;
      const sec = list[idx]?.autoAdvanceSec ?? 0;
      const durationMs = sec * 1000;

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const hidden = document.visibilityState === 'hidden';
      const paused = pausedRef.current || hidden;

      if (reduceMotion || count <= 1 || durationMs <= 0) {
        if (lastProgressEmit !== 0) {
          lastProgressEmit = 0;
          setCarouselProgress(0);
        }
        raf = requestAnimationFrame(loop);
        return;
      }

      if (!paused) {
        accumulatedMsRef.current += dt;
      }

      const p = Math.min(1, accumulatedMsRef.current / durationMs);
      const shouldEmit =
        p >= 1 ||
        Math.abs(p - lastProgressEmit) >= 0.02 ||
        ts - lastEmitTs >= 100;
      if (shouldEmit) {
        lastProgressEmit = p;
        lastEmitTs = ts;
        setCarouselProgress(p);
      }

      if (!paused && p >= 1) {
        accumulatedMsRef.current = 0;
        lastProgressEmit = 0;
        lastEmitTs = ts;
        setCarouselProgress(0);
        goToRef.current((idx + 1) % count);
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, advanceKey, slideCount]);

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest('a')) {
      tapStartRef.current = null;
    } else {
      tapStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    }
    pointersDownRef.current.add(e.pointerId);
    setHoldPaused(true);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersDownRef.current.delete(e.pointerId);
    if (pointersDownRef.current.size === 0) {
      setHoldPaused(false);
    }

    const t = e.target as HTMLElement | null;
    if (t?.closest('a')) {
      tapStartRef.current = null;
      return;
    }

    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > TAP_MOVE_PX || Math.abs(dy) > TAP_MOVE_PX) return;
    if (Date.now() - start.t > TAP_MAX_MS) return;

    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const i = activeRef.current;
    const n = slidesRef.current.length;
    if (rx < 0.2) {
      goTo((i - 1 + n) % n);
    } else {
      goTo((i + 1) % n);
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointersDownRef.current.delete(e.pointerId);
    if (pointersDownRef.current.size === 0) {
      setHoldPaused(false);
    }
    tapStartRef.current = null;
  };

  const showAutoplayUi = slideCount > 1;

  return (
    <div className="relative mx-auto w-full max-w-[min(100%,280px)] shrink-0 sm:max-w-[min(100%,300px)] md:max-w-[min(100%,320px)] lg:max-w-[min(100%,380px)] lg:w-full">
      <img
        src={imageSrc}
        alt={imageAlt}
        className="relative z-0 block h-auto w-full max-w-full select-none aspect-[640/1280]"
        width={640}
        height={1280}
        decoding="async"
        draggable={false}
      />

      <div className={SCREEN_BOX}>
        <div
          ref={scrollerRef}
          role="region"
          aria-roledescription="carousel"
          aria-label="Advertisements in phone preview"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse' && pointersDownRef.current.size === 0) {
              tapStartRef.current = null;
            }
          }}
          onMouseEnter={() => {
            if (finePointerHover) setHoverPaused(true);
          }}
          onMouseLeave={() => {
            setHoverPaused(false);
            tapStartRef.current = null;
          }}
          onKeyDown={(e) => {
            if (slideCount <= 1) return;
            const n = slideCount;
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              goTo((active - 1 + n) % n);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              goTo((active + 1) % n);
            }
          }}
          className={
            // Always row + stretch so one-slide (typical Firestore custom ads) matches the layout engine path
            // used for default 3-slide content — avoids a flex-col single-slide path that left dead space below the card.
            'relative box-border flex h-full min-h-0 w-full min-w-0 flex-row items-stretch focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20' +
            (slideCount > 1
              ? ' snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [-ms-overflow-style:none] touch-pan-x [&::-webkit-scrollbar]:hidden'
              : ' overflow-hidden')
          }
        >
            {slides.map((s, i) => {
              const sec = s.autoAdvanceSec ?? 0;
              const track = showAutoplayUi && sec > 0;
              const slideHasImage = s.blocks.some((b) => b.kind === 'image');
              return (
                <div
                  key={s.id}
                  id={`phone-ad-${s.id}`}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={slideAriaLabel(s)}
                  className={`relative box-border min-h-0 w-full min-w-full shrink-0 self-stretch ${slideCount > 1 ? 'h-full snap-start snap-always px-0.5' : 'h-full px-0'}`}
                >
                  {/* inset-0 fills slide so no dead band below the card (outside rounded article). */}
                  <article
                    className={`absolute inset-0 flex min-h-0 flex-col gap-2 rounded-xl bg-gradient-to-br p-3 text-left text-white shadow-inner ring-1 ring-white/15 ${slideHasImage ? '[container-type:size]' : ''} ${s.gradient}`}
                  >
                    <SlideProgressTrack
                      isActive={i === active}
                      progress={carouselProgress}
                      showTrack={track}
                    />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain">
                      {s.label ? (
                        <p className="flex shrink-0 items-center gap-1 text-[0.65rem] font-bold uppercase tracking-wider text-white/75">
                          <Sparkles size={12} className="shrink-0 opacity-90" aria-hidden />
                          {s.label}
                        </p>
                      ) : null}
                      {s.blocks.map((b, j) => (
                        <React.Fragment key={`${s.id}-b-${j}`}>
                          {b.kind === 'text' ? <AdBlockText block={b} /> : <AdBlockImage block={b} />}
                        </React.Fragment>
                      ))}
                    </div>
                    {s.linkUrl ? (
                      <a
                        href={s.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative z-10 inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white/20 px-3 py-2.5 text-center text-xs font-bold text-white ring-1 ring-white/35 backdrop-blur-sm hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                      >
                        <span className="truncate">{s.linkLabel?.trim() || 'Learn more'}</span>
                        <ExternalLink size={14} className="shrink-0 opacity-90" aria-hidden />
                      </a>
                    ) : (
                      <p className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide text-white/60">
                        Tap sides or swipe · Ad
                      </p>
                    )}
                  </article>
                </div>
              );
            })}
        </div>
      </div>

      {showAutoplayUi ? (
        <div
          className="mt-3 flex gap-1.5 px-0.5"
          role="tablist"
          aria-label="Advertisement slides and progress"
        >
          {slides.map((s, i) => {
            const hasTimer = (s.autoAdvanceSec ?? 0) > 0;
            // Without a per-slide timer, still show full orange on the active tab (otherwise last/manual slides stay at 0%).
            const fillPct =
              i < active ? 100 : i === active ? (hasTimer ? carouselProgress * 100 : 100) : 0;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-controls={`phone-ad-${s.id}`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => goTo(i)}
                className="flex min-h-11 min-w-0 flex-1 touch-manipulation flex-col justify-center gap-1 rounded-lg px-0.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/80"
                aria-label={`Show ad ${i + 1} of ${slides.length}`}
              >
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--hover-bg)] ring-1 ring-[var(--border-color)]/40">
                  <span
                    className="block h-full rounded-full bg-orange-500/95"
                    style={{ width: `${fillPct}%`, transition: 'none' }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        // Invisible row matching multi-slide tab strip so flex/min-content width matches 3-slide layout.
        <div
          className="mt-3 flex min-h-11 w-full gap-1.5 px-0.5 opacity-0 pointer-events-none select-none"
          aria-hidden
        >
          <span className="min-h-11 min-w-0 flex-1 rounded-lg" />
          <span className="min-h-11 min-w-0 flex-1 rounded-lg" />
          <span className="min-h-11 min-w-0 flex-1 rounded-lg" />
        </div>
      )}
    </div>
  );
};
