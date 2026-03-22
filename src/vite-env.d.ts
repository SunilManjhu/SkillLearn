/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YOUTUBE_DATA_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
