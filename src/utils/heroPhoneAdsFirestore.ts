import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  type HeroAdBlockStored,
  type HeroPhoneAdSlideStored,
  type PhoneMockupAdSlide,
  isAllowedHeroAdHttpUrl,
  isHeroAdImageFit,
  isHeroPhoneAdGradientPreset,
  storedSlideToRailSlide,
} from './heroPhoneAdsShared';
import { writePublicHeroPhoneAdsCache } from './heroPhoneAdsPublicCache';

const COLLECTION = 'siteSettings';
export const HERO_PHONE_ADS_DOC_ID = 'heroPhoneAds';

function parseBlock(raw: unknown): HeroAdBlockStored | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === 'text') {
    const content = o.content;
    if (typeof content !== 'string' || content.trim().length === 0 || content.length > 2000) return null;
    const style = o.style;
    if (style != null && style !== 'headline' && style !== 'body' && style !== 'caption') return null;
    return {
      kind: 'text',
      content: content.trim(),
      ...(typeof style === 'string' ? { style: style as 'headline' | 'body' | 'caption' } : {}),
    };
  }
  if (kind === 'image') {
    const url = o.url;
    if (typeof url !== 'string' || !url.trim() || !isAllowedHeroAdHttpUrl(url.trim())) return null;
    const fitRaw = o.fit;
    const fit = typeof fitRaw === 'string' && isHeroAdImageFit(fitRaw) ? fitRaw : 'contain';
    const mhp = o.maxHeightPct;
    let maxHeightPct: number | undefined;
    if (typeof mhp === 'number' && Number.isFinite(mhp)) {
      maxHeightPct = Math.min(100, Math.max(20, Math.round(mhp)));
    }
    const oh = o.overlayHeadline;
    const ob = o.overlayBody;
    if (oh != null && typeof oh !== 'string') return null;
    if (ob != null && typeof ob !== 'string') return null;
    if (typeof oh === 'string' && oh.length >= 200) return null;
    if (typeof ob === 'string' && ob.length >= 600) return null;
    return {
      kind: 'image',
      url: url.trim(),
      fit,
      ...(maxHeightPct != null ? { maxHeightPct } : {}),
      ...(typeof oh === 'string' && oh.trim() !== '' ? { overlayHeadline: oh.trim() } : {}),
      ...(typeof ob === 'string' && ob.trim() !== '' ? { overlayBody: ob.trim() } : {}),
    };
  }
  return null;
}

function blocksFromLegacyFields(o: Record<string, unknown>): HeroAdBlockStored[] | null {
  const headline = o.headline;
  const body = o.body;
  if (typeof headline !== 'string' || typeof body !== 'string') return null;
  const blocks: HeroAdBlockStored[] = [];
  if (headline.trim()) blocks.push({ kind: 'text', style: 'headline', content: headline.trim() });
  if (body.trim()) blocks.push({ kind: 'text', style: 'body', content: body.trim() });
  const imageUrl = o.imageUrl;
  if (typeof imageUrl === 'string' && imageUrl.trim() && isAllowedHeroAdHttpUrl(imageUrl.trim())) {
    const fitRaw = o.imageFit;
    const fit = typeof fitRaw === 'string' && isHeroAdImageFit(fitRaw) ? fitRaw : 'contain';
    blocks.push({ kind: 'image', url: imageUrl.trim(), fit, maxHeightPct: 75 });
  }
  return blocks.length > 0 ? blocks : null;
}

