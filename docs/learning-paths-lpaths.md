# Learning Paths (code: LPath)

## What learners see vs what engineers call it

| Audience | Term | Notes |
|----------|------|--------|
| **UI copy** (navbar, catalog, admin, a11y labels) | **Learning Path** / **Learning Paths** | Always use the full phrase. Do not use “mind map” or bare “path” as the product name. |
| **Code** (types, comments, new helpers) | **LPath** shorthand | e.g. mental model “LPath document,” comments referencing `learningPathId`. Incremental renames toward `LPath*` types are optional; existing symbols like `LearningPath` and Firestore `learningPaths` remain valid. |

## Definition

A **Learning Path** is an **ordered list** learners follow to watch **courses in sequence**, optionally including specific lessons and external links in that order. It is one product concept end-to-end—not separate “path” vs “mind map” features in user messaging.

## Persistence and URLs (implementation)

- **Firestore:** `learningPaths` collection — document fields include title, `courseIds`, etc. Optional nested **outline tree** is stored via path mind map utilities ([`pathMindmapFirestore.ts`](../src/utils/pathMindmapFirestore.ts)).
- **Deep link:** Catalog scoped to one path uses hash `#/catalog/path/<id>` and `AppHistoryPayload.learningPathId` ([`appHistory.ts`](../src/utils/appHistory.ts)).
- **Types:** [`LearningPath`](../src/data/learningPaths.ts), [`MindmapTreeNode`](../src/data/pathMindmap.ts) — tree shape for the admin builder and learner outline.

## Main code touchpoints

| Layer | Files |
|-------|--------|
| Admin editor | [`PathBuilderSection.tsx`](../src/components/admin/PathBuilderSection.tsx) |
| Learner panel | [`LearnerPathMindmapPanel.tsx`](../src/components/LearnerPathMindmapPanel.tsx) |
| Learner outline | [`PathMindmapOutline.tsx`](../src/components/PathMindmapOutline.tsx) — section accordions, flat rows, dividers, course taxonomy chips |
| App shell | [`App.tsx`](../src/App.tsx) — `selectedLearningPathId`, catalog render, path hero |
| Nav | [`Navbar.tsx`](../src/components/Navbar.tsx) — Learning Paths menu |

## Outline model (depth, dividers, chips)

- **Schema:** [`MindmapTreeNode`](../src/data/pathMindmap.ts) supports `kind: 'divider'` (label + empty `children`). Normalization forces dividers to have no children.
- **Admin:** [`PathBuilderSection.tsx`](../src/components/admin/PathBuilderSection.tsx) — **↑/↓** reorder among siblings; **Add under** on a section adds nested rows. Rows inside a section are flat. **Save** is blocked until the tree is valid; a **Flatten for editing** control promotes legacy nested labels into dividers + siblings. **Section divider** is added from the branch modal when adding under a section.
- **Learner:** [`PathMindmapOutline.tsx`](../src/components/PathMindmapOutline.tsx) flattens legacy nested labels at render (synthetic dividers), removes extra branch accordions under sections, renders real dividers as static subheadings, and shows **level / skills / categories** chips on course and lesson rows (from catalog metadata). Rows may include `visibleToRoles`: omit or **`learner`** present = visible to learners (and matching admins/creators per rules); `[]` = hidden for all; `['admin']` = admins only; the catalog outline filters by the viewer’s Firestore role (`users/{uid}.role`).
- **Admin visibility:** [`PathBuilderSection.tsx`](../src/components/admin/PathBuilderSection.tsx) — **Show in outline** (checkbox; tooltip explains catalog visibility) plus **Who can see it** (e.g. everyone including **Learner**, or restricted to admins/creators); unchecking hides the row from the catalog outline for everyone (stored as `visibleToRoles: []`). Administrators always see rows that include the **`learner`** role when those rows are shown.

## Related internal docs

- [admin-portal-content.md](./admin-portal-content.md) — Admin → Content tab, path builder placement
- [app-shell-app-tsx.md](./app-shell-app-tsx.md) — `learningPathId` in history and catalog
- [development-and-debugging.md](./development-and-debugging.md) — Firestore, navigation
- [patterns-admin-disclosure-widgets.md](./patterns-admin-disclosure-widgets.md) — Path builder disclosure / scroll behavior
