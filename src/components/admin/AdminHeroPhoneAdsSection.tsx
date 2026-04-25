import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ImagePlus,
  Megaphone,
  Minus,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { PhoneMockupAdRail } from '../PhoneMockupAdRail';
import {
  HERO_AD_IMAGE_FIT_OPTIONS,
  HERO_PHONE_AD_GRADIENT_PRESET_OPTIONS,
  HERO_PHONE_AD_MAX_AUTO_SEC,
  INITIAL_STORED_HERO_PHONE_ADS,
  type HeroAdBlockStored,
  type HeroPhoneAdGradientPreset,
  type HeroPhoneAdSlideStored,
  isAllowedHeroAdHttpUrl,
  isHeroAdImageFit,
  storedSlideToRailSlide,
} from '../../utils/heroPhoneAdsShared';
import { scrollDisclosureRowToTop } from '../../utils/scrollDisclosureRowToTop';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { loadHeroPhoneAdsForAdmin, saveHeroPhoneAdsAsAdmin } from '../../utils/heroPhoneAdsFirestore';
import { useAdminActionToast } from './useAdminActionToast';
import { AdminLabelInfoTip } from './adminLabelInfoTip';

const MAX_BLOCKS_PER_SLIDE = 10;
/** Firestore allows up to 8; keep list scrollable so many rows stay manageable if the cap rises. */
const MAX_SLIDES = 8;

type HeroAdsAdminCache = {
  enabled: boolean;
  defaultSlideDurationSec: number;
  slides: HeroPhoneAdSlideStored[];
};

let heroAdsAdminCache: HeroAdsAdminCache | null = null;

function heroSlideCollapsedSummary(s: HeroPhoneAdSlideStored): { title: string; subtitle: string } {
  const label = s.label?.trim();
  const headlineBlock = s.blocks.find((b) => b.kind === 'text' && (b.style ?? 'body') === 'headline');
  const firstText = s.blocks.find((b) => b.kind === 'text');
  const headline =
    headlineBlock && headlineBlock.kind === 'text' ? headlineBlock.content.trim() : '';
  const bodyPreview =
    firstText && firstText.kind === 'text' ? firstText.content.trim().replace(/\s+/g, ' ') : '';
  const title =
    label ||
    (headline ? headline.slice(0, 56) : bodyPreview ? bodyPreview.slice(0, 56) : 'Untitled slide');
  const grad =
    HERO_PHONE_AD_GRADIENT_PRESET_OPTIONS.find((o) => o.value === s.gradientPreset)?.label ??
    s.gradientPreset;
  const off = s.enabled === false ? ' · Hidden' : '';
  const subtitle = `${s.blocks.length} block${s.blocks.length === 1 ? '' : 's'} · ${grad}${off}`;
  return { title, subtitle };
}

function cloneBlocks(blocks: HeroAdBlockStored[]): HeroAdBlockStored[] {
  return blocks.map((b) => {
    if (b.kind === 'text') {
      return { kind: 'text', content: b.content, ...(b.style ? { style: b.style } : {}) };
    }
    return {
      kind: 'image',
      url: b.url,
      fit: b.fit,
      ...(b.maxHeightPct != null ? { maxHeightPct: b.maxHeightPct } : {}),
      ...(b.overlayHeadline ? { overlayHeadline: b.overlayHeadline } : {}),
      ...(b.overlayBody ? { overlayBody: b.overlayBody } : {}),
    };
  });
}

/** Single-slide UX: Advertisements (global) off → Show (per slide) off and locked; on → Show on and locked. */
function normalizeHeroSlidesForAdsState(
  slides: HeroPhoneAdSlideStored[],
  adsEnabled: boolean
): HeroPhoneAdSlideStored[] {
  if (slides.length !== 1) return slides;
  const s = slides[0];
  if (!s) return slides;
  if (!adsEnabled) {
    if (s.enabled === false) return slides;
    return [{ ...s, enabled: false }];
  }
  if (s.enabled === false) {
    return [{ ...s, enabled: true }];
  }
  return slides;
}

function cloneStoredSlides(s: HeroPhoneAdSlideStored[]): HeroPhoneAdSlideStored[] {
  return s.map((x) => ({
    id: x.id,
    gradientPreset: x.gradientPreset,
    blocks: cloneBlocks(x.blocks),
    ...(x.label != null && x.label !== '' ? { label: x.label } : {}),
    ...(x.linkUrl != null && x.linkUrl !== '' ? { linkUrl: x.linkUrl } : {}),
    ...(x.linkLabel != null && x.linkLabel !== '' ? { linkLabel: x.linkLabel } : {}),
    ...(typeof x.slideDurationSec === 'number' && Number.isFinite(x.slideDurationSec)
      ? { slideDurationSec: x.slideDurationSec }
      : {}),
    ...(x.enabled === false ? { enabled: false } : {}),
  }));
}

/** Compare persisted-shaped slides so e.g. explicit `enabled: true` matches omitted (shown) slide flag. */
function slidesEqual(a: HeroPhoneAdSlideStored[], b: HeroPhoneAdSlideStored[]): boolean {
  return JSON.stringify(cloneStoredSlides(a)) === JSON.stringify(cloneStoredSlides(b));
}

