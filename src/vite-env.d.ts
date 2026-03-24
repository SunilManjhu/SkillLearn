/// <reference types="vite/client" />

/** Injected by Vite `define` in vite.config.ts from env `GEMINI_API_KEY`. */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly GEMINI_API_KEY?: string;
    /** Injected in vite.config.ts; optional override via .env */
    readonly GEMINI_MODEL?: string;
  }
}

interface ImportMetaEnv {
  readonly VITE_YOUTUBE_DATA_API_KEY?: string;
  /** Web3Forms access key (recipient email is configured in the Web3Forms dashboard, not in code). */
  readonly VITE_WEB3FORMS_ACCESS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
