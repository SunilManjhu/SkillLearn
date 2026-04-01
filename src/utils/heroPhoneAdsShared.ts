/** Ordered content inside one swipe card. */
export type HeroAdBlockStored =
  | { kind: 'text'; content: string; style?: 'headline' | 'body' | 'caption' }
  | {
      kind: 'image';
      url: string;
      fit: 'cover' | 'contain' | 'fill';
      maxHeightPct?: number;
      overlayHeadline?: string;
      overlayBody?: string;
    };

export type PhoneMockupAdBlock =
  | { kind: 'text'; content: string; style: 'headline' | 'body' | 'caption' }
  | {
      kind: 'image';
      url: string;
      fit: 'cover' | 'contain' | 'fill';
      maxHeightPct: number;
      overlayHeadline?: string;
      overlayBody?: string;
    };

/** Runtime slide for the phone rail. */
export interface PhoneMockupAdSlide {
  id: string;
  label?: string;
  gradient: string;
  linkUrl?: string;
  linkLabel?: string;
  blocks: PhoneMockupAdBlock[];
  /** Seconds before auto-advancing; 0 = manual only for this slide. */
  autoAdvanceSec: number;
}

/** Stored in Firestore (block-based or legacy migrated on read). */
export interface HeroPhoneAdSlideStored {
  id: string;
  gradientPreset: HeroPhoneAdGradientPreset;
  label?: string;
  linkUrl?: string;
  linkLabel?: string;
  /** If set (including 0), overrides document default; 0 = no auto-advance on this slide. */
  slideDurationSec?: number;
  /** Omit or `true`: slide is shown when site hero ads are enabled. `false`: hidden from learners (still in draft). */
  enabled?: boolean;
  blocks: HeroAdBlockStored[];
}

/** Stored in Firestore; mapped to Tailwind classes in the client (allowlisted). */
export const HERO_PHONE_AD_GRADIENT_PRESETS = {
  sky_indigo: 'from-sky-600 to-indigo-700',
  violet_fuchsia: 'from-violet-600 to-fuchsia-600',
  emerald_teal: 'from-emerald-600 to-teal-700',
  rose_orange: 'from-rose-600 to-orange-600',
  amber_stone: 'from-amber-500 to-stone-700',
  cyan_blue: 'from-cyan-600 to-blue-700',
} as const;

export type HeroPhoneAdGradientPreset = keyof typeof HERO_PHONE_AD_GRADIENT_PRESETS;

export const HERO_PHONE_AD_GRADIENT_PRESET_OPTIONS: { value: HeroPhoneAdGradientPreset; label: string }[] = [
  { value: 'sky_indigo', label: 'Sky → indigo' },
  { value: 'violet_fuchsia', label: 'Violet → fuchsia' },
  { value: 'emerald_teal', label: 'Emerald → teal' },
  { value: 'rose_orange', label: 'Rose → orange' },
  { value: 'amber_stone', label: 'Amber → stone' },
  { value: 'cyan_blue', label: 'Cyan → blue' },
];

export const HERO_AD_IMAGE_FIT_OPTIONS: { value: 'cover' | 'contain' | 'fill'; label: string }[] = [
  { value: 'contain', label: 'Show whole image (contain)' },
  { value: 'cover', label: 'Fill frame (crop)' },
  { value: 'fill', label: 'Stretch to fill' },
];

export function isHeroPhoneAdGradientPreset(s: string): s is HeroPhoneAdGradientPreset {
  return s in HERO_PHONE_AD_GRADIENT_PRESETS;
}

export function isHeroAdImageFit(s: string): s is 'cover' | 'contain' | 'fill' {
  return s === 'cover' || s === 'contain' || s === 'fill';
}

/** Auto-advance bounds (seconds); 0 = off. */
export const HERO_PHONE_AD_MIN_AUTO_SEC = 1;
export const HERO_PHONE_AD_MAX_AUTO_SEC = 120;

export function clampHeroPhoneAdDurationSec(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  if (r <= 0) return 0;
  return Math.min(HERO_PHONE_AD_MAX_AUTO_SEC, Math.max(HERO_PHONE_AD_MIN_AUTO_SEC, r));
}

/** Resolve per-slide timer: explicit override (including 0) wins; else document default. */
export function effectiveAutoAdvanceSec(defaultSec: number, slideOverride?: number): number {
  if (typeof slideOverride === 'number' && Number.isFinite(slideOverride)) {
    const o = Math.round(slideOverride);
    if (o <= 0) return 0;
    return clampHeroPhoneAdDurationSec(o);
  }
  const d = Math.round(defaultSec);
  if (d <= 0) return 0;
  return clampHeroPhoneAdDurationSec(d);
}

const MAX_OPTIONAL_URL_LEN = 2000;
const MAX_LINK_LABEL_LEN = 47;

