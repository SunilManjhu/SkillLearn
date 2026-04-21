# SkillLearn — internal docs

Notes for **contributors** and **AI assistants**: architecture pointers, debugging playbooks, and feature-specific deep dives. End-user setup stays in the root [`README.md`](../README.md).

## Start here

| Doc | When to read it |
|-----|------------------|
| [**development-and-debugging.md**](./development-and-debugging.md) | Stack, env vars, folder map, navigation/history, Firebase & Gemini troubleshooting, mobile conventions, pre-flight checklists. |
| [**theme-and-color-palette.md**](./theme-and-color-palette.md) | **Light/dark UI colors:** allowed neutral ramp, real `brand-*` orange vs remapped `orange-*`, semantic CSS variables — implemented in [`src/index.css`](../src/index.css); [ColorKit reference palette](https://colorkit.co/palette/272828-393a3a-4c4d4d-616161-757676-8b8c8c-a1a2a2-b8b8b8-cfcfcf-e7e7e7/). |
| [**app-shell-app-tsx.md**](./app-shell-app-tsx.md) | **Root shell:** [`App.tsx`](../src/App.tsx) view state, URL/history sync, catalog hydration, enrollment, overview/player/admin/profile flows, notifications. |
| [**video-player-and-history.md**](./video-player-and-history.md) | **Course player:** YouTube vs native video, lesson id in URL / reload, Back button & path-scoped history (`historySkipSyncRef`, `shouldPushCourseOverviewBeforePlayer`), volume/mute `localStorage`, related Firestore rules. |
| [**access-control-roadmap.md**](./access-control-roadmap.md) | **Roles & creator isolation:** admin / creator / user, `ownerUid`, Firestore rules, phased tasks with dependencies and test criteria. |
| [**learning-paths-lpaths.md**](./learning-paths-lpaths.md) | **Learning Paths:** user-facing name vs **LPath** in code, definition, Firestore/URL touchpoints, main components, UX goals (flat section → items). |
| [**admin-portal-content.md**](./admin-portal-content.md) | **Admin → Content:** `adminTab` `catalog`, `#/admin/content`, [`AdminCourseCatalogSection`](../src/components/admin/AdminCourseCatalogSection.tsx) (sub-tab strip, **Course** / **Modules** info rows), Firestore touchpoints, dirty-state wiring. |
| [**admin-reorder-scroll-viewport.md**](./admin-reorder-scroll-viewport.md) | Admin ↑/↓ reorder: viewport scroll compensation, `flushSync`, Strict Mode, [`reorderScrollViewport.ts`](../src/utils/reorderScrollViewport.ts), and wiring per screen. |
| [**patterns-admin-label-info-tip.md**](./patterns-admin-label-info-tip.md) | **Reusable UI pattern:** field label + compact info button + click/tap tips (wide vs narrow panel, a11y, close behavior). Reference: [`AdminCourseCatalogSection`](../src/components/admin/AdminCourseCatalogSection.tsx). |
| [**patterns-in-app-confirmation-dialog.md**](./patterns-in-app-confirmation-dialog.md) | **Reusable UI pattern:** confirmations and alerts via in-app modals—no `window.confirm` / `window.alert`; `useBodyScrollLock`, `useDialogKeyboard`, layout/a11y checklist. Reference: [`AdminHeroPhoneAdsSection`](../src/components/admin/AdminHeroPhoneAdsSection.tsx). |
| [**patterns-admin-disclosure-widgets.md**](./patterns-admin-disclosure-widgets.md) | **Disclosure / disclosure widgets** for long admin editors (accordion). **Catalog:** modules/lessons + course details ([`AdminCourseCatalogSection`](../src/components/admin/AdminCourseCatalogSection.tsx)). **Marketing:** one slide at a time ([`AdminHeroPhoneAdsSection`](../src/components/admin/AdminHeroPhoneAdsSection.tsx)). |

## Full file reference (every source file)

Per-file **role**, **exports**, and **who imports it** — for onboarding and AI search:

- **[codebase/README.md](./codebase/README.md)** — index to split inventories.
- [codebase/inventory-entry-and-config.md](./codebase/inventory-entry-and-config.md) — `main`, `App`, `firebase`, Vite, types, CSS, Firebase JSON, `firestore.rules`.
- [codebase/inventory-data-hooks.md](./codebase/inventory-data-hooks.md) — `src/data/*`, `src/hooks/*`.
- [codebase/inventory-utils.md](./codebase/inventory-utils.md) — all `src/utils/*.ts`.
- [codebase/inventory-components.md](./codebase/inventory-components.md) — all `src/components/**/*.tsx`.

## How to extend this folder

- Add a **focused** markdown file per non-obvious subsystem (one problem domain per doc).
- Link new files in the table above and mention them from [`development-and-debugging.md`](./development-and-debugging.md) if they are part of a standard debug path.
- Prefer **file paths** and **symbol names** so search and IDE navigation work.
- When you **add, rename, or remove** a `src` module, update the matching section in [`codebase/inventory-*.md`](./codebase/README.md) in the same change.

## Quick commands (from repo root)

```bash
npm run dev     # local app
npm run lint    # TypeScript check
npm run build   # production build
```
