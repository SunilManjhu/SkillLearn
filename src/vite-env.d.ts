/// <reference types="vite/client" />

/** Injected by Vite `define` in vite.config.ts from env `GEMINI_API_KEY`. */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly GEMINI_API_KEY?: string;
    /** Injected in vite.config.ts; optional override via .env */
    readonly GEMINI_MODEL?: string;
    /** Comma-separated fallback model ids (order preserved). Injected in vite.config.ts. */
    readonly GEMINI_MODEL_FALLBACK?: string;
  }
}

interface ImportMetaEnv {
  readonly VITE_YOUTUBE_DATA_API_KEY?: string;
  /** Optional: Pexels API key for royalty-free catalog thumbnails (https://www.pexels.com/api/). */
  readonly VITE_PEXELS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