function parseSlide(raw: unknown): HeroPhoneAdSlideStored | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = o.id;
  const gp = o.gradientPreset;
  if (typeof id !== 'string' || id.length === 0 || id.length >= 120) return null;
  if (typeof gp !== 'string' || !isHeroPhoneAdGradientPreset(gp)) return null;
  const label = o.label;
  if (label != null && typeof label !== 'string') return null;
  if (typeof label === 'string' && label.length >= 80) return null;

  const linkUrlRaw = o.linkUrl;
  if (linkUrlRaw != null && typeof linkUrlRaw !== 'string') return null;
  const linkUrl =
    typeof linkUrlRaw === 'string' && linkUrlRaw.trim() !== '' ? linkUrlRaw.trim() : undefined;
  if (linkUrl != null && !isAllowedHeroAdHttpUrl(linkUrl)) return null;

  const linkLabelRaw = o.linkLabel;
  if (linkLabelRaw != null && typeof linkLabelRaw !== 'string') return null;
  let linkLabel =
    typeof linkLabelRaw === 'string' && linkLabelRaw.trim() !== '' ? linkLabelRaw.trim() : undefined;
  if (linkLabel != null && linkLabel.length >= 48) return null;
  if (linkLabel != null && linkUrl == null) linkLabel = undefined;

  let blocks: HeroAdBlockStored[] | null = null;
  const blocksRaw = o.blocks;
  if (Array.isArray(blocksRaw) && blocksRaw.length > 0) {
    const parsed: HeroAdBlockStored[] = [];
    for (const item of blocksRaw) {
      const b = parseBlock(item);
      if (!b) return null;
      parsed.push(b);
    }
    blocks = parsed;
  }
  if (!blocks || blocks.length === 0) {
    blocks = blocksFromLegacyFields(o);
  }
  if (!blocks || blocks.length === 0) return null;

  const slideDurRaw = o.slideDurationSec;
  let slideDurationSec: number | undefined;
  if (slideDurRaw != null) {
    if (typeof slideDurRaw !== 'number' || !Number.isFinite(slideDurRaw)) return null;
    const r = Math.round(slideDurRaw);
    if (r < 0 || r > 120) return null;
    slideDurationSec = r;
  }

  const enabledRaw = o.enabled;
  if (enabledRaw != null && typeof enabledRaw !== 'boolean') return null;

  return {
    id,
    gradientPreset: gp,
    ...(typeof label === 'string' && label.trim() !== '' ? { label: label.trim() } : {}),
    ...(linkUrl != null ? { linkUrl } : {}),
    ...(linkLabel != null && linkUrl != null ? { linkLabel } : {}),
    ...(slideDurationSec != null ? { slideDurationSec } : {}),
    ...(enabledRaw === false ? { enabled: false } : {}),
    blocks,
  };
}

function parseDefaultSlideDurationSec(data: Record<string, unknown>): number {
  const v = data.defaultSlideDurationSec;
  if (v == null) return 0;
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const r = Math.round(v);
  if (r <= 0) return 0;
  if (r > 120) return 120;
  return r;
}

function parseDocument(
  data: Record<string, unknown> | undefined
): { enabled: boolean; slides: HeroPhoneAdSlideStored[]; defaultSlideDurationSec: number } | null {
  if (!data) return null;
  const enabled = data.enabled;
  if (typeof enabled !== 'boolean') return null;
  const slidesRaw = data.slides;
  if (!Array.isArray(slidesRaw) || slidesRaw.length < 1 || slidesRaw.length > 8) return null;
  const slides: HeroPhoneAdSlideStored[] = [];
  for (const item of slidesRaw) {
    const s = parseSlide(item);
    if (!s) return null;
    slides.push(s);
  }
  const defaultSlideDurationSec = parseDefaultSlideDurationSec(data);
  return { enabled, slides, defaultSlideDurationSec };
}

export function resolvedRailSlidesFromDoc(data: Record<string, unknown> | undefined): PhoneMockupAdSlide[] {
  const parsed = parseDocument(data);
  if (!parsed || !parsed.enabled) return [];
  const activeSlides = parsed.slides.filter((s) => s.enabled !== false);
  if (activeSlides.length === 0) return [];
  return activeSlides.map((s) => storedSlideToRailSlide(s, parsed.defaultSlideDurationSec));
}

