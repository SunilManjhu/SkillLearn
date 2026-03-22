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
