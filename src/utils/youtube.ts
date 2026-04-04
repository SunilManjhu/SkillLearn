let iframeApiPromise: Promise<void> | null = null;

export function loadYoutubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } finally {
        resolve();
      }
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => reject(new Error('Failed to load YouTube iframe API'));
    document.head.appendChild(tag);
  });

  return iframeApiPromise;
}

const ID_RE = /^[\w-]{11}$/;

export function youtubeVideoIdFromUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url, 'https://example.com');
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id && ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.slice('/embed/'.length).split('/')[0];
        return id && ID_RE.test(id) ? id : null;
      }
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.slice('/shorts/'.length).split('/')[0];
        return id && ID_RE.test(id) ? id : null;
      }
      const v = u.searchParams.get('v');
      return v && ID_RE.test(v) ? v : null;
    }
  } catch {
    /* ignore */
  }
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m && ID_RE.test(m[1]) ? m[1] : null;
}

export function youtubeUrlToEmbedUrl(url: string | undefined | null): string | undefined {
  const id = youtubeVideoIdFromUrl(url);
  if (!id) return undefined;
  return `https://www.youtube.com/embed/${id}`;
}

/** Default caption track language for embeds (`cc_lang_pref`) and `setOption('captions','track',...)`. */
export const YOUTUBE_CC_LANG_PREF = 'en';

const YOUTUBE_CC_PREF_STORAGE_KEY = 'skilllearn-youtube-cc-enabled';
const YOUTUBE_CC_LANG_STORAGE_KEY = 'skilllearn-youtube-cc-lang';

export function readYoutubeCaptionLang(): string {
  if (typeof window === 'undefined') return YOUTUBE_CC_LANG_PREF;
  try {
    const v = window.localStorage.getItem(YOUTUBE_CC_LANG_STORAGE_KEY);
    if (v && v.length >= 2 && v.length <= 24) return v;
  } catch {
    /* ignore */
  }
  return YOUTUBE_CC_LANG_PREF;
}

export function writeYoutubeCaptionLang(code: string): void {
  try {
    window.localStorage.setItem(YOUTUBE_CC_LANG_STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
}

/** Captions default off; only `localStorage` value `'1'` turns them on (see `writeYoutubeCaptionsPreference`). */
export function readYoutubeCaptionsPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(YOUTUBE_CC_PREF_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeYoutubeCaptionsPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(YOUTUBE_CC_PREF_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const PLAYER_VOLUME_STORAGE_KEY = 'skilllearn-player-volume';
const PLAYER_MUTED_STORAGE_KEY = 'skilllearn-player-muted';

const DEFAULT_PLAYER_VOLUME_PCT = 100;

/** Last video volume slider level (0–100), shared by YouTube embed and native `<video>`. */
export function readPlayerVolumePreference(): number {
  if (typeof window === 'undefined') return DEFAULT_PLAYER_VOLUME_PCT;
  try {
    const raw = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
    if (raw == null) return DEFAULT_PLAYER_VOLUME_PCT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_PLAYER_VOLUME_PCT;
    return Math.max(0, Math.min(100, Math.round(n)));
  } catch {
    return DEFAULT_PLAYER_VOLUME_PCT;
  }
}

export function writePlayerVolumePreference(volume0to100: number): void {
  try {
    const v = Math.max(0, Math.min(100, Math.round(volume0to100)));
    window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(v));
  } catch {
    /* ignore */
  }
}

export function readPlayerMutedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PLAYER_MUTED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writePlayerMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(PLAYER_MUTED_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Toggle captions via IFrame API (HTML5 player: `captions` module; Flash-era `cc` is unloaded too).
 * @see https://stackoverflow.com/a/23280344 (undocumented but commonly used)
 */
export function applyYoutubeCaptionsModule(
  player: {
    loadModule?: (name: string) => void;
    unloadModule?: (name: string) => void;
    setOption?: (module: string, option: string, value: unknown) => void;
  } | null,
  enabled: boolean,
  langCode: string
): void {
  if (!player) return;
  try {
    if (enabled) {
      player.loadModule?.('captions');
      try {
        player.setOption?.('captions', 'track', { languageCode: langCode });
      } catch {
        /* track may not apply until the captions module is ready */
      }
    } else {
      /* Clear active track first; `cc_lang_pref` alone can leave captions visible until this runs. */
      try {
        player.setOption?.('captions', 'track', {});
      } catch {
        /* ignore */
      }
      try {
        player.setOption?.('cc', 'track', {});
      } catch {
        /* ignore */
      }
      try {
        player.unloadModule?.('captions');
      } catch {
        /* ignore */
      }
      try {
        player.unloadModule?.('cc');
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Subtitle languages for YouTube-style settings (matches common YouTube UI labels; codes for `setOption` track).
 */
export const YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS: readonly { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish (Latin America)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'hi', label: 'Hindi' },
  { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'ru', label: 'Russian' },
  { code: 'th', label: 'Thai' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' },
];

export function labelForYoutubeCaptionLang(code: string): string {
  const row = YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS.find((o) => o.code === code);
  return row?.label ?? code;
}

/**
 * Embed URL for `<iframe src>` (e.g. customize modal preview). Matches `playerVars` on `YT.Player`
 * in CoursePlayer except `autoplay`, which is set per instance.
 */
export function youtubeEmbedSrcForVideoId(id: string): string {
  const captionsOn =
    typeof window !== 'undefined' ? readYoutubeCaptionsPreference() : false;
  const q = new URLSearchParams({
    controls: '0',
    disablekb: '1',
    fs: '0',
    modestbranding: '1',
    rel: '0',
  });
  /** Omit `cc_lang_pref` when off — with some accounts it still nudges captions on even with cc_load_policy=0. */
  if (captionsOn) {
    const langPref =
      typeof window !== 'undefined' ? readYoutubeCaptionLang() : YOUTUBE_CC_LANG_PREF;
    q.set('cc_lang_pref', langPref);
    q.set('cc_load_policy', '1');
  } else {
    q.set('cc_load_policy', '0');
  }
  return `https://www.youtube.com/embed/${id}?${q.toString()}`;
}

/** Opens YouTube search in a new tab (no Data API). */
export function youtubeSearchResultsUrl(searchQuery: string): string {
  const q = searchQuery.trim() || 'video';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}