export function subscribeHeroPhoneAdsForPublic(
  onSlides: (slides: PhoneMockupAdSlide[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const docRef = doc(db, COLLECTION, HERO_PHONE_ADS_DOC_ID);

  const applySnap = (snap: DocumentSnapshot) => {
    const slides = snap.exists()
      ? resolvedRailSlidesFromDoc(snap.data() as Record<string, unknown>)
      : [];
    writePublicHeroPhoneAdsCache(slides);
    onSlides(slides);
  };

  /** One-shot read often returns as fast as or before the first snapshot listener result — reduces empty-state delay. */
  void getDoc(docRef)
    .then(applySnap)
    .catch((e) => {
      handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${HERO_PHONE_ADS_DOC_ID}`);
      onError?.(e);
    });

  return onSnapshot(
    docRef,
    applySnap,
    (err) => {
      handleFirestoreError(err, OperationType.GET, `${COLLECTION}/${HERO_PHONE_ADS_DOC_ID}`);
      onError?.(err);
      writePublicHeroPhoneAdsCache([]);
      onSlides([]);
    }
  );
}

export async function loadHeroPhoneAdsForAdmin(): Promise<{
  enabled: boolean;
  slides: HeroPhoneAdSlideStored[];
  defaultSlideDurationSec: number;
} | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, HERO_PHONE_ADS_DOC_ID));
    if (!snap.exists()) return null;
    return parseDocument(snap.data() as Record<string, unknown>);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${HERO_PHONE_ADS_DOC_ID}`);
    return null;
  }
}

function serializeBlockForFirestore(b: HeroAdBlockStored): Record<string, unknown> {
  if (b.kind === 'text') {
    return {
      kind: 'text',
      content: b.content.trim(),
      style: b.style ?? 'body',
    };
  }
  const out: Record<string, unknown> = {
    kind: 'image',
    url: b.url.trim(),
    fit: b.fit,
  };
  if (b.maxHeightPct != null) out.maxHeightPct = b.maxHeightPct;
  if (b.overlayHeadline?.trim()) out.overlayHeadline = b.overlayHeadline.trim();
  if (b.overlayBody?.trim()) out.overlayBody = b.overlayBody.trim();
  return out;
}

export type SaveHeroPhoneAdsResult =
  | { ok: true }
  | { ok: false; code?: string; message?: string };

export async function saveHeroPhoneAdsAsAdmin(input: {
  enabled: boolean;
  slides: HeroPhoneAdSlideStored[];
  defaultSlideDurationSec: number;
}): Promise<SaveHeroPhoneAdsResult> {
  if (input.slides.length < 1 || input.slides.length > 8) {
    return { ok: false, message: 'Slide count must be between 1 and 8.' };
  }
  const defaultSec = Math.round(input.defaultSlideDurationSec);
  const safeDefault = defaultSec <= 0 ? 0 : Math.min(120, Math.max(1, defaultSec));
  try {
    await setDoc(doc(db, COLLECTION, HERO_PHONE_ADS_DOC_ID), {
      enabled: input.enabled,
      defaultSlideDurationSec: safeDefault,
      slides: input.slides.map((s) => {
        const linkUrl = s.linkUrl?.trim();
        const linkLabel = s.linkLabel?.trim();
        const sd = s.slideDurationSec;
        return {
          id: s.id.trim(),
          gradientPreset: s.gradientPreset,
          ...(s.label != null && s.label.trim() !== '' ? { label: s.label.trim() } : {}),
          ...(linkUrl && isAllowedHeroAdHttpUrl(linkUrl) ? { linkUrl } : {}),
          ...(linkUrl && linkLabel && linkLabel.length > 0 && linkLabel.length < 48 ? { linkLabel } : {}),
          ...(typeof sd === 'number' && Number.isFinite(sd)
            ? { slideDurationSec: Math.min(120, Math.max(0, Math.round(sd))) }
            : {}),
          ...(s.enabled === false ? { enabled: false } : {}),
          blocks: s.blocks.map(serializeBlockForFirestore),
        };
      }),
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${HERO_PHONE_ADS_DOC_ID}`);
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: string }).code) : undefined;
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, code, message };
  }
}
