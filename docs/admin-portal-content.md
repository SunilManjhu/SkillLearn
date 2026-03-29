# Admin portal → Content

This document describes the **Content** tab of the admin portal: what it covers in the product, how it maps to code and URLs, and where persistence lives. Use it when changing course editing, learning paths, category tooling, or unsaved-work behavior.

**Related:** [development-and-debugging.md](./development-and-debugging.md) (navigation, Firestore layout), [app-shell-app-tsx.md](./app-shell-app-tsx.md) (admin gate, `refreshCatalogCourses`), [admin-reorder-scroll-viewport.md](./admin-reorder-scroll-viewport.md) (↑/↓ reorder in catalog and path builder).

## Product vs code naming

| In the UI | In history / state | Canonical hash when active |
|-----------|-------------------|----------------------------|
| **Content** (tab label in [`AdminPage.tsx`](../src/components/AdminPage.tsx)) | `adminTab === 'catalog'` (`AdminHistoryTab` in [`appHistory.ts`](../src/utils/appHistory.ts)) | `#/admin/content` from [`buildHistoryUrl`](../src/utils/appHistory.ts) |

Legacy hash segments `#/admin/courses` and `#/admin/catalog` still parse to the same `adminTab` (`catalog`); prefer **`#/admin/content`** for new links.

## What lives on this tab

The Content tab renders a single large surface: [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx). Inside it, **horizontal sub-tabs** (local React state, `contentCatalogSubTab`) are:

| Sub-tab | Purpose |
|---------|---------|
| **Catalog** | List published courses; open course editor (modules, lessons, video / web / quiz, validation, publish, delete). **Course** row (label + **info** button, same layout as **Modules and lessons**) toggles editor notes on **click/tap** (Firestore, **Course** control, **New Course** ids, `C1M1` / `C1M1L1`). Pattern detail: [patterns-admin-label-info-tip.md](./patterns-admin-label-info-tip.md). |
| **Learning paths** | Path list and [`PathBuilderSection`](../src/components/admin/PathBuilderSection.tsx) (courses in path, mind map, Firestore save). |
| **Categories** | [`AdminCatalogCategoriesPanel`](../src/components/admin/AdminCatalogCategoriesPanel.tsx) — custom catalog categories (“extras”) alongside presets. |
| **Topic presets** | [`AdminCatalogCategoryPresetsPanel`](../src/components/admin/AdminCatalogCategoryPresetsPanel.tsx) — main/more category pills synced to Firestore. |

Sub-tab choice is **not** encoded in the URL today; refresh returns to the default sub-tab flow defined in that component.

**Sub-tab strip layout:** **Catalog** is a single sub-tab control **outside** the horizontally scrollable group (avoids popover clipping from `overflow-x-auto`). **Learning paths**, **Categories**, and **Topic presets** share `flex-1 min-w-0 overflow-x-auto` (wraps on larger breakpoints). Course tips live beside the **Course** label in the editor grid, not on this strip.

## Parent shell: `AdminPage`

[`AdminPage.tsx`](../src/components/AdminPage.tsx) owns the top-level admin tabs and composes `AdminCourseCatalogSection` when `tab === 'catalog'`. It passes:

- `onCatalogChanged` → typically [`refreshCatalogCourses`](../src/App.tsx) so learner catalog/overview/player see updates after publishes.
- `onDraftDirtyChange` / `onPathsDirtyChange` → feed **`catalogDirty`** and **`pathDirty`**, which combine with alerts/AI dirty flags into **`hasUnsavedWork`** and the leave-admin confirmation path (`onUnsavedWorkChange` up to `App.tsx`).

## Data and Firestore (typical touchpoints)

| Area | Primary modules / collections |
|------|------------------------------|
| Published courses | [`publishedCoursesFirestore.ts`](../src/utils/publishedCoursesFirestore.ts) → `publishedCourses` |
| Learning paths | [`learningPathsFirestore.ts`](../src/utils/learningPathsFirestore.ts), [`pathMindmapFirestore.ts`](../src/utils/pathMindmapFirestore.ts) (as used by path builder) |
| Category presets | [`catalogCategoryPresetsFirestore.ts`](../src/utils/catalogCategoryPresetsFirestore.ts) (`catalogCategoryPresets` doc id and helpers) |
| Category extras / client merge | [`catalogCategoryExtras.ts`](../src/utils/catalogCategoryExtras.ts), [`catalogCategoryPresets.ts`](../src/utils/catalogCategoryPresets.ts) |

Exact document paths and rules belong in [`firestore.rules`](../firestore.rules) and the `*Firestore.ts` call sites.

## UX and implementation notes

- **Mobile-first (Content → Catalog UI):** Default styles target **narrow viewports** first; **`sm:`** tightens typography. Sub-tabs and **Reload list** use **`min-h-11` (~44px)** and **`touch-manipulation`**. **Course** and **Modules and lessons** use the same **field-label** style as **Document ID** / **Level** (`text-xs font-semibold text-[var(--text-secondary)]`), with a compact **`size-6`** info button and **14px** icon aligned to that label row; tips open **only on click/tap**. **Escape** or **pointer-down outside** closes. Below **`sm`**, fixed panel + measured **`top`** under the info button; **no** **`window.scrollBy`**. **`scroll` / `resize`** re-sync **`top`** while open. Course **select** uses **`text-base sm:text-sm`** and **`min-h-11`**. Horizontal sub-tab strip uses **momentum scrolling** where supported.
- **Inline help (save space):** **Course** tips (catalog sub-tab): Firestore saves, loading the **Course** control, **New Course** ids, `C1M1` / `C1M1L1`. **Modules and lessons** (with a draft): reorder, **Move to module…**, structured id renumbering.
- **Reorder:** Module/lesson rows and path-builder rows use shared viewport scroll compensation; see [admin-reorder-scroll-viewport.md](./admin-reorder-scroll-viewport.md).
- **Strict Mode:** Reorder paths use `flushSync` and refs to avoid double-swap updaters in dev; same doc.

## Quick file map

```
src/components/AdminPage.tsx                    # tab strip; wires Content + dirty callbacks
src/components/admin/AdminCourseCatalogSection.tsx
src/components/admin/PathBuilderSection.tsx
src/components/admin/AdminCatalogCategoriesPanel.tsx
src/components/admin/AdminCatalogCategoryPresetsPanel.tsx
src/utils/publishedCoursesFirestore.ts
src/utils/learningPathsFirestore.ts
src/utils/appHistory.ts                         # adminTab 'catalog' ↔ #/admin/content
```

When adding a new Content sub-area, extend `AdminCourseCatalogSection` (or extract a sibling only if the shell clearly needs it), update this doc, and add or adjust entries in [`codebase/inventory-components.md`](./codebase/inventory-components.md).