function newSlideId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ad-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface AdminHeroPhoneAdsSectionProps {
  phoneMockupSrc: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export const AdminHeroPhoneAdsSection: React.FC<AdminHeroPhoneAdsSectionProps> = ({
  phoneMockupSrc,
  onDirtyChange,
}) => {
  /** Accordion: at most one slide editor open (same idea as catalog modules)—see docs/patterns-admin-disclosure-widgets.md */
  const slideShellRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const didExpandAfterLoadRef = useRef(false);
  const shouldScrollOnExpandRef = useRef(false);
  const [expandedSlideId, setExpandedSlideId] = useState<string | null>(null);
  const { showActionToast, actionToast } = useAdminActionToast();
  const [saveErrorDialog, setSaveErrorDialog] = useState<{ code?: string; message?: string } | null>(null);
  const [resetDefaultsDialogOpen, setResetDefaultsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(() => heroAdsAdminCache == null);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(() => heroAdsAdminCache?.enabled ?? false);
  const [draftSlides, setDraftSlides] = useState<HeroPhoneAdSlideStored[]>(() =>
    cloneStoredSlides(heroAdsAdminCache?.slides ?? INITIAL_STORED_HERO_PHONE_ADS)
  );
  const [savedEnabled, setSavedEnabled] = useState(() => heroAdsAdminCache?.enabled ?? false);
  const [savedSlides, setSavedSlides] = useState<HeroPhoneAdSlideStored[]>(() =>
    cloneStoredSlides(heroAdsAdminCache?.slides ?? INITIAL_STORED_HERO_PHONE_ADS)
  );
  const [draftDefaultSec, setDraftDefaultSec] = useState(() => heroAdsAdminCache?.defaultSlideDurationSec ?? 0);
  const [savedDefaultSec, setSavedDefaultSec] = useState(() => heroAdsAdminCache?.defaultSlideDurationSec ?? 0);
  /** Text in AutoView field — separate from `draftDefaultSec` so typing (e.g. "12") is not forced through `0` / leading zeros. */
  const [autoViewSecText, setAutoViewSecText] = useState(() =>
    String(heroAdsAdminCache?.defaultSlideDurationSec ?? 0)
  );
  const autoViewSecInputRef = useRef<HTMLInputElement | null>(null);

  const applyLoaded = useCallback((doc: HeroAdsAdminCache | null) => {
    if (doc) {
      setEnabled(doc.enabled);
      setSavedEnabled(doc.enabled);
      const def = doc.defaultSlideDurationSec ?? 0;
      setDraftDefaultSec(def);
      setSavedDefaultSec(def);
      const cl = cloneStoredSlides(doc.slides);
      const normalized = normalizeHeroSlidesForAdsState(cl, doc.enabled);
      setDraftSlides(normalized);
      setSavedSlides(cloneStoredSlides(normalized));
    } else {
      const seed = cloneStoredSlides(INITIAL_STORED_HERO_PHONE_ADS);
      setEnabled(false);
      setSavedEnabled(false);
      setDraftDefaultSec(0);
      setSavedDefaultSec(0);
      setDraftSlides(seed);
      setSavedSlides(cloneStoredSlides(seed));
    }
  }, []);

  const load = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (opts?.showLoading !== false) setLoading(true);
    const doc = await loadHeroPhoneAdsForAdmin();
    const next: HeroAdsAdminCache | null = doc
      ? {
          enabled: doc.enabled,
          defaultSlideDurationSec: doc.defaultSlideDurationSec ?? 0,
          slides: cloneStoredSlides(normalizeHeroSlidesForAdsState(cloneStoredSlides(doc.slides), doc.enabled)),
        }
      : null;
    heroAdsAdminCache = next;
    applyLoaded(next);
    setLoading(false);
  }, [applyLoaded]);

  useEffect(() => {
    if (heroAdsAdminCache) {
      const id = window.setTimeout(() => void load({ showLoading: false }), 0);
      return () => window.clearTimeout(id);
    }
    void load({ showLoading: true });
  }, [load]);

  useEffect(() => {
    if (autoViewSecInputRef.current === document.activeElement) return;
    setAutoViewSecText(String(draftDefaultSec));
  }, [draftDefaultSec]);

  useEffect(() => {
    setDraftSlides((prev) => normalizeHeroSlidesForAdsState(prev, enabled));
  }, [enabled, draftSlides.length]);

  const dirty = useMemo(
    () =>
      enabled !== savedEnabled ||
      draftDefaultSec !== savedDefaultSec ||
      !slidesEqual(draftSlides, savedSlides),
    [enabled, savedEnabled, draftDefaultSec, savedDefaultSec, draftSlides, savedSlides]
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    setExpandedSlideId((prev) => {
      const stillThere = prev != null && draftSlides.some((s) => s.id === prev);
      if (loading) {
        return stillThere ? prev : null;
      }
      if (stillThere) return prev;
      if (!didExpandAfterLoadRef.current && draftSlides.length > 0) {
        didExpandAfterLoadRef.current = true;
        return draftSlides[0]!.id;
      }
      return null;
    });
  }, [draftSlides, loading]);

  /** Align expanded slide into view (page scroll — slides are not in an inner scroll box). */
  useLayoutEffect(() => {
    if (expandedSlideId == null) return;
    if (!shouldScrollOnExpandRef.current) return;
    shouldScrollOnExpandRef.current = false;
    const slideEl = slideShellRefs.current.get(expandedSlideId);
    scrollDisclosureRowToTop(null, slideEl);
  }, [expandedSlideId]);

  const toggleSlideExpanded = useCallback((id: string) => {
    shouldScrollOnExpandRef.current = true;
    setExpandedSlideId((prev) => (prev === id ? null : id));
  }, []);

  const collapseAllSlides = useCallback(() => {
    setExpandedSlideId(null);
  }, []);

  const previewSlides = useMemo(() => {
    const active = draftSlides.filter((s) => s.enabled !== false);
    const mapped = active.map((s) => storedSlideToRailSlide(s, draftDefaultSec));
    return mapped;
  }, [draftSlides, draftDefaultSec]);

  const enabledSlideCount = useMemo(
    () => draftSlides.filter((s) => s.enabled !== false).length,
    [draftSlides]
  );

  const updateSlide = (slideIndex: number, patch: Partial<HeroPhoneAdSlideStored>) => {
    setDraftSlides((prev) => {
      const next = [...prev];
      const cur = next[slideIndex];
      if (!cur) return prev;
      next[slideIndex] = { ...cur, ...patch };
      return next;
    });
  };

  const replaceBlock = (slideIndex: number, blockIndex: number, block: HeroAdBlockStored) => {
    setDraftSlides((prev) => {
      const next = [...prev];
      const slide = next[slideIndex];
      if (!slide) return prev;
      const blocks = [...slide.blocks];
      if (!blocks[blockIndex]) return prev;
      blocks[blockIndex] = block;
      next[slideIndex] = { ...slide, blocks };
      return next;
    });
  };

  const moveBlock = (slideIndex: number, blockIndex: number, dir: -1 | 1) => {
    setDraftSlides((prev) => {
      const next = [...prev];
      const slide = next[slideIndex];
      if (!slide) return prev;
      const j = blockIndex + dir;
      if (j < 0 || j >= slide.blocks.length) return prev;
      const blocks = [...slide.blocks];
      [blocks[blockIndex], blocks[j]] = [blocks[j]!, blocks[blockIndex]!];
      next[slideIndex] = { ...slide, blocks };
      return next;
    });
  };

  const addTextBlock = (slideIndex: number) => {
    setDraftSlides((prev) => {
      const next = [...prev];
      const slide = next[slideIndex];
      if (!slide || slide.blocks.length >= MAX_BLOCKS_PER_SLIDE) return prev;
      next[slideIndex] = {
        ...slide,
        blocks: [...slide.blocks, { kind: 'text', style: 'body', content: 'New text' }],
      };
      return next;
    });
  };

  const addImageBlock = (slideIndex: number) => {
    setDraftSlides((prev) => {
      const next = [...prev];
      const slide = next[slideIndex];
      if (!slide || slide.blocks.length >= MAX_BLOCKS_PER_SLIDE) return prev;
      next[slideIndex] = {
        ...slide,
        blocks: [
          ...slide.blocks,
          {
            kind: 'image',
            url: 'https://',
            fit: 'contain',
            maxHeightPct: 75,
          },
        ],
      };
      return next;
    });
  };

  const removeBlock = (slideIndex: number, blockIndex: number) => {
    setDraftSlides((prev) => {
      const next = [...prev];
      const slide = next[slideIndex];
      if (!slide || slide.blocks.length <= 1) return prev;
      next[slideIndex] = {
        ...slide,
        blocks: slide.blocks.filter((_, i) => i !== blockIndex),
      };
      return next;
    });
  };

  const moveSlide = (index: number, dir: -1 | 1) => {
    setDraftSlides((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  };

  const addSlide = () => {
    const id = newSlideId();
    setDraftSlides((prev) => {
      if (prev.length >= MAX_SLIDES) return prev;
      return [
        ...prev,
        {
          id,
          label: 'Sponsored',
          gradientPreset: 'cyan_blue' as HeroPhoneAdGradientPreset,
          blocks: [
            { kind: 'text', style: 'headline', content: 'New headline' },
            { kind: 'text', style: 'body', content: 'Short promo copy for learners.' },
          ],
        },
      ];
    });
    setExpandedSlideId(id);
  };

  const removeSlide = (index: number) => {
    setDraftSlides((prev) => {
      if (prev.length <= 1) return prev;
      const removedId = prev[index]?.id;
      const next = prev.filter((_, i) => i !== index);
      if (removedId) {
        setExpandedSlideId((cur) => {
          if (cur !== removedId) return cur;
          return next[Math.min(index, next.length - 1)]?.id ?? next[0]?.id ?? null;
        });
      }
      return next;
    });
  };

  const resetSlideToTemplate = (slideIndex: number) => {
    setDraftSlides((prev) => {
      const cur = prev[slideIndex];
      if (!cur) return prev;
      const next = [...prev];
      next[slideIndex] = {
        id: cur.id,
        label: 'Sponsored',
        gradientPreset: 'cyan_blue',
        blocks: [
          { kind: 'text', style: 'headline', content: 'New headline' },
          { kind: 'text', style: 'body', content: 'Short promo copy for learners.' },
        ],
        ...(cur.enabled === false ? { enabled: false } : {}),
      };
      return next;
    });
  };

  const bumpDefaultSec = useCallback((delta: -1 | 1) => {
    setDraftDefaultSec((v) => {
      const n = Math.round(Number(v));
      const base = Number.isFinite(n) ? n : 0;
      const next = Math.min(HERO_PHONE_AD_MAX_AUTO_SEC, Math.max(0, base + delta));
      setAutoViewSecText(String(next));
      return next;
    });
  }, []);

  const validateBeforeSave = (): boolean => {
    const def = Math.round(draftDefaultSec);
    if (!Number.isFinite(def) || def < 0 || def > HERO_PHONE_AD_MAX_AUTO_SEC) {
      showActionToast(`Default duration must be 0–${HERO_PHONE_AD_MAX_AUTO_SEC} seconds.`, 'danger');
      return false;
    }
    if (enabled && !draftSlides.some((s) => s.enabled !== false)) {
      showActionToast('Enable at least one slide, or turn Advertisements (global) off.', 'danger');
      return false;
    }
    for (const s of draftSlides) {
      if (!s.id.trim()) {
        showActionToast('Each slide needs an id.', 'danger');
        return false;
      }
      if (s.blocks.length < 1 || s.blocks.length > MAX_BLOCKS_PER_SLIDE) {
        showActionToast(`Each slide needs 1–${MAX_BLOCKS_PER_SLIDE} content blocks.`, 'danger');
        return false;
      }
      for (const b of s.blocks) {
        if (b.kind === 'text') {
          if (!b.content.trim()) {
            showActionToast('Remove empty text blocks or add content.', 'danger');
            return false;
          }
        } else {
          if (!b.url.trim() || !isAllowedHeroAdHttpUrl(b.url.trim())) {
            showActionToast('Each image block needs a valid http(s) image URL.', 'danger');
            return false;
          }
          if (!isHeroAdImageFit(b.fit)) {
            showActionToast('Invalid image fit mode.', 'danger');
            return false;
          }
          const m = b.maxHeightPct;
          if (m != null && (m < 20 || m > 100)) {
            showActionToast('Image max height must be 20–100 (% of card).', 'danger');
            return false;
          }
        }
      }
      const lu = s.linkUrl?.trim();
      if (lu && !isAllowedHeroAdHttpUrl(lu)) {
        showActionToast('Link URL must be a valid http(s) URL.', 'danger');
        return false;
      }
      if (s.linkLabel?.trim() && !lu) {
        showActionToast('Add a link URL if you set a button label.', 'danger');
        return false;
      }
      const sd = s.slideDurationSec;
      if (typeof sd === 'number' && (!Number.isFinite(sd) || sd < 0 || sd > HERO_PHONE_AD_MAX_AUTO_SEC)) {
        showActionToast(`Auto-Play must be 0–${HERO_PHONE_AD_MAX_AUTO_SEC} or left empty.`, 'danger');
        return false;
      }
    }
    return true;
  };

  const closeSaveErrorDialog = useCallback(() => setSaveErrorDialog(null), []);
  const closeResetDefaultsDialog = useCallback(() => setResetDefaultsDialogOpen(false), []);
  const confirmResetDefaults = useCallback(() => {
    const next = cloneStoredSlides(INITIAL_STORED_HERO_PHONE_ADS);
    setDraftSlides(next);
    setExpandedSlideId(next[0]?.id ?? null);
    showActionToast('Draft replaced with the default three slides.', 'neutral');
    setResetDefaultsDialogOpen(false);
  }, [showActionToast]);

  useBodyScrollLock(saveErrorDialog !== null || resetDefaultsDialogOpen);
  useDialogKeyboard({
    open: saveErrorDialog !== null,
    onClose: closeSaveErrorDialog,
    onPrimaryAction: closeSaveErrorDialog,
  });
  useDialogKeyboard({
    open: resetDefaultsDialogOpen,
    onClose: closeResetDefaultsDialog,
    onPrimaryAction: confirmResetDefaults,
  });

  const handleSave = async () => {
    if (!validateBeforeSave()) return;
    setSaving(true);
    const result = await saveHeroPhoneAdsAsAdmin({
      enabled,
      defaultSlideDurationSec: draftDefaultSec,
      slides: draftSlides.map((s) => ({
        id: s.id.trim(),
        gradientPreset: s.gradientPreset,
        label: s.label?.trim() || undefined,
        linkUrl: s.linkUrl?.trim() || undefined,
        linkLabel: s.linkLabel?.trim() || undefined,
        ...(typeof s.slideDurationSec === 'number' && Number.isFinite(s.slideDurationSec)
          ? { slideDurationSec: s.slideDurationSec }
          : {}),
        ...(s.enabled === false ? { enabled: false } : {}),
        blocks: cloneBlocks(s.blocks),
      })),
    });
    setSaving(false);
    if (result.ok === false) {
      setSaveErrorDialog({
        code: result.code,
        message: result.message ?? 'Could not save hero phone ads.',
      });
      return;
    }
    setSavedEnabled(enabled);
    setSavedDefaultSec(draftDefaultSec);
    setSavedSlides(cloneStoredSlides(draftSlides));
    heroAdsAdminCache = {
      enabled,
      defaultSlideDurationSec: draftDefaultSec,
      slides: cloneStoredSlides(draftSlides),
    };
    showActionToast('Home hero phone ads saved.');
  };

  const handleDiscard = () => {
    setEnabled(savedEnabled);
    setDraftDefaultSec(savedDefaultSec);
    setAutoViewSecText(String(savedDefaultSec));
    const next = cloneStoredSlides(savedSlides);
    setDraftSlides(next);
    setExpandedSlideId((prev) => (prev != null && next.some((s) => s.id === prev) ? prev : null));
  };

  const handleResetSlidesToBundledDefaults = () => {
    setResetDefaultsDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6 text-sm text-[var(--text-muted)]">
        Loading hero ads…
      </div>
    );
  }

  return (
    <>
      <div className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
        <div className="mb-3 flex flex-col gap-3 lg:mb-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1 space-y-1.5 lg:min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              <h2 className="flex min-w-0 items-center gap-1.5 text-[0.95rem] font-bold leading-tight text-[var(--text-primary)] sm:gap-2 sm:text-base sm:leading-normal md:text-lg">
                <Megaphone size={17} className="shrink-0 text-admin-icon sm:size-[18px] md:size-5" aria-hidden />
                <span className="min-w-0">Home — Phone Advertisements</span>
              </h2>
              <AdminLabelInfoTip
                controlOnly
                tipId="hero-ads-tip-section"
                tipRegionAriaLabel="Home Phone Advertisements overview"
                tipSubject="Home Phone Advertisements"
              >
              <li>
                Custom cards show on the <strong className="font-semibold text-[var(--text-secondary)]">home hero</strong>{' '}
                mockup when <strong className="font-semibold text-[var(--text-secondary)]">Advertisements (global)</strong> is on and
                you save.
              </li>
              <li>
                Turn <strong className="font-semibold text-[var(--text-secondary)]">Advertisements (global)</strong>{' '}
                <strong className="font-semibold text-[var(--text-secondary)]">off</strong> to show default sample
                content—your draft below is kept.
              </li>
              </AdminLabelInfoTip>
            </div>
            <p className="max-w-xl text-[0.7rem] leading-snug text-[var(--text-muted)] sm:hidden">
              Set timing and toggle advertisements.
            </p>
            <p className="hidden max-w-xl text-[0.7rem] leading-snug text-[var(--text-muted)] sm:block sm:text-xs">
              Set carousel timing, toggle custom advertisements on/off, then build slides. The preview updates as you edit.
            </p>
          </div>

          {/* AutoView + Advertisements (global): full-width on small screens; compact inline toolbar on lg+ */}
          <div className="min-w-0 w-full shrink-0 lg:w-auto">
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 sm:px-4 sm:py-3 lg:rounded-lg lg:px-3 lg:py-1.5">
              <div className="flex min-h-0 flex-col gap-1.5 sm:min-h-11 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-3 sm:overflow-x-auto sm:overscroll-x-contain sm:[-webkit-overflow-scrolling:touch] lg:min-h-9 lg:gap-2 lg:overflow-visible">
                <div className="flex min-w-0 w-full items-center justify-between gap-2 sm:w-auto sm:flex-1 sm:justify-start sm:gap-2 lg:flex-none">
                  <Timer
                    size={16}
                    className="size-4 shrink-0 text-admin-icon sm:size-[18px] lg:size-4"
                    aria-hidden
                  />
                  <div className="min-w-0 [&>div]:flex-nowrap [&>div]:gap-x-1 lg:[&>div]:gap-x-0.5">
                    <AdminLabelInfoTip
                      htmlFor="hero-ad-default-sec"
                      label="AutoView"
                      labelClassName="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)] sm:text-sm lg:text-xs lg:font-semibold"
                      tipId="hero-ads-tip-default-sec"
                      tipRegionAriaLabel="AutoView tips"
                      tipSubject="AutoView"
                    >
                      <li>
                        <strong className="font-semibold text-[var(--text-secondary)]">0</strong> = swipe only (no timer).
                      </li>
                      <li>Non-zero: the hero carousel advances each slide after that many seconds.</li>
                      <li>Per-slide Auto-Play overrides below when set.</li>
                      <li>
                        Respects <strong className="font-semibold text-[var(--text-secondary)]">reduced motion</strong>{' '}
                        (no Auto-Play).
                      </li>
                    </AdminLabelInfoTip>
                  </div>
                  <div
                    className="inline-flex shrink-0 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] lg:rounded-md"
                    role="group"
                    aria-label="AutoView seconds"
                  >
                    <button
                      type="button"
                      onClick={() => bumpDefaultSec(-1)}
                      disabled={draftDefaultSec <= 0}
                      className="inline-flex min-h-10 min-w-11 touch-manipulation items-center justify-center border-r border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-35 lg:h-8 lg:min-h-8 lg:min-w-9"
                      aria-label="Decrease AutoView seconds by one"
                    >
                      <Minus size={18} className="shrink-0 lg:size-4" aria-hidden />
                    </button>
                    <input
                      ref={autoViewSecInputRef}
                      id="hero-ad-default-sec"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={autoViewSecText}
                      aria-label="AutoView: seconds between slides; 0 means swipe only"
                      aria-valuemin={0}
                      aria-valuemax={HERO_PHONE_AD_MAX_AUTO_SEC}
                      aria-valuenow={draftDefaultSec}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '');
                        if (digits === '') {
                          setAutoViewSecText('');
                          setDraftDefaultSec(0);
                          return;
                        }
                        const n = parseInt(digits, 10);
                        if (!Number.isFinite(n)) return;
                        const c = Math.min(HERO_PHONE_AD_MAX_AUTO_SEC, Math.max(0, n));
                        setDraftDefaultSec(c);
                        setAutoViewSecText(String(c));
                      }}
                      onBlur={() => {
                        setAutoViewSecText(String(draftDefaultSec));
                      }}
                      className="min-h-10 w-[4.75rem] border-0 bg-[var(--bg-secondary)] px-2 py-1.5 text-center text-sm tabular-nums text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#a1a2a2]/50 sm:w-28 sm:px-2.5 lg:h-8 lg:min-h-8 lg:w-[5.5rem] lg:py-0 lg:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => bumpDefaultSec(1)}
                      disabled={draftDefaultSec >= HERO_PHONE_AD_MAX_AUTO_SEC}
                      className="inline-flex min-h-10 min-w-11 touch-manipulation items-center justify-center border-l border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-35 lg:h-8 lg:min-h-8 lg:min-w-9"
                      aria-label="Increase AutoView seconds by one"
                    >
                      <Plus size={18} className="shrink-0 lg:size-4" aria-hidden />
                    </button>
                  </div>
                </div>

                <span
                  className="hidden h-8 w-px shrink-0 self-center bg-[var(--border-color)]/70 sm:block lg:h-5"
                  aria-hidden
                />

                <div className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 sm:w-auto sm:shrink-0 sm:gap-2 sm:px-0 sm:py-0 lg:gap-1.5">
                  <input
                    id="hero-ads-enabled"
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    aria-label="Advertisements (global): use custom hero content on the home page"
                    className="size-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
                  />
                  <div className="flex min-w-0 items-center gap-1 lg:gap-0.5">
                    <label
                      htmlFor="hero-ads-enabled"
                      className="cursor-pointer text-xs font-bold leading-tight text-[var(--text-primary)] sm:text-sm sm:leading-snug lg:text-xs"
                    >
                      Advertisements (global)
                    </label>
                    <AdminLabelInfoTip
                      controlOnly
                      tipId="hero-ads-tip-custom-enabled"
                      tipRegionAriaLabel="Advertisements (global) tips"
                      tipSubject="Advertisements (global)"
                    >
                      <li>
                        When <strong className="font-semibold text-[var(--text-secondary)]">on</strong>, saved slides
                        replace the default hero carousel for learners.
                      </li>
                      <li>
                        When <strong className="font-semibold text-[var(--text-secondary)]">off</strong>, learners see
                        default sample content; this draft stays in the editor.
                      </li>
                      <li>
                        With only <strong className="font-semibold text-[var(--text-secondary)]">one slide</strong>,{' '}
                        <strong className="font-semibold text-[var(--text-secondary)]">Show (per slide)</strong> is off and
                        locked while <strong className="font-semibold text-[var(--text-secondary)]">Advertisements (global)</strong> is
                        off; turning <strong className="font-semibold text-[var(--text-secondary)]">Advertisements (global)</strong> on
                        turns it on and keeps it locked so the hero always has one card.
                      </li>
                    </AdminLabelInfoTip>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-5 border-t border-[var(--border-color)] pt-4 sm:gap-6 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] lg:items-start lg:gap-8 lg:pt-6 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] xl:gap-10">
          <div className="order-2 min-w-0 space-y-3 lg:order-1">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
              <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 sm:gap-x-1.5 sm:gap-y-1">
                <h3 className="text-xs font-bold leading-tight text-[var(--text-primary)] sm:text-sm sm:leading-none">
                  Slides ({draftSlides.length} / {MAX_SLIDES})
                </h3>
                <AdminLabelInfoTip
                  controlOnly
                  tipId="hero-ads-tip-slides"
                  tipRegionAriaLabel="Slides and blocks tips"
                  tipSubject="slides and blocks"
                >
                  <li>
                    Build each card from ordered <strong className="font-semibold text-[var(--text-secondary)]">text</strong>{' '}
                    and <strong className="font-semibold text-[var(--text-secondary)]">image</strong> blocks.
                  </li>
                  <li>
                    Add blocks with the buttons below; reorder with arrows (max {MAX_BLOCKS_PER_SLIDE} blocks per slide).
                  </li>
                  <li>
                    Up to <strong className="font-semibold text-[var(--text-secondary)]">{MAX_SLIDES}</strong> slides;{' '}
                    <strong className="font-semibold text-[var(--text-secondary)]">Default 3 Slides</strong> restores
                    bundled starters.
                  </li>
                  <li>
                    Only <strong className="font-semibold text-[var(--text-secondary)]">one slide</strong> editor is open
                    at a time (like catalog modules). Tap the <strong className="font-semibold text-[var(--text-secondary)]">chevron</strong>{' '}
                    to switch slides or collapse. <strong className="font-semibold text-[var(--text-secondary)]">Collapse All</strong>{' '}
                    closes the open editor.
                  </li>
                  <li>
                    For images: <strong className="font-semibold text-[var(--text-secondary)]">contain</strong> vs{' '}
                    <strong className="font-semibold text-[var(--text-secondary)]">cover</strong>,{' '}
                    <strong className="font-semibold text-[var(--text-secondary)]">max height %</strong>, and optional{' '}
                    <strong className="font-semibold text-[var(--text-secondary)]">overlay</strong>—see the{' '}
                    <strong className="font-semibold text-[var(--text-secondary)]">Image URL</strong> tip on each image
                    block.
                  </li>
                  <li>
                    <strong className="font-semibold text-[var(--text-secondary)]">Show (per slide)</strong> picks which
                    slides go live when <strong className="font-semibold text-[var(--text-secondary)]">Advertisements (global)</strong> is
                    on. With <strong className="font-semibold text-[var(--text-secondary)]">two or more slides</strong>, you can
                    mix on/off; with <strong className="font-semibold text-[var(--text-secondary)]">one slide</strong>, Show
                    follows Advertisements (global)—see that tip.
                  </li>
                </AdminLabelInfoTip>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2">
                <button
                  type="button"
                  onClick={collapseAllSlides}
                  disabled={draftSlides.length === 0 || expandedSlideId === null}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] px-2 py-2 text-[0.65rem] font-bold leading-tight text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-40 sm:min-h-11 sm:flex-initial sm:px-3 sm:text-xs"
                >
                  <span className="sm:hidden">Collapse</span>
                  <span className="hidden sm:inline">Collapse All</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetSlidesToBundledDefaults}
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] px-2 py-2 text-[0.65rem] font-bold leading-tight text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] sm:flex-initial sm:gap-1.5 sm:px-3 sm:text-xs sm:text-sm"
                >
                  <RotateCcw size={16} className="shrink-0 sm:size-[18px]" aria-hidden />
                  <span className="sm:hidden">Defaults</span>
                  <span className="hidden sm:inline">Default 3 Slides</span>
                </button>
                <button
                  type="button"
                  disabled={draftSlides.length >= MAX_SLIDES}
                  onClick={addSlide}
                  className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-[#616161]/15 px-2.5 py-2 text-xs font-bold text-[#393a3a] hover:bg-[#616161]/25 disabled:pointer-events-none disabled:opacity-40 app-dark:text-[#cfcfcf] sm:col-span-1 sm:flex-initial sm:gap-1.5 sm:px-3 sm:text-sm"
                >
                  <Plus size={16} className="shrink-0 sm:size-[18px]" aria-hidden />
                  <span className="sm:hidden">Add</span>
                  <span className="hidden sm:inline">Add Slide</span>
                </button>
              </div>
            </div>
            <p className="text-[0.65rem] leading-snug text-[var(--text-muted)] sm:text-xs">
              <span className="lg:hidden">Preview at the top shows how cards will look on phones.</span>
              <span className="hidden lg:inline">The phone preview on the right updates as you change slides.</span>
            </p>

            <div className="min-w-0 divide-y divide-[var(--border-color)]/50">
              {draftSlides.map((s, slideIndex) => {
                const isOpen = expandedSlideId === s.id;
                const { title: summaryTitle, subtitle: summarySubtitle } = heroSlideCollapsedSummary(s);
                const slideShown = s.enabled !== false;
                const singleSlide = draftSlides.length === 1;
                const cannotTurnOffLastShown =
                  slideShown && enabled && enabledSlideCount <= 1;
                const perSlideShowLocked =
                  singleSlide && (!enabled || cannotTurnOffLastShown);
                const perSlideShowTitle = perSlideShowLocked
                  ? !enabled
                    ? 'Turn on Advertisements (global) to change Show (per slide) for this slide.'
                    : 'With Advertisements (global) on, this slide must stay visible.'
                  : 'Show (per slide) on the home hero.';
                return (
                <div
                  key={s.id}
                  ref={(el) => {
                    if (el) slideShellRefs.current.set(s.id, el);
                    else slideShellRefs.current.delete(s.id);
                  }}
                  className={`flex flex-col gap-2 py-2.5 sm:flex-row sm:flex-wrap sm:items-stretch sm:gap-2 sm:py-3.5 md:gap-3 ${
                    slideShown ? '' : 'opacity-[0.88]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSlideExpanded(s.id)}
                    aria-expanded={isOpen}
                    aria-label={
                      isOpen
                        ? `Collapse slide ${slideIndex + 1} editor`
                        : `Expand slide ${slideIndex + 1} editor`
                    }
                    className="flex min-h-11 min-w-0 w-full touch-manipulation items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 sm:w-auto sm:flex-1"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                      {isOpen ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-[var(--text-muted)]">
                        Slide {slideIndex + 1}
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-bold text-[var(--text-primary)]">
                        {summaryTitle}
                      </span>
                      <span className="mt-0.5 block truncate text-[0.65rem] text-[var(--text-muted)]">
                        {summarySubtitle}
                      </span>
                    </span>
                  </button>
                  <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-2 sm:w-auto sm:justify-end sm:gap-1">
                    <label
                      htmlFor={`hero-slide-enabled-${s.id}`}
                      className="flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 border-[var(--border-color)]/60 pr-2 sm:mr-1 sm:border-r sm:pr-2"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        id={`hero-slide-enabled-${s.id}`}
                        type="checkbox"
                        checked={slideShown}
                        disabled={perSlideShowLocked}
                        onChange={(e) => updateSlide(slideIndex, { enabled: e.target.checked })}
                        title={perSlideShowTitle}
                        aria-label={`Slide ${slideIndex + 1}: Show (per slide) on home hero`}
                        className="size-[1.125rem] shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme disabled:opacity-40 sm:size-4"
                      />
                      <span className="text-[0.65rem] font-bold leading-tight text-[var(--text-secondary)] sm:hidden">
                        Show
                      </span>
                      <span className="hidden text-xs font-bold leading-snug text-[var(--text-secondary)] sm:inline">
                        Show (per slide)
                      </span>
                    </label>
                    <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
                      <button
                        type="button"
                        disabled={slideIndex === 0}
                        onClick={() => moveSlide(slideIndex, -1)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
                        aria-label="Move slide up"
                      >
                        <ChevronUp size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={slideIndex >= draftSlides.length - 1}
                        onClick={() => moveSlide(slideIndex, 1)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
                        aria-label="Move slide down"
                      >
                        <ChevronDown size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={draftSlides.length <= 1}
                        onClick={() => removeSlide(slideIndex)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[#a1a2a2] hover:bg-[#757676]/12 disabled:opacity-40"
                        aria-label="Remove slide"
                      >
                        <Trash2 size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => resetSlideToTemplate(slideIndex)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] px-2 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] sm:w-auto"
                        title="Replace this slide with starter text and clear link and duration override"
                      >
                        <RotateCcw size={16} aria-hidden />
                        <span className="hidden sm:inline">Reset</span>
                      </button>
                    </div>
                  </div>

                  {isOpen ? (
                  <div className="w-full min-w-0 border-t border-[var(--border-color)] p-3 sm:p-4">
                  <div className="mb-3 grid grid-cols-1 gap-2.5 sm:mb-4 sm:grid-cols-2 lg:[grid-template-columns:1fr_1fr_auto_1fr] sm:gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-h-6 min-w-0 items-center">
                        <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                          Type of Ad
                        </label>
                      </div>
                      <input
                        value={s.label ?? ''}
                        onChange={(e) => updateSlide(slideIndex, { label: e.target.value || undefined })}
                        placeholder="Sponsored"
                        className="w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:font-light placeholder:text-[var(--text-muted)] placeholder:opacity-80"
                        maxLength={79}
                      />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-h-6 min-w-0 items-center">
                        <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                          Gradient
                        </label>
                      </div>
                      <select
                        value={s.gradientPreset}
                        onChange={(e) =>
                          updateSlide(slideIndex, { gradientPreset: e.target.value as HeroPhoneAdGradientPreset })
                        }
                        className="w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                      >
                        {HERO_PHONE_AD_GRADIENT_PRESET_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <AdminLabelInfoTip
                        htmlFor={`hero-ad-slide-dur-${s.id}`}
                        label="Auto-Play"
                        tipId={`hero-ads-tip-slide-dur-${slideIndex}`}
                        tipRegionAriaLabel="Auto-Play tips"
                        tipSubject="Auto-Play"
                      >
                        <li>
                          Leave <strong className="font-semibold text-[var(--text-secondary)]">empty</strong> to use the
                          global default above.
                        </li>
                        <li>
                          <strong className="font-semibold text-[var(--text-secondary)]">0</strong> = stay on this slide
                          until the user swipes (overrides a non-zero default).
                        </li>
                      </AdminLabelInfoTip>
                      <input
                        id={`hero-ad-slide-dur-${s.id}`}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={s.slideDurationSec === undefined ? '' : String(s.slideDurationSec)}
                        onChange={(e) => {
                          const t = e.target.value.trim();
                          if (t === '') {
                            updateSlide(slideIndex, { slideDurationSec: undefined });
                            return;
                          }
                          const n = parseInt(t, 10);
                          if (!Number.isFinite(n)) return;
                          updateSlide(slideIndex, {
                            slideDurationSec: Math.min(HERO_PHONE_AD_MAX_AUTO_SEC, Math.max(0, n)),
                          });
                        }}
                        placeholder="4"
                        className="w-24 max-w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                      />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-h-6 min-w-0 items-center">
                        <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                          Button title
                        </label>
                      </div>
                      <input
                        value={s.linkLabel ?? ''}
                        onChange={(e) =>
                          updateSlide(slideIndex, {
                            linkLabel: e.target.value.trim() === '' ? undefined : e.target.value,
                          })
                        }
                        placeholder="Learn more"
                        className="w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                        maxLength={47}
                      />
                    </div>
                    <div className="min-w-0 space-y-1 sm:col-span-2 lg:col-span-4">
                      <div className="flex min-h-6 min-w-0 items-center">
                        <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                          Link URL (optional)
                        </label>
                      </div>
                      <input
                        value={s.linkUrl ?? ''}
                        onChange={(e) =>
                          updateSlide(slideIndex, {
                            linkUrl: e.target.value.trim() === '' ? undefined : e.target.value,
                          })
                        }
                        placeholder="https://…"
                        className="w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                        maxLength={2000}
                        inputMode="url"
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  <div className="mb-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={s.blocks.length >= MAX_BLOCKS_PER_SLIDE}
                      onClick={() => addTextBlock(slideIndex)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
                    >
                      <Type size={16} aria-hidden />
                      Add text
                    </button>
                    <button
                      type="button"
                      disabled={s.blocks.length >= MAX_BLOCKS_PER_SLIDE}
                      onClick={() => addImageBlock(slideIndex)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
                    >
                      <ImagePlus size={16} aria-hidden />
                      Add image
                    </button>
                    <span className="self-center text-[0.65rem] text-[var(--text-muted)]">
                      {s.blocks.length} / {MAX_BLOCKS_PER_SLIDE} blocks · reorder with arrows
                    </span>
                  </div>

                  <div className="space-y-3">
                    {s.blocks.map((b, blockIndex) => (
                      <div
                        key={`${s.id}-b-${blockIndex}`}
                        className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                            {b.kind === 'text' ? 'Text' : 'Image'} · {blockIndex + 1}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              disabled={blockIndex === 0}
                              onClick={() => moveBlock(slideIndex, blockIndex, -1)}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--border-color)] disabled:opacity-40"
                              aria-label="Move block up"
                            >
                              <ChevronUp size={16} aria-hidden />
                            </button>
                            <button
                              type="button"
                              disabled={blockIndex >= s.blocks.length - 1}
                              onClick={() => moveBlock(slideIndex, blockIndex, 1)}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--border-color)] disabled:opacity-40"
                              aria-label="Move block down"
                            >
                              <ChevronDown size={16} aria-hidden />
                            </button>
                            <button
                              type="button"
                              disabled={s.blocks.length <= 1}
                              onClick={() => removeBlock(slideIndex, blockIndex)}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[#a1a2a2] hover:bg-[#757676]/12 disabled:opacity-40"
                              aria-label="Remove block"
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          </div>
                        </div>

                        {b.kind === 'text' ? (
                          <div className="space-y-2">
                            <div className="space-y-1">
                              <div className="flex min-h-6 min-w-0 items-center">
                                <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                                  Style
                                </label>
                              </div>
                              <select
                                value={b.style ?? 'body'}
                                onChange={(e) =>
                                  replaceBlock(slideIndex, blockIndex, {
                                    kind: 'text',
                                    style: e.target.value as 'headline' | 'body' | 'caption',
                                    content: b.content,
                                  })
                                }
                                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                              >
                                <option value="headline">Headline (large)</option>
                                <option value="body">Body</option>
                                <option value="caption">Caption (small)</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <div className="flex min-h-6 min-w-0 items-center">
                                <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                                  Content
                                </label>
                              </div>
                              <textarea
                                value={b.content}
                                onChange={(e) =>
                                  replaceBlock(slideIndex, blockIndex, {
                                    kind: 'text',
                                    content: e.target.value,
                                    style: b.style ?? 'body',
                                  })
                                }
                                rows={b.style === 'headline' ? 2 : 4}
                                className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                                maxLength={2000}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1 sm:col-span-2">
                              <AdminLabelInfoTip
                                htmlFor={`hero-ad-img-url-${s.id}-${blockIndex}`}
                                label="Image URL"
                                tipId={`hero-ads-tip-img-${s.id}-${blockIndex}`}
                                tipRegionAriaLabel="Image block tips"
                                tipSubject="image URL and layout"
                              >
                                <li>
                                  Use a direct <strong className="font-semibold text-[var(--text-secondary)]">https</strong>{' '}
                                  image URL (saved content must pass validation).
                                </li>
                                <li>
                                  <strong className="font-semibold text-[var(--text-secondary)]">Contain</strong> shows
                                  the whole image; <strong className="font-semibold text-[var(--text-secondary)]">cover</strong>{' '}
                                  fills the area and may crop.
                                </li>
                                <li>
                                  <strong className="font-semibold text-[var(--text-secondary)]">Max height %</strong>{' '}
                                  controls how much of the card height the image uses.
                                </li>
                                <li>
                                  Optional <strong className="font-semibold text-[var(--text-secondary)]">overlay</strong>{' '}
                                  headline and subtext draw on top of the image.
                                </li>
                              </AdminLabelInfoTip>
                              <input
                                id={`hero-ad-img-url-${s.id}-${blockIndex}`}
                                value={b.url}
                                onChange={(e) =>
                                  replaceBlock(slideIndex, blockIndex, {
                                    kind: 'image',
                                    url: e.target.value,
                                    fit: b.fit,
                                    maxHeightPct: b.maxHeightPct,
                                    overlayHeadline: b.overlayHeadline,
                                    overlayBody: b.overlayBody,
                                  })
                                }
                                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                                maxLength={2000}
                                inputMode="url"
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex min-h-6 min-w-0 items-center">
                                <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                                  How image fits
                                </label>
                              </div>
                              <select
                                value={b.fit}
                                onChange={(e) => {
                                  const fit = e.target.value;
                                  if (!isHeroAdImageFit(fit)) return;
                                  replaceBlock(slideIndex, blockIndex, {
                                    kind: 'image',
                                    url: b.url,
                                    fit,
                                    maxHeightPct: b.maxHeightPct,
                                    overlayHeadline: b.overlayHeadline,
                                    overlayBody: b.overlayBody,
                                  });
                                }}
                                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                              >
                                {HERO_AD_IMAGE_FIT_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <div className="flex min-h-6 min-w-0 items-center">
                                <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                                  Max height (% of card)
                                </label>
                              </div>
                              <input
                                type="number"
                                min={20}
                                max={100}
                                value={b.maxHeightPct ?? 75}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10);
                                  replaceBlock(slideIndex, blockIndex, {
                                    kind: 'image',
                                    url: b.url,
                                    fit: b.fit,
                                    maxHeightPct: Number.isFinite(n) ? n : 75,
                                    overlayHeadline: b.overlayHeadline,
                                    overlayBody: b.overlayBody,
                                  });
                                }}
                                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <div className="flex min-h-6 min-w-0 items-center">
                                <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                                  Text on image — headline (optional)
                                </label>
                              </div>
                              <input
                                value={b.overlayHeadline ?? ''}
                                onChange={(e) =>
                                  replaceBlock(slideIndex, blockIndex, {
                                    kind: 'image',
                                    url: b.url,
                                    fit: b.fit,
                                    maxHeightPct: b.maxHeightPct,
                                    overlayHeadline: e.target.value || undefined,
                                    overlayBody: b.overlayBody,
                                  })
                                }
                                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                                maxLength={199}
                              />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <div className="flex min-h-6 min-w-0 items-center">
                                <label className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                                  Text on image — subtext (optional)
                                </label>
                              </div>
                              <textarea
                                value={b.overlayBody ?? ''}
                                onChange={(e) =>
                                  replaceBlock(slideIndex, blockIndex, {
                                    kind: 'image',
                                    url: b.url,
                                    fit: b.fit,
                                    maxHeightPct: b.maxHeightPct,
                                    overlayHeadline: b.overlayHeadline,
                                    overlayBody: e.target.value || undefined,
                                  })
                                }
                                rows={2}
                                className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                                maxLength={599}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  </div>
                  ) : null}
                </div>
              );
              })}
            </div>

            <div className="sticky bottom-0 z-[5] mt-2 flex flex-col gap-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_-8px_rgba(39,40,40,0.14)] backdrop-blur-sm sm:static sm:z-0 sm:mt-0 sm:flex-row sm:flex-wrap sm:border-0 sm:bg-transparent sm:py-0 sm:pt-2 sm:shadow-none sm:backdrop-blur-none app-dark:shadow-[0_-4px_24px_-8px_rgba(39,40,40,0.45)]">
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
                className="min-h-11 flex-1 rounded-xl bg-[#616161] px-4 py-2.5 text-sm font-bold text-[#e7e7e7] shadow-sm hover:bg-[#757676] disabled:pointer-events-none disabled:opacity-50 sm:flex-none sm:py-3 sm:px-8 sm:shadow-none"
              >
                {saving ? 'Saving…' : 'Save to Firestore'}
              </button>
              <button
                type="button"
                disabled={!dirty}
                onClick={handleDiscard}
                className="min-h-11 flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-50 sm:flex-none sm:bg-transparent sm:py-3 sm:px-6"
              >
                Discard Changes
              </button>
            </div>
          </div>

          <aside className="order-1 flex min-w-0 flex-col lg:sticky lg:top-24 lg:order-2 lg:self-start">
            <div className="w-full min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-2 shadow-sm ring-1 ring-[var(--border-color)]/40 sm:p-4">
              <p className="mb-1.5 text-center text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--text-muted)] sm:mb-2 sm:text-xs sm:normal-case sm:tracking-normal sm:text-[var(--text-secondary)] lg:text-center">
                Live Preview
              </p>
              <div className="mx-auto w-full max-w-[min(100%,280px)] min-w-0 sm:max-w-[300px] lg:max-w-none">
                <PhoneMockupAdRail
                  imageSrc={phoneMockupSrc}
                  imageAlt="Preview: home hero phone"
                  slides={previewSlides}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {saveErrorDialog && (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-[#272828]/75 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-sm sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hero-ads-save-error-title"
            aria-describedby="hero-ads-save-error-desc"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeSaveErrorDialog();
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] p-4 sm:p-6">
                <h2
                  id="hero-ads-save-error-title"
                  className="text-lg font-bold text-[var(--text-primary)] sm:text-xl"
                >
                  Couldn’t save to Firestore
                </h2>
                <button
                  type="button"
                  onClick={closeSaveErrorDialog}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} className="text-[var(--text-secondary)]" aria-hidden />
                </button>
              </div>
              <div id="hero-ads-save-error-desc" className="space-y-3 p-4 text-sm leading-relaxed text-[var(--text-secondary)] sm:p-6">
                {saveErrorDialog.code === 'permission-denied' ? (
                  <>
                    <p>
                      Firebase blocked this write (missing or insufficient permissions). That usually means security
                      rules don’t allow your account to update this document, or rules were published to a{' '}
                      <strong className="font-semibold text-[var(--text-primary)]">different</strong> Firestore database
                      than the one this app uses.
                    </p>
                    <p>
                      In Firebase Console, open <strong className="font-semibold text-[var(--text-primary)]">Firestore</strong>
                      , select the <strong className="font-semibold text-[var(--text-primary)]">same database</strong> the
                      app is configured for (not only the default), then <strong className="font-semibold text-[var(--text-primary)]">Rules</strong>
                      , paste the project’s <code className="rounded bg-[var(--hover-bg)] px-1 py-0.5 text-xs">firestore.rules</code>
                      , and publish. Ensure your user has admin access per those rules.
                    </p>
                  </>
                ) : (
                  <p>{saveErrorDialog.message?.trim() || 'Something went wrong while saving. Try again in a moment.'}</p>
                )}
                {saveErrorDialog.code && saveErrorDialog.code !== 'permission-denied' ? (
                  <p className="font-mono text-xs text-[var(--text-muted)]">Code: {saveErrorDialog.code}</p>
                ) : null}
              </div>
              <div className="border-t border-[var(--border-color)] p-4 sm:flex sm:justify-end sm:p-6">
                <button
                  type="button"
                  autoFocus
                  onClick={closeSaveErrorDialog}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#757676] sm:w-auto"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resetDefaultsDialogOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-[#272828]/75 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-sm sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hero-ads-reset-defaults-title"
            aria-describedby="hero-ads-reset-defaults-desc"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeResetDefaultsDialog();
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] p-4 sm:p-6">
                <h2
                  id="hero-ads-reset-defaults-title"
                  className="text-lg font-bold text-[var(--text-primary)] sm:text-xl"
                >
                  Replace draft slides?
                </h2>
                <button
                  type="button"
                  onClick={closeResetDefaultsDialog}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} className="text-[var(--text-secondary)]" aria-hidden />
                </button>
              </div>
              <div id="hero-ads-reset-defaults-desc" className="p-4 text-sm leading-relaxed text-[var(--text-secondary)] sm:p-6">
                <p>
                  Replace all draft slides with the three i-Golden default cards? Your current draft will be
                  overwritten until you save.
                </p>
              </div>
              <div className="flex flex-col gap-3 border-t border-[var(--border-color)] p-4 sm:flex-row sm:justify-end sm:gap-3 sm:p-6">
                <button
                  type="button"
                  autoFocus
                  onClick={confirmResetDefaults}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#757676] sm:w-auto"
                >
                  Replace with defaults
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {actionToast}
    </>
  );
};
