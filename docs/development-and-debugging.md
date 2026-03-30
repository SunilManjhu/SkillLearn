# Development and debugging (SkillLearn)

This guide orients **developers** and **AI assistants** on how the app is structured, how to run checks, and where to look when something breaks. Pair it with the root [`README.md`](../README.md) for install steps and with topic-specific notes under [`docs/`](./README.md).

## Stack (at a glance)

| Layer | Technology |
|--------|------------|
| UI | React 19, TypeScript |
| Build | Vite 6, `@vitejs/plugin-react` |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) |
| Motion | `motion` (`motion/react`) |
| Icons | `lucide-react` |
| Drag-and-drop (some surfaces) | `@dnd-kit/*` |
| Backend (client) | Firebase Auth + Firestore (`src/firebase.ts`) |
| Generative AI | `@google/genai` via [`src/utils/geminiClient.ts`](../src/utils/geminiClient.ts) |

The app mounts under **React Strict Mode** in [`src/main.tsx`](../src/main.tsx). In development, effects and some state updaters can run twice; see [admin-reorder-scroll-viewport.md](./admin-reorder-scroll-viewport.md) for a real example (reorder + `flushSync`).

## Run, typecheck, build

```bash
npm install
npm run dev      # Vite dev server, default http://localhost:3000 (--host 0.0.0.0)
npm run lint     # `tsc --noEmit` — no separate ESLint script today
npm run build    # production bundle
npm run preview  # serve dist locally
```

Firebase rules deploy (project-specific script in `package.json`):

```bash
npm run deploy:rules
```

## Environment variables

| Variable | Where | Role |
|----------|--------|------|
| `GEMINI_API_KEY` | `.env` / `.env.local`; injected by Vite `define` as `process.env.GEMINI_API_KEY` | Required for Gemini calls at build/runtime in the client bundle pattern this repo uses. |
| `GEMINI_MODEL` | Same; see [`vite.config.ts`](../vite.config.ts) | Default model id (fallback `gemini-2.5-flash`). |
| `GEMINI_MODEL_FALLBACK` | Same | Comma-separated model ids; used when primary hits quota/rate limits. |
| `VITE_YOUTUBE_DATA_API_KEY` | `.env` with `VITE_` prefix | Optional; enables YouTube Data API prefetch for lesson durations ([`src/utils/youtubeDataApi.ts`](../src/utils/youtubeDataApi.ts), [`src/vite-env.d.ts`](../src/vite-env.d.ts)). |
| `DISABLE_HMR` | Environment | When `true`, Vite HMR is off (used in embedded / AI Studio–style environments to reduce flicker). |
| `APP_URL` | Documented in [`.env.example`](../.env.example) | Hosting URL / callbacks where applicable. |

See [`.env.example`](../.env.example) for copy-paste templates and comments.

**Model debugging:** Invalid or retired model strings often surface as API 404s. [`vite.config.ts`](../vite.config.ts) comments note that ids must match the current Gemini API (e.g. avoid assuming `gemini-1.5-flash` on v1beta). Admin-configured models live in Firestore (`siteSettings/geminiAiModels`); the client resolves the chain in [`getResolvedGeminiModelChain`](../src/utils/geminiModelSettingsFirestore.ts) (used from [`geminiClient.ts`](../src/utils/geminiClient.ts)).

## Repository layout (where logic lives)

| Area | Path | Notes |
|------|------|--------|
| Shell / navigation / most view state | [`src/App.tsx`](../src/App.tsx) | Large file: catalog, player, profile, admin gate, alerts, enrollments, etc. **See [app-shell-app-tsx.md](./app-shell-app-tsx.md) for a structured map.** |
| URL ↔ state | [`src/utils/appHistory.ts`](../src/utils/appHistory.ts) | Hash + `history.state` under `APP_HISTORY_KEY` (`skillstreamApp`). Payload shape `AppHistoryPayload` (`view`, `courseId`, `lessonId`, `adminTab`, `learningPathId`, …). |
| Firebase bootstrap | [`src/firebase.ts`](../src/firebase.ts) | `auth`, `db`, Google sign-in (popup → redirect fallback), `isFirestorePermissionDenied`. Config: [`firebase-applet-config.json`](../firebase-applet-config.json). |
| Firestore access | [`src/utils/*Firestore.ts`](../src/utils/) | One file per domain (courses, paths, progress, moderation, …). Good search anchor: `Firestore.ts`. |
| Static / fallback catalog data | [`src/data/`](../src/data/) | e.g. `courses.ts`, `learningPaths.ts` — used with published Firestore data. |
| Admin UI | [`src/components/AdminPage.tsx`](../src/components/AdminPage.tsx), [`src/components/admin/`](../src/components/admin/) | Tabs: `alerts`, `ai`, `catalog` (UI label **Content**), `moderation`, `roles`. Deep dive: [admin-portal-content.md](./admin-portal-content.md). |
| Learner UI | [`src/components/`](../src/components/) | e.g. `CoursePlayer`, `CourseOverview`, `LearnerPathMindmapPanel`. |
| Shared hooks | [`src/hooks/`](../src/hooks/) | Scroll lock, dialogs, FAB visibility, YouTube helpers, etc. Confirmations: [patterns-in-app-confirmation-dialog.md](./patterns-in-app-confirmation-dialog.md). |

