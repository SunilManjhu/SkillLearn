/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YOUTUBE_DATA_API_KEY?: string;
  /** Web3Forms access key (recipient email is configured in the Web3Forms dashboard, not in code). */
  readonly VITE_WEB3FORMS_ACCESS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
