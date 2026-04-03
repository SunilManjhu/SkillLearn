# Inventory: `src/components` (all `.tsx` files)

Grouped by folder. **Large screens** get an extra line for sub-responsibilities where helpful.

## `src/components/AdminPage.tsx`

- **Role:** **Admin portal shell**: tab strip (alerts, AI, **Content** / `catalog`, moderation, roles), broadcast alert composer, unsaved-work guard coordination, wires all admin sections. See [admin-portal-content.md](../admin-portal-content.md) for the Content tab.
- **Primary exports:** `AdminPage`.
- **Used by:** `App.tsx` when `view === 'admin'`.

## `src/components/Certificate.tsx`

- **Role:** **Certificate** printable/share UI (learner achievement).
- **Primary exports:** `Certificate`.
- **Used by:** `App.tsx` certificate view, profile flows.

## `src/components/ContactForm.tsx`

- **Role:** **Contact** page form; writes to Firestore for moderation inbox. Props **`user`** (Firebase), **`isAuthReady`**, **`navUser`** (cached-or-live account, same idea as navbar): shows **“Checking sign-in…”** only when auth is not ready **and** there is no cached profile; otherwise shows the **sign-in** CTA or the **form** (submit disabled until **`user`** exists).
- **Primary exports:** `ContactForm`.
- **Used by:** `App.tsx` `contact` view.

## `src/components/CourseCard.tsx`

- **Role:** Single **catalog card** (metadata, progress hints, keyboard ref).
- **Primary exports:** `CourseCard` (`forwardRef`).
- **Used by:** `App.tsx` catalog grid.

## `src/components/CourseCatalogLoadingSkeleton.tsx`

- **Role:** Placeholder UI while **live catalog** hydrates for overview/player.
- **Primary exports:** `CourseCatalogLoadingSkeleton`.
- **Used by:** `App.tsx`.

## `src/components/CourseLibraryCategoryFilter.tsx`

- **Role:** **Navbar-embedded** catalog filters (categories, skills, level); forwardRef for focus hacks.
- **Primary exports:** `CourseLibraryCategoryFilter`.
- **Used by:** `Navbar` via `App.tsx`.

## `src/components/CourseOverview.tsx`

- **Role:** **Pre-player** course hub: modules/lessons list, progress, start/resume, certificate entry, deep-link scroll to lesson.
- **Primary exports:** `CourseOverview`.
- **Used by:** `App.tsx`.

## `src/components/CoursePlayer.tsx`

- **Role:** **Lesson playback** (YouTube / web / quiz), sidebar, progress sync, immersive mode callbacks, completion and rating flows. Very large.
- **Primary exports:** `CoursePlayer`.
- **Used by:** `App.tsx`.

## `src/components/CourseQuizPanel.tsx`

- **Role:** **Quiz lesson** UI: MCQ + freeform, Gemini-assisted grading/explanations, attempt persistence.
- **Primary exports:** `CourseQuizPanel`.
- **Used by:** `CoursePlayer`.

## `src/components/DemoLearningAgent.tsx`

- **Role:** Floating **learning assistant** FAB + chat surface; Gemini `generateContentWithModelChain`; parse structured replies; open course from tool output.
- **Primary exports:** `DemoLearningAgent`.
- **Used by:** `App.tsx`.

## `src/components/LearnerPathMindmapPanel.tsx`

- **Role:** Learner-facing **Learning Path** panel (outline / tree + optional layout view; progress, navigate to courses). Terminology: [learning-paths-lpaths.md](../learning-paths-lpaths.md).
- **Primary exports:** `LearnerPathMindmapPanel`.
- **Used by:** `App.tsx` catalog when a path is selected.

## `src/components/Navbar.tsx`

- **Role:** Top **navigation**: auth, theme toggle, notifications, catalog filters slot, learning path picker, admin entry. **`NavProfileAvatar`:** photo when `photoURL` is valid (eager image, `no-referrer`, error → initials on gradient); desktop profile control uses an **orange border** and **`focus-visible`** ring.
- **Primary exports:** `Navbar`, `NavbarNotification` type.
- **Used by:** `App.tsx`.

## `src/components/PathMindmapOutline.tsx`

- **Role:** **Outline / tree** view of path mind map with status icons and navigation.
- **Primary exports:** `PathMindmapOutline`.
- **Used by:** `LearnerPathMindmapPanel` only.

## `src/components/ProfilePage.tsx`

- **Role:** **Profile overlay**: stats, settings toggles (assistant, Gemini, AI models), certificates, completed courses modal, delete account.
- **Primary exports:** `ProfilePage`.
- **Used by:** `App.tsx` profile overlay.

---

## `src/components/admin/AdminAiSiteControlsSection.tsx`

- **Role:** Admin toggles for **site-wide** learning assistant / related AI switches (Firestore-backed).
- **Primary exports:** `AdminAiSiteControlsSection`.
- **Used by:** `AdminPage` AI tab.

## `src/components/admin/AdminCatalogCategoriesPanel.tsx`

- **Role:** Manage **custom catalog categories** (extras) and integration with presets.
- **Primary exports:** `AdminCatalogCategoriesPanel`.
- **Used by:** `AdminPage` catalog area.

## `src/components/admin/AdminCatalogCategoryPresetsPanel.tsx`

- **Role:** Edit **main/more category pills** synced to Firestore presets.
- **Primary exports:** `AdminCatalogCategoryPresetsPanel`.
- **Used by:** `AdminPage` catalog area.

## `src/components/admin/AdminCourseCatalogSection.tsx`

- **Role:** Full **course editor**: modules, lessons, video/web/quiz, validation, publish, delete, **arrow reorder** with viewport scroll helpers. **Content sub-tabs:** Catalog, paths, categories, presets — **Catalog** alone sits outside the `overflow-x-auto` strip. **Course** row and **Modules and lessons** row share layout (label + **info** button, **click/tap** tips, fixed/absolute popover behavior on narrow/wide).
- **Primary exports:** `AdminCourseCatalogSection`.
- **Used by:** `AdminPage` content tab.

## `src/components/admin/AdminGeminiModelsSection.tsx`

- **Role:** Admin UI for **Gemini model allowlist** (ids + enabled flags), save to Firestore.
- **Primary exports:** `AdminGeminiModelsSection`.
- **Used by:** `AdminPage` AI tab.

## `src/components/admin/AdminModerationSection.tsx`

- **Role:** **Moderation inbox** sub-tabs: reports, URL suggestions, contact messages; destructive actions via Firestore utils.
- **Primary exports:** `AdminModerationSection`.
- **Used by:** `AdminPage`.

## `src/components/admin/AdminUserRolesSection.tsx`

- **Role:** **Promote/demote** users between `user` and `admin` roles.
- **Primary exports:** `AdminUserRolesSection`.
- **Used by:** `AdminPage` roles tab.

## `src/components/admin/PathBuilderSection.tsx`

- **Role:** **Learning Path** admin editor: course list, **section → flat rows** outline (dividers, validation, flatten), arrow-based reorder (↑/↓), Firestore save for path + `pathMindmap`; exposes imperative handle for dirty state. See [learning-paths-lpaths.md](../learning-paths-lpaths.md).
- **Primary exports:** `PathBuilderSection`, `PathBuilderSectionHandle`, props types.
- **Used by:** `AdminPage` catalog (path editing).

## `src/components/admin/useAdminActionToast.tsx`

- **Role:** Small **toast** hook for admin save/delete feedback.
- **Primary exports:** `useAdminActionToast`, `AdminActionToastVariant`.
- **Used by:** `AdminPage`, admin sections.