When searching the codebase semantically, phrases like “Firestore subscription”, “admin catalog draft”, or “history payload” usually land faster than component names alone.

## Navigation and deep links

- **Views** are a closed union (e.g. `home`, `catalog`, `player`, `admin`) — see `View` in `App.tsx` and `AppHistoryView` in `appHistory.ts`.
- **Admin sub-tabs** are `AdminHistoryTab`: `alerts` | `ai` | `catalog` | `moderation` | `roles`. The **Content** tab uses `adminTab === 'catalog'`; canonical hash `#/admin/content` (see [admin-portal-content.md](./admin-portal-content.md)).
- **Learning path scoping** can be carried in history as `learningPathId` for shareable catalog context.

If “wrong screen after refresh” or “shared link opens wrong place” appears, trace `parseHashToPayload` / `buildHistoryUrl` and `popstate` handling in `App.tsx` together with `appHistory.ts`.

## Firebase and permissions

- **Permission errors:** Many call sites use [`isFirestorePermissionDenied`](../src/firebase.ts) to treat rules denials as empty data or to avoid noisy logging. If reads “return nothing” for signed-in users, verify [`firestore.rules`](../firestore.rules) and custom claims / role docs (`userProfileFirestore`, `adminUsersFirestore`).
- **Sign-in:** Popup blocked or unsupported environments fall back to full-page redirect; return context can be stashed via [`authReturnContext.ts`](../src/utils/authReturnContext.ts).

## Gemini and learning assistant

- Entry: [`generateContentWithModelChain`](../src/utils/geminiClient.ts) — tries models in order until success or non-retryable error.
- Retryable errors: [`formatGenaiError.ts`](../src/utils/formatGenaiError.ts) (`isRetryableQuotaError`).
- Site toggles / model lists: Firestore + hooks under `learningAssistant*`, `learnerGemini*`, `geminiModel*`.

**Symptoms:** “No models enabled” → admin AI settings or empty enabled chain. Repeated fallback warnings in console → quota; check model list and `GEMINI_MODEL_FALLBACK`.

## YouTube

- Embeds and caption prefs: [`src/utils/youtube.ts`](../src/utils/youtube.ts).
- Optional duration resolution: `VITE_YOUTUBE_DATA_API_KEY` + [`youtubeDataApi.ts`](../src/utils/youtubeDataApi.ts).

## UI conventions (mobile)

The workspace rule **mobile-first** applies: assume phone-width layouts unless the task says otherwise. See `.cursor/rules/mobile-responsive.mdc` for breakpoints, touch targets, and overflow.

## Topic-specific deep dives

| Symptom / area | Doc |
|----------------|-----|
| Wrong view after Back/Forward; hash vs `history.state`; deferred overview/player on cold load | [app-shell-app-tsx.md](./app-shell-app-tsx.md) |
| Admin Content tab: course/path/category editors, URLs, Firestore modules | [admin-portal-content.md](./admin-portal-content.md) |
| Admin ↑/↓ reorder feels random; row “jumps”; wrong item moves; Strict Mode double swap | [admin-reorder-scroll-viewport.md](./admin-reorder-scroll-viewport.md) |
| Adding a destructive confirm or blocking alert; avoiding native `window.confirm` | [patterns-in-app-confirmation-dialog.md](./patterns-in-app-confirmation-dialog.md) |
| Admin **disclosure widgets** (**Content** modules/lessons; **Marketing** slides)—accordion, quick ref, lifecycles | [patterns-admin-disclosure-widgets.md](./patterns-admin-disclosure-widgets.md) |

Add new deep-dive files under `docs/` and link them from [`docs/README.md`](./README.md).

## Full per-file inventory

For **every** `src/**/*.ts(x)` module (plus Vite/Firebase entrypoints), see **[`docs/codebase/README.md`](./codebase/README.md)** and the linked `inventory-*.md` files.

## Checklist for AI assistants editing this repo

1. Read **`docs/README.md`** for the full index; use **`docs/codebase/`** to find the right file before guessing imports.
2. Before changing **`App.tsx`**, read **[app-shell-app-tsx.md](./app-shell-app-tsx.md)** (history sync, deferred routes, profile overlay).
3. Prefer **`src/utils/*`** for data rules; keep **`App.tsx`** changes minimal unless the bug is navigation or global state.
4. After UI changes, reason about **~375px width** and tap targets (project rule).
5. If behavior differs **only in dev**, consider **Strict Mode** double invocation.
6. Run **`npm run lint`** before finishing a change that touches types or imports.
7. For **confirmations and blocking alerts**, follow **[patterns-in-app-confirmation-dialog.md](./patterns-in-app-confirmation-dialog.md)** (in-app modal + hooks; no `window.confirm` / `window.alert`).

## Checklist for human debugging

1. Reproduce with **URL hash / admin tab** noted; compare `window.history.state` with `parseHashToPayload` expectations.
2. **Console:** Firebase permission errors vs Gemini errors vs network.
3. **Firestore rules** if reads/writes fail for specific roles.
4. **Strict Mode** for state that uses functional updaters or non-idempotent effects.
