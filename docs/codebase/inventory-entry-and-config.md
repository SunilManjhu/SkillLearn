# Inventory: entry, shell, types, Vite, Firebase, CSS, rules

## `src/main.tsx`

- **Role:** Browser entry: `scrollRestoration = 'manual'`, mounts `<StrictMode><App /></StrictMode>` and global styles.
- **Primary symbols:** side effects only (no exports).
- **Used by:** Vite HTML entry.

## `src/App.tsx`

- **Role:** Root app shell: views, history/hash sync, catalog and paths, auth, admin gate, notifications, composition of major screens.
- **Primary symbols:** `export default function App`.
- **See:** [../app-shell-app-tsx.md](../app-shell-app-tsx.md).

## `src/firebase.ts`

- **Role:** Firebase app init; exports `auth`, `db`, Google sign-in (`signInWithPopup` with redirect fallback), `isFirestorePermissionDenied`, structured error logging, account deletion helpers.
- **Primary symbols:** `db`, `auth`, `signInWithGoogle`, `isFirestorePermissionDenied`, `deleteCurrentUserAccount`, re-exports of Auth APIs.
- **Config:** Reads [`firebase-applet-config.json`](../../firebase-applet-config.json).

## `src/vite-env.d.ts`

- **Role:** Ambient types for Vite (`ImportMetaEnv`) and `process.env` keys injected for Gemini (`GEMINI_*`).
- **Primary symbols:** `ImportMetaEnv`, `NodeJS.ProcessEnv` augmentation.

## `src/youtube-global.d.ts`

- **Role:** Declares `window.YT` / Player API globals used by YouTube embed integration.
- **Primary symbols:** global interface augmentations.

## `vite.config.ts`

- **Role:** Vite + React + Tailwind plugins; `define` injects `process.env.GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_FALLBACK`; `@` alias to repo root; optional `DISABLE_HMR`.
- **Primary symbols:** `default export` config factory.

## `index.html` (repo root)

- **Role:** Vite HTML shell; **`body`** contains an **inline script** before `#root` that applies **`body.light`** when a cached signed-in user has stored **light** theme (must match [`authProfileCache`](../../src/utils/authProfileCache.ts) + [`uiThemePreference`](../../src/utils/uiThemePreference.ts) key strings). Reduces wrong background before React mounts.
- **Primary symbols:** none (markup + small script).

## `src/index.css`

- **Role:** Global CSS (Tailwind entry, design tokens, base styles). Defines **`@custom-variant app-dark (body:not(.light) &);`** so Tailwind utilities can track **app** light/dark instead of **`prefers-color-scheme`** alone.
- **Primary symbols:** none (stylesheet).

## `firebase-applet-config.json`

- **Role:** Committed Firebase web app config (apiKey, projectId, `firestoreDatabaseId`, etc.) consumed by `src/firebase.ts`.
- **Note:** Treat as non-secret web client config; rules enforce security.

## `firebase.json` / `firestore.indexes.json` / `firebase-blueprint.json` / `metadata.json`

- **Role:** Firebase CLI / hosting / indexes / blueprint metadata for deploy and project structure.
- **Used by:** `npm run deploy:rules` and Firebase tooling (not imported by app runtime).

## `firestore.rules`

- **Role:** Firestore security rules (authorization for all client reads/writes).
- **Debugging:** Permission failures often surface as empty data; see `isFirestorePermissionDenied` in `firebase.ts`.

## `tsconfig.json`

- **Role:** TypeScript compiler options for the project.
- **Used by:** `npm run lint` (`tsc --noEmit`), editor.

## `package.json`

- **Role:** Dependencies, scripts (`dev`, `build`, `lint`, `deploy:rules`).
- **Used by:** npm, CI.