/** Client-side guard; must stay aligned with Firestore rules (`isValidUrl`). */
export function isAllowedHeroAdHttpUrl(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t.length > MAX_OPTIONAL_URL_LEN) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeBlock(b: HeroAdBlockStored): PhoneMockupAdBlock | null {
  if (b.kind === 'text') {
    const content = b.content?.trim() ?? '';
    if (!content) return null;
    const style = b.style ?? 'body';
    if (style !== 'headline' && style !== 'body' && style !== 'caption') return null;
    return { kind: 'text', content, style };
  }
  if (b.kind === 'image') {
    const url = b.url?.trim() ?? '';
    if (!url || !isAllowedHeroAdHttpUrl(url)) return null;
    const fit = isHeroAdImageFit(b.fit) ? b.fit : 'contain';
    let maxHeightPct = typeof b.maxHeightPct === 'number' ? Math.round(b.maxHeightPct) : 75;
    if (maxHeightPct < 20) maxHeightPct = 20;
    if (maxHeightPct > 100) maxHeightPct = 100;
    const oh = b.overlayHeadline?.trim();
    const ob = b.overlayBody?.trim();
    return {
      kind: 'image',
      url,
      fit,
      maxHeightPct,
      ...(oh ? { overlayHeadline: oh.slice(0, 200) } : {}),
      ...(ob ? { overlayBody: ob.slice(0, 600) } : {}),
    };
  }
  return null;
}

export function normalizeBlocks(blocks: HeroAdBlockStored[]): PhoneMockupAdBlock[] {
  const out: PhoneMockupAdBlock[] = [];
  for (const b of blocks) {
    const n = normalizeBlock(b);
    if (n) out.push(n);
  }
  return out;
}

/** Default Firestore-shaped slides (admin editor seed + fallback content). */
export const INITIAL_STORED_HERO_PHONE_ADS: HeroPhoneAdSlideStored[] = [
  {
    id: 'ad-1',
    label: 'SkillStream',
    gradientPreset: 'sky_indigo',
    blocks: [
      { kind: 'text', style: 'headline', content: '7,000+ courses at your pace' },
      {
        kind: 'text',
        style: 'body',
        content:
          'Learn software, cloud, data, and security from industry experts. Start free and build skills that matter.',
      },
    ],
  },
  {
    id: 'ad-2',
    label: 'Hands-on',
    gradientPreset: 'violet_fuchsia',
    blocks: [
      { kind: 'text', style: 'headline', content: 'Labs & real projects' },
      {
        kind: 'text',
        style: 'body',
        content:
          'Practice in guided environments—not just videos. Ship portfolio work you can show in interviews.',
      },
    ],
  },
  {
    id: 'ad-3',
    label: 'Your goals',
    gradientPreset: 'emerald_teal',
    blocks: [
      { kind: 'text', style: 'headline', content: 'Certs & career paths' },
      {
        kind: 'text',
        style: 'caption',
        content:
          'Follow structured paths or pick topics à la carte. Track progress on web and mobile.',
      },
    ],
  },
];

export function storedSlideToRailSlide(
  s: HeroPhoneAdSlideStored,
  defaultSlideDurationSec = 0
): PhoneMockupAdSlide {
  const gradient = HERO_PHONE_AD_GRADIENT_PRESETS[s.gradientPreset] ?? HERO_PHONE_AD_GRADIENT_PRESETS.sky_indigo;
  const linkUrl = s.linkUrl?.trim();
  const linkLabel = s.linkLabel?.trim();
  const blocks = normalizeBlocks(s.blocks);
  const safeBlocks =
    blocks.length > 0
      ? blocks
      : [{ kind: 'text' as const, content: 'Add content', style: 'body' as const }];
  const autoAdvanceSec = effectiveAutoAdvanceSec(defaultSlideDurationSec, s.slideDurationSec);
  return {
    id: s.id,
    ...(s.label != null && s.label.trim() !== '' ? { label: s.label.trim() } : {}),
    gradient,
    ...(linkUrl && isAllowedHeroAdHttpUrl(linkUrl)
      ? {
          linkUrl,
          ...(linkLabel && linkLabel.length > 0 && linkLabel.length <= MAX_LINK_LABEL_LEN ? { linkLabel } : {}),
        }
      : {}),
    blocks: safeBlocks,
    autoAdvanceSec,
  };
}

export function slideAriaLabel(s: PhoneMockupAdSlide): string {
  const h = s.blocks.find((b) => b.kind === 'text' && b.style === 'headline');
  if (h && h.kind === 'text') return `${s.label ? `${s.label}: ` : ''}${h.content}`;
  const t = s.blocks.find((b) => b.kind === 'text');
  if (t && t.kind === 'text') return `${s.label ? `${s.label}: ` : ''}${t.content.slice(0, 80)}`;
  return s.label ?? 'Advertisement';
}

/** Shown when Firestore doc is missing, invalid, disabled, or empty. */
export const DEFAULT_HERO_PHONE_AD_SLIDES: PhoneMockupAdSlide[] = INITIAL_STORED_HERO_PHONE_ADS.map((s) =>
  storedSlideToRailSlide(s, 0)
);
