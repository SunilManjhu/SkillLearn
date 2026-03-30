# App shell: `App.tsx` responsibilities

[`src/App.tsx`](../src/App.tsx) is the **single root component**: routing by view, URL/history sync, catalog and learning-path loading, auth and admin gates, navbar notifications, and composition of learner/admin surfaces. It is **large** on purpose; use this map before editing.

**Related:** [`appHistory.ts`](../src/utils/appHistory.ts) (payload shape, `buildHistoryUrl` / `parseHashToPayload`), [`development-and-debugging.md`](./development-and-debugging.md) (broader stack and debugging).

## View model

`View` is a string union (`home`, `catalog`, `overview`, `player`, `profile`, `certificate`, `admin`, marketing pages, etc.). **`currentView`** is the source of truth for what the user is “on.”

**Profile is special:** when `currentView === 'profile'`, the shell renders a **modal overlay** while **`mainView`** pretends the underlay is still `profileSettingsUnderlayView` (typically `overview`, `player`, or `catalog`) so the blurred background matches where the user opened settings from. See `mainView` / `profileOverlayOpen` near the root `return`.

## URL and history (critical for bugs)

- **Serialized state:** `AppHistoryPayload` (`v: 1`, `view`, optional `courseId`, `lessonId`, `certificate`, `adminTab`, `learningPathId`). Stored in `history.state` under **`APP_HISTORY_KEY`** (`skillstreamApp`) and mirrored in the **hash** via `buildHistoryUrl` (see `appHistory.ts`).
- **`buildHistoryPayload`:** Derives the payload from React state. Note the comment that **player URLs omit the lesson segment**; the active lesson lives in component state and `CoursePlayer`.
- **`applyHistoryPayload`:** Applies a payload to state (course selection, `initialLesson`, `adminTab`, path id, certificate snapshot). Used on **browser Back/Forward** (`popstate`). Prefers **hash** over `history.state` when they diverge.
- **`historySkipSyncRef`:** Skips the “push new history entry” effect for one cycle after programmatic navigation that already updated the URL.
- **`historyActionRef`:** `'replace'` vs `'push'` — used for auth return, certificate public links, deferred-route resolution, profile overlay transitions, etc.

**Debugging “Back button wrong” or “URL doesn’t match screen”:** trace `popstate` → `applyHistoryPayload`, then the effect that calls `pushState`/`replaceState` when `buildHistoryPayload` changes.

## Catalog and course context

| Concept | Role |
|---------|------|
| `catalogCourses` | Resolved published courses (Firestore + static fallback). Loaded once on mount and refreshed via `refreshCatalogCourses` (e.g. after admin saves). |
| `liveCatalogHydrated` | Becomes true after `resolveCatalogCourses()` finishes. **Overview/player** show a skeleton until hydrated so lesson lists do not “pop in” after a partial bundled catalog. |
| `selectedCourse` | The course id the user entered overview/player with; may be a stale object reference. |
| `selectedCourseResolved` | **`useMemo`:** same course id but the **current row from `catalogCourses`**. Always prefer this for `CourseOverview` / `CoursePlayer` so curriculum matches Firestore. |
| `initialLesson` | Lesson to open in the player; set from deep link, resume logic, notification actions, or “start course” from overview. |
| `deferredCourseRoute` | If the hash asked for **overview/player** before that `courseId` existed in the first-paint catalog, the shell stores a deferred job and applies it when `catalogCourses` gains the course; if the course never appears after hydration, user is sent to catalog. |

**Cold-load deep links:** `getInitialRouteState` runs once with `peekResolvedCatalogCourses()` or static fallback; it can set `deferredCourseRoute` or fill `player` **lessonId** from resume when the hash has player without lesson.

**Learning Paths:** `selectedLearningPathId` scopes the catalog to a path’s `courseIds`. Initialized from hash; cleared if the path document disappears. Naming: user-facing **Learning Path(s)**; code shorthand **LPath** — see [learning-paths-lpaths.md](./learning-paths-lpaths.md).

## Enrollment (Firestore)

**Not** required to open overview from the catalog UI, but enrollment is recorded when a **signed-in** user opens a course:

- `handleCourseClick` → `enrollUserInCourse(user.uid, course.id)` then `setCurrentView('overview')`.
- Catalog grid path also calls `enrollUserInCourse` in one flow (search file for `enrollUserInCourse`).

**Navbar alerts** for broadcast messages use `fetchEnrolledCourseIds` to decide which course-scoped alerts apply.

## Overview ↔ player ↔ certificate

