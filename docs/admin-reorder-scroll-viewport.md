# Admin list reorder: scroll compensation and Strict Mode

This document explains **why** and **how** arrow-based (↑/↓) reordering is implemented in the admin UI, so future work (human or AI) can extend it without regressing behavior.

**Broader context:** [development-and-debugging.md](./development-and-debugging.md) (Strict Mode, repo layout, how to run `npm run lint`). Admin **Content** surface overview: [admin-portal-content.md](./admin-portal-content.md) (including **Modules and lessons** click-to-open tips for reorder behavior).

## What problem this solves

### 1. Stationary mouse / cursor

After a reorder, React re-renders and list items move in the document. If the window does not scroll, the **same pixel on screen** now hits a **different row**, so the next click targets the wrong item. It feels like “it jumped two rows” or “the wrong module moved.”

**Fix:** Before applying state, record the clicked control’s **`getBoundingClientRect().top`** (viewport Y). After DOM commit, adjust **`window.scrollBy`** so that control returns to the same viewport Y, then **`focus({ preventScroll: true })`** on the same ↑/↓ role.

The math lives in **`scrollWindowToKeepReorderControlViewportY`** in [`src/utils/reorderScrollViewport.ts`](../src/utils/reorderScrollViewport.ts). Important: a **positive** `window.scrollBy` Y moves the document down and **decreases** element tops; restoring a control that moved **up** in the list requires **`scrollBy({ top: -delta })`** where `delta = beforeTop - afterTop`. Getting the sign wrong was a real bug once.

### 2. React 18 Strict Mode (development) double swap

Using **`setState((prev) => { … swap …; return next })`** for reorder can cause the **updater to run twice** in dev. If each run swaps from the same logical snapshot, you get **two swaps** per click.

**Fix:** Read current state from a **ref** synced on render (`draftRef`, `pathBranchTreeRef`, `courseEditDraftRef`), run a **pure** `compute*Swap*` function **once**, then:

```ts
flushSync(() => setState(computedNext));
```

Do **not** use a functional updater for the swap itself on those code paths.

## Shared utilities (single source of truth)

| Export | Purpose |
|--------|---------|
| `scrollWindowToKeepReorderControlViewportY` | Low-level viewport Y restore via `window.scrollBy`. |
| `applyReorderViewportScrollAndFocus` | Given a row element + job + button selectors: scroll, then focus ↑/↓. |
| `queryElementInScopeOrDocument` | `scopeRoot.querySelector` then `document.querySelector` fallback. |
| `escapeSelectorAttrValue` | Safe attribute values in `[data-foo="…"]` (uses `globalThis.CSS.escape` so it never clashes with a library import named `CSS`, e.g. `@dnd-kit/utilities`). |
| `REORDER_DATA_ATTR_SELECTORS` | Preset `up`/`down` query strings for `data-module-reorder`, `data-lesson-reorder`, `data-branch-reorder`, `data-gemini-reorder`. |

## Where it is used today

| Area | File | Row / scope markers | Notes |
|------|------|----------------------|--------|
| Course catalog — modules | [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx) | `data-admin-module-index` on module card | `moveModule` + `moduleReorderLayoutTick` + `useLayoutEffect`. |
| Course catalog — lessons | Same | `data-admin-lesson-row` + `data-lesson-reorder` | `moveLesson` + `lessonReorderLayoutTick`. |
| Learning path — mind map branches | [`PathBuilderSection.tsx`](../src/components/admin/PathBuilderSection.tsx) | `data-path-branch-node-id` on branch `<li>` | `moveBranchAmongSiblings` + `pathBranchReorderLayoutTick`. Root list wrapped in `pathBranchMindMapRootRef`. |
| Learning path — course in path | Same | `data-path-course-id`, `data-path-module-index`, `data-path-lesson-index` | `moveCourseModule` / `moveCourseLesson` + `pathCourseReorderLayoutTick`; editor scoped with `pathCourseStructureEditorRef`. |

## Pattern to copy for a new reorder surface

1. **DOM:** Stable row selector + `data-*-reorder="up"|"down"` on buttons (or pass custom selectors into `applyReorderViewportScrollAndFocus`).
2. **Before state update:** `pendingRef.current = { beforeTop: el.getBoundingClientRect().top, control: 'up'|'down' }` (derive `control` from `data-*-reorder` on the clicked button).
3. **Swap:** `const next = computeSwap(refCurrent, …)`; `flushSync(() => setState(next))`; bump a **layout tick** state so the effect runs once per reorder.
4. **`useLayoutEffect([tick]):`** Clear job from ref; build selector; `row = queryElementInScopeOrDocument(scopedContainerRef.current, selector)`; `applyReorderViewportScrollAndFocus(row, job, REORDER_DATA_ATTR_SELECTORS.lesson | .module | .branch | custom)`.

## Related code that differs

- **[`AdminGeminiModelsSection.tsx`](../src/components/admin/AdminGeminiModelsSection.tsx)** still uses **`scrollIntoView({ block: 'nearest' })`** after focus, not the window-scroll helper. `REORDER_DATA_ATTR_SELECTORS.gemini` exists so this screen can be aligned with the same pattern later if desired.

## Lesson row identity (course catalog)

Lessons use stable **`__adminRowKey`** (UUID) on draft lessons so reorder and focus targets stay correct when indices change. Module cards use **`data-admin-module-index`** (index after swap is explicit in the pending job). Path builder uses course id + indices in `data-path-*` attributes.

## Quick file map

```
src/utils/reorderScrollViewport.ts   # shared scroll + focus + selectors
src/components/admin/AdminCourseCatalogSection.tsx
src/components/admin/PathBuilderSection.tsx
```

When changing any of these, run through **mobile/narrow viewport** and **desktop**, and test **several consecutive ↑/↓ clicks** without moving the mouse.
