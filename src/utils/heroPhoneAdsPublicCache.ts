import { isHeroAdImageFit, type PhoneMockupAdBlock, type PhoneMockupAdSlide } from './heroPhoneAdsShared';

const LS_KEY = 'skilllearn.publicHeroPhoneAds.v1';

function isTextBlock(b: Record<string, unknown>): b is Extract<PhoneMockupAdBlock, { kind: 'text' }> {
  return (
    b.kind === 'text' &&
    typeof b.content === 'string' &&
    (b.style === 'headline' || b.style === 'body' || b.style === 'caption')
  );
}

function isImageBlock(b: Record<string, unknown>): b is Extract<PhoneMockupAdBlock, { kind: 'image' }> {
  return (
    b.kind === 'image' &&
    typeof b.url === 'string' &&
    typeof b.fit === 'string' &&
    isHeroAdImageFit(b.fit) &&
    typeof b.maxHeightPct === 'number' &&
    Number.isFinite(b.maxHeightPct)
  );
}

function parseBlock(raw: unknown): PhoneMockupAdBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (isTextBlock(b)) {
    return { kind: 'text', content: b.content, style: b.style };
  }
  if (isImageBlock(b)) {
    return {
      kind: 'image',
      url: b.url,
      fit: b.fit,
      maxHeightPct: b.maxHeightPct,
      ...(typeof b.overlayHeadline === 'string' ? { overlayHeadline: b.overlayHeadline } : {}),
      ...(typeof b.overlayBody === 'string' ? { overlayBody: b.overlayBody } : {}),
    };
  }
  return null;
}

function parseSlidesJson(raw: string): PhoneMockupAdSlide[] | null {
  let v: unknown;
  try {
    v = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return null;
  const out: PhoneMockupAdSlide[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length < 1 || o.id.length >= 120) return null;
    if (typeof o.gradient !== 'string') return null;
    if (typeof o.autoAdvanceSec !== 'number' || !Number.isFinite(o.autoAdvanceSec)) return null;
    if (!Array.isArray(o.blocks) || o.blocks.length < 1) return null;
    const blocks: PhoneMockupAdBlock[] = [];
    for (const bl of o.blocks) {
      const pb = parseBlock(bl);
      if (!pb) return null;
      blocks.push(pb);
    }
    out.push({
      id: o.id,
      ...(typeof o.label === 'string' && o.label.length > 0 ? { label: o.label } : {}),
      gradient: o.gradient,
      ...(typeof o.linkUrl === 'string' && o.linkUrl.length > 0 ? { linkUrl: o.linkUrl } : {}),
      ...(typeof o.linkLabel === 'string' && o.linkLabel.length > 0 ? { linkLabel: o.linkLabel } : {}),
      blocks,
      autoAdvanceSec: o.autoAdvanceSec,
    });
  }
  return out;
}

/** Last published hero slides (same shape as `subscribeHeroPhoneAdsForPublic` emits). Used for instant first paint. */
export function readPublicHeroPhoneAdsCache(): PhoneMockupAdSlide[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw == null || raw === '') return null;
    return parseSlidesJson(raw);
  } catch {
    return null;
  }
}

export function writePublicHeroPhoneAdsCache(slides: PhoneMockupAdSlide[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (slides.length === 0) {
      window.localStorage.removeItem(LS_KEY);
      return;
    }
    window.localStorage.setItem(LS_KEY, JSON.stringify(slides));
  } catch {
    // Quota or private mode
  }
}
