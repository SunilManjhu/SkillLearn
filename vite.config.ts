import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      /** Must match a model id from the Gemini API (see ListModels). Not valid: gemini-1.5-flash on v1beta. */
      'process.env.GEMINI_MODEL': JSON.stringify(
        env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash'
      ),
      /** Comma-separated model ids; tried in order after quota/rate-limit on GEMINI_MODEL. */
      'process.env.GEMINI_MODEL_FALLBACK': JSON.stringify(env.GEMINI_MODEL_FALLBACK?.trim() || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
