import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const SCREEN_BOX =
  'absolute left-[5.75%] right-[5.75%] top-[10.25%] bottom-[20.5%] z-10 overflow-hidden rounded-[1.2rem]';

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
      className="flex min-h-0 w-full min-w-0 flex-1 flex-col"
      style={{ maxHeight: `${maxPct}%`, minHeight: '3.5rem' }}
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

export const PhoneMockupAdRail: React.FC<PhoneMockupAdRailProps> = ({
  imageSrc,
  imageAlt,
  slides = DEFAULT_HERO_PHONE_AD_SLIDES,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const syncActiveFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || slides.length === 0) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const i = Math.round(el.scrollLeft / w);
    setActive(Math.min(Math.max(0, i), slides.length - 1));
  }, [slides.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    syncActiveFromScroll();
    el.addEventListener('scroll', syncActiveFromScroll, { passive: true });
    return () => el.removeEventListener('scroll', syncActiveFromScroll);
  }, [syncActiveFromScroll]);

  const goTo = (index: number) => {
    const el = scrollerRef.current;
    if (!el || slides.length === 0) return;
    const i = Math.min(Math.max(0, index), slides.length - 1);
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <div className="relative mx-auto w-full max-w-[min(100%,280px)] sm:max-w-[300px] md:max-w-[320px] lg:max-w-[min(100%,380px)]">
      <img
        src={imageSrc}
        alt={imageAlt}
        className="relative z-0 w-full select-none"
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
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              goTo(active - 1);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              goTo(active + 1);
            }
          }}
          className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [-ms-overflow-style:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20 [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((s) => (
            <div
              key={s.id}
              id={`phone-ad-${s.id}`}
              role="group"
              aria-roledescription="slide"
              aria-label={slideAriaLabel(s)}
              className="h-full w-full shrink-0 snap-center snap-always px-0.5"
            >
              <article
                className={`flex h-full min-h-0 flex-col gap-2 rounded-xl bg-gradient-to-br p-3 text-left text-white shadow-inner ring-1 ring-white/15 ${s.gradient}`}
              >
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain">
                  {s.label ? (
                    <p className="flex shrink-0 items-center gap-1 text-[0.65rem] font-bold uppercase tracking-wider text-white/75">
                      <Sparkles size={12} className="shrink-0 opacity-90" aria-hidden />
                      {s.label}
                    </p>
                  ) : null}
                  {s.blocks.map((b, i) => (
                    <React.Fragment key={`${s.id}-b-${i}`}>
                      {b.kind === 'text' ? <AdBlockText block={b} /> : <AdBlockImage block={b} />}
                    </React.Fragment>
                  ))}
                </div>
                {s.linkUrl ? (
                  <a
                    href={s.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white/20 px-3 py-2.5 text-center text-xs font-bold text-white ring-1 ring-white/35 backdrop-blur-sm hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    <span className="truncate">{s.linkLabel?.trim() || 'Learn more'}</span>
                    <ExternalLink size={14} className="shrink-0 opacity-90" aria-hidden />
                  </a>
                ) : (
                  <p className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide text-white/60">
                    Swipe for more · Ad
                  </p>
                )}
              </article>
            </div>
          ))}
        </div>
      </div>

      <div
        className="mt-3 flex justify-center gap-2"
        role="tablist"
        aria-label="Choose advertisement slide"
      >
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`phone-ad-${s.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => goTo(i)}
            className={`min-h-11 min-w-11 flex items-center justify-center rounded-full p-2 touch-manipulation ${i === active ? 'bg-orange-500/90' : 'bg-[var(--hover-bg)] hover:bg-[var(--border-color)]'}`}
            aria-label={`Show ad ${i + 1} of ${slides.length}`}
          >
            <span
              className={`block rounded-full transition-all ${i === active ? 'h-2 w-6 bg-white' : 'h-2 w-2 bg-[var(--text-muted)]'}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
};