- **Overview:** `CourseOverview` receives `selectedCourseResolved`, `navUser`, deep-link props for alert-driven scroll (`overviewContentDeepLink`), certificate handoff (`onShowCertificate`). **Start course** sets `initialLesson` and `currentView === 'player'`.
- **Player:** Renders **`CoursePlayer`** only when `user` is set; otherwise **`PlayerSignInGate`**. After sign-in from the gate, a ref (`returnToOverviewAfterPlayerGateSignInRef`) forces **overview** (no autoplay) via an effect.
- **Immersive mode:** `playerImmersiveNav` hides the global navbar chrome during playback (`Navbar` `immersiveHidden`).
- **Completion:** `handleCoursePlayerFinished` records completion, Firestore timestamps, certificate persistence, and navigates (see callback body for exact flow).

## Admin portal

- **Role:** `subscribeUserRole` → `isAdminUser`; **`adminAccessResolved`** gates whether a non-admin can be trusted as “not admin” (avoids flashing away from `#/admin` during loading).
- **Render:** `AdminPage` only when `mainView === 'admin' && isAdminUser`. If auth is ready but role not resolved, a **“Checking admin access…”** placeholder shows.
- **Unsaved work:** `adminPortalUnsavedRef` + `handleAdminUnsavedWorkChange` from `AdminPage`. Leaving admin via **`handleNavigate`** or **history** while dirty opens **`adminExitGuardOpen`**; confirm applies pending navigation or `applyHistoryPayload`.

Opening admin from notifications sets `adminTab` and optionally `pendingModerationSubTab`.

**Content tab** (history id `catalog`, hash `#/admin/content`): course catalog editor, Learning Paths, categories, and topic presets — see [admin-portal-content.md](./admin-portal-content.md). Catalog refresh after publishes flows through `onCatalogChanged` → `refreshCatalogCourses`. **Course** and **Modules** labels pair with **info** buttons (**click/tap** tips; **Escape** / outside click closes).

## Auth and profile cache

- **`user`:** Firebase `User | null` after `onAuthStateChanged`.
- **`authSnapshot` / `readCachedAuthProfile`:** Stale-while-revalidate display for the navbar until auth restores.
- **`navUser`:** `user` or, while auth not ready, cached snapshot — used where progress/UI must not flicker.
- **`applyAuthReturnPayload`:** Restores view/course after **redirect sign-in** (`authReturnContext`).

## Notifications (`notifications` state)

Merged pipeline for signed-in users:

- Personal **`reportNotices`** + **course broadcast alerts** (`fetchActiveAlertsForCourses` over **enrolled** ids), plus **certificate** rows preserved across merges.
- **Admins** additionally get **moderation inbox** synthetic rows from snapshot sizes on `reports`, `suggestions`, `contactMessages`; dismiss state is persisted in `localStorage` per uid.

Failures on `reportNotices` with permission errors can set **`authBanner`** suggesting re-login.

## Marketing / static sections

`renderHome`, `renderCatalog`, `renderAbout`, `renderCertificate`, etc. are **inline render functions** in the same file. Footer and global chrome are conditional on `currentView` (e.g. footer hidden on player/overview/admin).

## Learning assistant FAB

`DemoLearningAgent` is mounted when `showLearningAssistantFab` (hook) is true and the view is not immersive-hidden; **`onOpenCourse`** sets course + overview.

## Where to make changes (quick guide)

| Goal | Likely place |
|------|----------------|
| New top-level screen | Add `View` variant, `AppHistoryView` / `resolvePayloadForCourses` if URL-relevant, `handleNavigate` paths, and a `mainView ===` branch. |
| Course/player behavior | Prefer **`CoursePlayer.tsx` / `CourseOverview.tsx`**; only touch `App.tsx` for state that must be global or URL-bound. |
| Firestore catalog refresh | `refreshCatalogCourses`, `resolveCatalogCourses`, admin `onCatalogChanged`. |
| Admin tab or guard | `adminTab`, `AdminPage` props, `adminPortalUnsavedRef` flow. |
| Deep link / hash | `appHistory.ts`, `getInitialRouteState`, `applyHistoryPayload`, `deferredCourseRoute` effects. |

## Refactors (for humans)

If `App.tsx` grows further, the lowest-risk extractions are usually: **history sync** (custom hook), **notification merge + admin moderation listeners**, and **initial route / deferred route** helpers (already partially isolated in `getInitialRouteState`). Keep **`buildHistoryPayload` / `applyHistoryPayload`** behavior identical when splitting—add integration tests or manual checklists if you extract them.
