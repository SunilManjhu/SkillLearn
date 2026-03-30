import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Megaphone,
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
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { loadHeroPhoneAdsForAdmin, saveHeroPhoneAdsAsAdmin } from '../../utils/heroPhoneAdsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

const MAX_BLOCKS_PER_SLIDE = 10;

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
  }));
}

function slidesEqual(a: HeroPhoneAdSlideStored[], b: HeroPhoneAdSlideStored[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
  const { showActionToast, actionToast } = useAdminActionToast();
  const [saveErrorDialog, setSaveErrorDialog] = useState<{ code?: string; message?: string } | null>(null);
  const [resetDefaultsDialogOpen, setResetDefaultsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [draftSlides, setDraftSlides] = useState<HeroPhoneAdSlideStored[]>(() =>
    cloneStoredSlides(INITIAL_STORED_HERO_PHONE_ADS)
  );
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [savedSlides, setSavedSlides] = useState<HeroPhoneAdSlideStored[]>(() =>
    cloneStoredSlides(INITIAL_STORED_HERO_PHONE_ADS)
  );
  const [draftDefaultSec, setDraftDefaultSec] = useState(0);
  const [savedDefaultSec, setSavedDefaultSec] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const doc = await loadHeroPhoneAdsForAdmin();
    if (doc) {
      setEnabled(doc.enabled);
      setSavedEnabled(doc.enabled);
      const def = doc.defaultSlideDurationSec ?? 0;
      setDraftDefaultSec(def);
      setSavedDefaultSec(def);
      const cl = cloneStoredSlides(doc.slides);
      setDraftSlides(cl);
      setSavedSlides(cl);
    } else {
      const seed = cloneStoredSlides(INITIAL_STORED_HERO_PHONE_ADS);
      setEnabled(false);
      setSavedEnabled(false);
      setDraftDefaultSec(0);
      setSavedDefaultSec(0);
      setDraftSlides(seed);
      setSavedSlides(cloneStoredSlides(seed));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const previewSlides = useMemo(
    () => draftSlides.map((s) => storedSlideToRailSlide(s, draftDefaultSec)),
    [draftSlides, draftDefaultSec]
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
    setDraftSlides((prev) => {
      if (prev.length >= 8) return prev;
      return [
        ...prev,
        {
          id: newSlideId(),
          label: 'Sponsored',
          gradientPreset: 'cyan_blue' as HeroPhoneAdGradientPreset,
          blocks: [
            { kind: 'text', style: 'headline', content: 'New headline' },
            { kind: 'text', style: 'body', content: 'Short promo copy for learners.' },
          ],
        },
      ];
    });
  };

  const removeSlide = (index: number) => {
    setDraftSlides((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
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
      };
      return next;
    });
  };

  const validateBeforeSave = (): boolean => {
    const def = Math.round(draftDefaultSec);
    if (!Number.isFinite(def) || def < 0 || def > HERO_PHONE_AD_MAX_AUTO_SEC) {
      showActionToast(`Default duration must be 0–${HERO_PHONE_AD_MAX_AUTO_SEC} seconds.`, 'danger');
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
        showActionToast(`Per-slide duration must be 0–${HERO_PHONE_AD_MAX_AUTO_SEC} or left empty.`, 'danger');
        return false;
      }
    }
    return true;
  };

  const closeSaveErrorDialog = useCallback(() => setSaveErrorDialog(null), []);
  const closeResetDefaultsDialog = useCallback(() => setResetDefaultsDialogOpen(false), []);
  const confirmResetDefaults = useCallback(() => {
    setDraftSlides(cloneStoredSlides(INITIAL_STORED_HERO_PHONE_ADS));
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
        blocks: cloneBlocks(s.blocks),
      })),
    });
    setSaving(false);
    if (result.ok) {
      setSavedEnabled(enabled);
      setSavedDefaultSec(draftDefaultSec);
      setSavedSlides(cloneStoredSlides(draftSlides));
      showActionToast('Home hero phone ads saved.');
    } else {
      setSaveErrorDialog({ code: result.code, message: result.message });
    }
  };

  const handleDiscard = () => {
    setEnabled(savedEnabled);
    setDraftDefaultSec(savedDefaultSec);
    setDraftSlides(cloneStoredSlides(savedSlides));
  };

  const handleResetSlidesToBundledDefaults = () => {
    setResetDefaultsDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-muted)]">
        Loading hero ads…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
          <Megaphone size={20} className="text-orange-500" aria-hidden />
          Home hero — phone ads
        </h2>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          Build each card from ordered <strong>text</strong> and <strong>image</strong> blocks (add text after an image,
          etc.). For images, choose <strong>contain</strong> to show the whole picture, <strong>cover</strong> to crop and
          fill, and adjust <strong>max height %</strong> so the image uses more of the card. Optional{' '}
          <strong>overlay</strong> lines draw text on top of that image.
        </p>

        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Timer size={18} className="mt-0.5 shrink-0 text-orange-500" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-xs font-semibold text-[var(--text-secondary)]" htmlFor="hero-ad-default-sec">
                Default auto-advance (seconds)
              </label>
              <p className="text-[0.65rem] text-[var(--text-muted)]">
                <strong>0</strong> = swipe only (no timer). Otherwise the home hero carousel advances each slide after this
                many seconds. Per-slide overrides below. Respects <strong>reduced motion</strong> (no auto-advance).
              </p>
            </div>
          </div>
          <input
            id="hero-ad-default-sec"
            type="number"
            min={0}
            max={HERO_PHONE_AD_MAX_AUTO_SEC}
            value={draftDefaultSec}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) {
                setDraftDefaultSec(0);
                return;
              }
              setDraftDefaultSec(Math.min(HERO_PHONE_AD_MAX_AUTO_SEC, Math.max(0, n)));
            }}
            className="w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] sm:w-28"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border-color)] text-orange-500 focus:ring-orange-500"
          />
          <span className="min-w-0 text-sm">
            <span className="font-bold text-[var(--text-primary)]">Use custom ads on the home page</span>
            <span className="mt-1 block text-[var(--text-muted)]">
              Uncheck to fall back to default sample content (your draft below is kept).
            </span>
          </span>
        </label>

        <div className="mt-6 grid grid-cols-1 gap-6 border-t border-[var(--border-color)] pt-6 lg:grid-cols-[minmax(0,1fr)_min(100%,280px)] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="order-2 min-w-0 space-y-3 lg:order-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Slides ({draftSlides.length} / 8)</h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetSlidesToBundledDefaults}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                >
                  <RotateCcw size={18} aria-hidden />
                  Default 3 slides
                </button>
                <button
                  type="button"
                  disabled={draftSlides.length >= 8}
                  onClick={addSlide}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-orange-500/15 px-3 py-2 text-sm font-bold text-orange-600 hover:bg-orange-500/25 disabled:pointer-events-none disabled:opacity-40 dark:text-orange-400"
                >
                  <Plus size={18} aria-hidden />
                  Add slide
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {draftSlides.map((s, slideIndex) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-muted)]">Slide {slideIndex + 1}</span>
                    <div className="flex flex-wrap items-center gap-1">
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
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                        aria-label="Remove slide"
                      >
                        <Trash2 size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => resetSlideToTemplate(slideIndex)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border-color)] px-2 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                        title="Replace this slide with starter text and clear link and duration override"
                      >
                        <RotateCcw size={16} aria-hidden />
                        Reset slide
                      </button>
                    </div>
                  </div>

                  <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">Label (optional)</label>
                      <input
                        value={s.label ?? ''}
                        onChange={(e) => updateSlide(slideIndex, { label: e.target.value || undefined })}
                        placeholder="Sponsored"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                        maxLength={79}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">Gradient</label>
                      <select
                        value={s.gradientPreset}
                        onChange={(e) =>
                          updateSlide(slideIndex, { gradientPreset: e.target.value as HeroPhoneAdGradientPreset })
                        }
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                      >
                        {HERO_PHONE_AD_GRADIENT_PRESET_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">Link URL (optional)</label>
                      <input
                        value={s.linkUrl ?? ''}
                        onChange={(e) =>
                          updateSlide(slideIndex, {
                            linkUrl: e.target.value.trim() === '' ? undefined : e.target.value,
                          })
                        }
                        placeholder="https://…"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                        maxLength={2000}
                        inputMode="url"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">
                        Button label (optional)
                      </label>
                      <input
                        value={s.linkLabel ?? ''}
                        onChange={(e) =>
                          updateSlide(slideIndex, {
                            linkLabel: e.target.value.trim() === '' ? undefined : e.target.value,
                          })
                        }
                        placeholder="Learn more"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                        maxLength={47}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">
                        Auto-advance override (optional)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={HERO_PHONE_AD_MAX_AUTO_SEC}
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
                        placeholder={
                          draftDefaultSec === 0 ? 'Default (off — swipe only)' : `Default (${draftDefaultSec}s)`
                        }
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                      />
                      <p className="text-[0.65rem] text-[var(--text-muted)]">
                        Leave empty to use the default above. <strong>0</strong> = stay on this slide until the user
                        swipes (overrides a non-zero default).
                      </p>
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
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                              aria-label="Remove block"
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          </div>
                        </div>

                        {b.kind === 'text' ? (
                          <div className="space-y-2">
                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-[var(--text-secondary)]">Style</label>
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
                              <label className="text-xs font-semibold text-[var(--text-secondary)]">Content</label>
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
                              <label className="text-xs font-semibold text-[var(--text-secondary)]">Image URL</label>
                              <input
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
                              <label className="text-xs font-semibold text-[var(--text-secondary)]">How image fits</label>
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
                              <label className="text-xs font-semibold text-[var(--text-secondary)]">
                                Max height (% of card)
                              </label>
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
                              <label className="text-xs font-semibold text-[var(--text-secondary)]">
                                Text on image — headline (optional)
                              </label>
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
                              <label className="text-xs font-semibold text-[var(--text-secondary)]">
                                Text on image — subtext (optional)
                              </label>
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
              ))}
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
                className="min-h-11 flex-1 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:pointer-events-none disabled:opacity-50 sm:flex-none sm:px-8"
              >
                {saving ? 'Saving…' : 'Save to Firestore'}
              </button>
              <button
                type="button"
                disabled={!dirty}
                onClick={handleDiscard}
                className="min-h-11 flex-1 rounded-xl border border-[var(--border-color)] px-4 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-50 sm:flex-none sm:px-6"
              >
                Discard changes
              </button>
            </div>
          </div>

          <aside className="order-1 flex flex-col items-center lg:sticky lg:top-28 lg:order-2 lg:self-start">
            <p className="mb-2 w-full text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] lg:text-center">
              Live preview
            </p>
            <div className="w-full max-w-[260px] sm:max-w-[280px] lg:mx-0 lg:max-w-none">
              <PhoneMockupAdRail
                imageSrc={phoneMockupSrc}
                imageAlt="Preview: home hero phone"
                slides={previewSlides}
              />
            </div>
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {saveErrorDialog && (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-sm sm:items-center sm:p-6"
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
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 sm:w-auto"
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
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-sm sm:items-center sm:p-6"
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
                  Replace all draft slides with the three SkillStream default cards? Your current draft will be
                  overwritten until you save.
                </p>
              </div>
              <div className="flex flex-col gap-3 border-t border-[var(--border-color)] p-4 sm:flex-row sm:justify-end sm:gap-3 sm:p-6">
                <button
                  type="button"
                  onClick={closeResetDefaultsDialog}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={confirmResetDefaults}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 sm:w-auto"
                >
                  Replace with defaults
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {actionToast}
    </div>
  );
};
