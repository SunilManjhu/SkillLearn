# Disclosure / disclosure widgets (admin — long editors)

**Identify this doc:** filename **`patterns-admin-disclosure-widgets.md`** · keywords **disclosure**, **disclosure widget**.

In accessibility terms these are **disclosures**: a control shows or hides a **panel** (here, a large editor). **Disclosure widget** is the plain-language name used alongside **accordion** when only one panel in a set may be open. This is **not** the same as [label + info tips](./patterns-admin-label-info-tip.md) (those disclose a small help panel beside a field).

Use this when an admin screen shows **nested or repeated items** (course sections, modules, lessons, marketing slides) each with a **large editor**. Collapsing inactive rows reduces scrolling. In this codebase, these surfaces often use an **accordion**: **at most one** heavy editor open **per list** (one module, one lesson, one marketing slide).

**Future work:** When adding a new accordion editor list, copy the **closest existing file** (catalog vs marketing), keep **`aria-expanded`** + row summaries, and extend this doc with a new subsection if the rules differ materially.

---

## Quick reference (Catalog vs Marketing)

| | **Course catalog** ([`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx)) | **Marketing hero slides** ([`AdminHeroPhoneAdsSection.tsx`](../src/components/admin/AdminHeroPhoneAdsSection.tsx)) |
|---|------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| **Layers** | Course details (`boolean`) + modules (`Record<number, boolean>`) + lessons (`Record<string, boolean>`, key **`mi:li`**) | Single list: **`expandedSlideId: string \| null`** |
| **Open one** | One module globally; one lesson globally | One slide globally |
| **Toggle helpers** | `toggleModuleOpen`, `toggleLessonOpen`; course row uses `setCourseDetailsOpen` | `toggleSlideExpanded(id)`; **`collapseAllSlides`** → `null` |
| **Expansion key** | **Module/lesson indices** (ids can renumber on structured reorder) | **Stable slide `uuid`/id** (reorder does not change id) |
| **Reorder + open state** | Remap/swap keys in `openModules` / `openLessons` (`moveModule`, `moveLesson`, `remapOpenLessonsAfterModuleSwap`) | No remap: expanded slide **follows** the same `id` after move |
| **Bulk “open all”** | None | None (would break single-open UX) |
| **Scroll** | **`scrollDisclosureRowToTop`** (viewport): on expand, lesson row → module row → course details card (priority). | **Bounded list:** `scrollDisclosureRowToTop(container, row)` via `slidesScrollContainerRef` + `useLayoutEffect` on **`expandedSlideId`** |

---

## Course catalog (Content tab) — detail

**File:** [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx)

**Search symbols:** `courseDetailsOpen`, `openModules`, `openLessons`, `toggleModuleOpen`, `toggleLessonOpen`.

### Three disclosure layers

| State | Type | What it controls |
|--------|------|------------------|
| **`courseDetailsOpen`** | `boolean` | **Course details** (title, author, categories, …)—full-width header + chevron. |
| **`openModules`** | `Record<number, boolean>` | **Module** bodies. |
| **`openLessons`** | `Record<string, boolean>` | **Lesson** bodies. Keys: **`${moduleIndex}:${lessonIndex}`**. |

### Accordion rules

- **One module at a time:** `toggleModuleOpen(mi)` sets **`openModules`** to **`{ [mi]: true }`** when opening, or **`{}`** when closing the active module.
- **One lesson at a time:** `toggleLessonOpen(mi, li)` sets **`openLessons`** to a one-key object whose key is **`"${mi}:${li}"`**, or **`{}`** when closing.
- **Cross-collapse:** Opening a module runs **`setCourseDetailsOpen(false)`** and **`setOpenLessons({})`** so the user isn’t looking at course-level fields or stale lesson panels from another module.
- **Course details** toggles independently with **`setCourseDetailsOpen((v) => !v)`** (boolean flip).

### UI

- **`button type="button"`** on the row, **`aria-expanded`**, rich **`aria-label`** (index, id, title, Expand/Collapse).
- **ChevronRight** collapsed / **ChevronDown** open (module/lesson **14px**; course details header **16px**).
- **Reorder/remove** on the header without expanding—same principle as Marketing.

### When indices move

Structured courses can **renumber** ids when order changes. Expansion state is **index-based**, so **`moveModule` / `moveLesson`** update **`openModules` / `openLessons`** so the same **logical** row stays open. See [admin-reorder-scroll-viewport.md](./admin-reorder-scroll-viewport.md).

**Portal context:** [admin-portal-content.md](./admin-portal-content.md).

**Disclosure scroll:** [`scrollDisclosureRowToTop`](../src/utils/scrollDisclosureRowToTop.ts) — lesson (`data-lesson-mi` / `data-lesson-li`), module (`data-admin-module-index`), or course details wrapper ref; viewport `scrollIntoView` (`block: 'start'`, smooth).

---

## Learning Paths — outline branches + courses in path

**File:** [`PathBuilderSection.tsx`](../src/components/admin/PathBuilderSection.tsx)

**Terminology:** Learners and admins see **Learning Path(s)**; internal docs/code may say **LPath**. See [learning-paths-lpaths.md](./learning-paths-lpaths.md).

- **Branches:** chevron on rows with children (`expandedBranchIds`, `toggleBranchCollapse`, `focusBranchRow`). After expand/focus, `useLayoutEffect` scrolls `[data-path-branch-node-id="…"]` into view (viewport).
- **Courses in path:** `expandedCourseId` + `openModuleIdx` keys `m-{courseId}-{mi}`. After expand/toggle, scroll the open **module** row if any (`data-path-course-id` + `data-path-module-index`), else the **course** shell (`data-path-course-disclosure`).

---

## Marketing — home hero slides — detail

**File:** [`AdminHeroPhoneAdsSection.tsx`](../src/components/admin/AdminHeroPhoneAdsSection.tsx)

**Search symbols:** `expandedSlideId`, `toggleSlideExpanded`, `collapseAllSlides`, `didExpandAfterLoadRef`, `slideShellRefs`.

### Accordion rules

- **`expandedSlideId: string | null`** — at most one slide’s editor is mounted.
- **`toggleSlideExpanded(id)`:** if `id` is already open → **`null`**; else → **`id`** (others implicitly closed).
- **`Collapse all`:** **`null`**. No **Expand all**.

### Lifecycle (keep in sync when you change behavior)

| Event | Expansion result |
|--------|-------------------|
| **Initial load** | `useEffect` + **`didExpandAfterLoadRef`:** if no valid id, open **first** slide. While **`loading`**, drop expansion if current id missing from draft. |
| **Add slide** | **`setExpandedSlideId(newId)`** — only the new slide opens. |
| **Remove slide** | If removed id was open → open slide at **`min(index, nextLength-1)`** (or first / `null`). |
| **Replace defaults / Discard** | Open **first** slide of the new draft (`next[0]?.id ?? null`). |
| **Reorder slides** | **Unchanged id** — expanded slide stays open as it moves. |
| **User collapses** | **`null`** — stays collapsed until user opens a row again (no auto-reopen on unrelated edits). |

### UI extras

- Collapsed row: **summary** from `heroSlideCollapsedSummary` (label / headline / text preview, block count, gradient).
- **Scroll list to expanded slide:** `slidesScrollContainerRef` + `useLayoutEffect` on **`expandedSlideId`** — **`scrollDisclosureRowToTop(container, slideEl)`** so the active slide’s **top** lines up with the **top** of the scroll panel (smooth). Skip when already aligned (~few px).

---

## Shared conventions (all disclosure widgets)

1. **`aria-expanded`** on the control that toggles the editor.
2. **`min-h-11`** (or larger) for primary tap targets; **`touch-manipulation`** where it helps on narrow viewports.
3. Collapsed state shows a **scannable** title (and optional subtitle)—user can find the row without opening it.
4. Prefer **`button`** for the toggle (not `div` + `onClick`) for keyboard and SR support.
5. Do **not** mix this pattern with [info tips](./patterns-admin-label-info-tip.md) on the **same** control—tips use a separate **Info** affordance.

### Presentation: avoid double chrome

Do **not** wrap a **list of disclosure rows** inside an extra `rounded-* border bg-*` panel when those rows already sit inside the tab’s outer admin card (`patterns` in [admin portal](./admin-portal-content.md)). That stacks two boxes and fights the disclosure model.

- Prefer **spacing** (`space-y-*`) plus **dividers** (`border-b` / `border-t` on the expanded body) between rows.
- **Nested depth** can use a light **left rail** (`border-l`, accent tint) instead of boxing every child.
- Inline help that uses native **`<details>`** should **not** use a second bordered card around the whole `<details>`—style `summary` only.

---

## Choosing index- vs id-based expansion

| Situation | Approach |
|-----------|----------|
| Reorder **changes** which index refers to which entity, or ids are **renumbered** | **Index maps** + **remap** on swap (**catalog**). |
| Each row has a **stable id** for the lifetime of the draft | **`string \| null`** (**Marketing**). |

---

## Related docs

- [admin-portal-content.md](./admin-portal-content.md) — Content tab, catalog editor.
- [patterns-admin-label-info-tip.md](./patterns-admin-label-info-tip.md) — field **help** tips (not row editors).
- [admin-reorder-scroll-viewport.md](./admin-reorder-scroll-viewport.md) — reorder + viewport/focus with expanded rows.
- [mobile-responsive](../.cursor/rules/mobile-responsive.mdc) — touch targets and narrow layouts.
