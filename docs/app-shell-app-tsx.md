# App shell: `App.tsx` responsibilities

[`src/App.tsx`](../src/App.tsx) is the **single root component**: routing by view, URL/history sync, catalog and learning-path loading, auth and admin gates, navbar notifications, and composition of learner/admin surfaces. It is **large** on purpose; use this map before editing.

**Related:** [`appHistory.ts`](../src/utils/appHistory.ts) (payload shape, `buildHistoryUrl` / `parseHashToPayload`), [`video-player-and-history.md`](./video-player-and-history.md) (CoursePlayer, Back button, lesson in URL, volume prefs), [`development-and-debugging.md`](./development-and-debugging.md) (broader stack and debugging).

## View model

`View` is a string union (`home`, `catalog`, `overview`, `player`, `profile`, `certificate`, `admin`, marketing pages, etc.). **`currentView`** is the source of truth for what the user is “on.”

**Profile is special:** when `currentView === 'profile'`, the shell renders a **modal overlay** while **`mainView`** pretends the underlay is still `profileSettingsUnderlayView` (typically `overview`, `player`, or `catalog`) so the blurred background matches where the user opened settings from. See `mainView` / `profileOverlayOpen` near the root `return`.

## URL and history (critical for bugs)

- **Serialized state:** `AppHistoryPayload` (`v: 1`, `view`, optional `courseId`, `lessonId`, `certificate`, `adminTab`, `learningPathId`). Stored in `history.state` under **`APP_HISTORY_KEY`** (`igoldenApp`) and mirrored in the **hash** via `buildHistoryUrl` (see `appHistory.ts`).
- **`buildHistoryPayload`:** Derives the payload from React state. For **`player`**, includes **`lessonId`** when `playerLessonIdForUrl` / `initialLesson` is set so reload restores the active lesson; see [`video-player-and-history.md`](./video-player-and-history.md).
- **`applyHistoryPayload`:** Applies a payload to state (course selection, `initialLesson`, `adminTab`, path id, certificate snapshot). Used on **browser Back/Forward** (`popstate`). Prefers **hash** over `history.state` when they diverge.
- **Certificate URL:** The hash is only `#/certificate`; **`certificate` metadata** (course id, user name, date, id, public flag) lives in **`history.state`** under the same payload. **`mergeHashAndHistoryStatePayload`** keeps `certificate` from state when the hash omits it. **`getInitialRouteState`** merges hash + `history.state` on cold load so **reload** restores `currentView === 'certificate'` and **`certificateData`** instead of resetting to home and wiping state. **`initialRoute.certificateData`** seeds React state; a one-time layout effect primes **`certificateReturnRef`** for Close. Public share links still use **`?cert_id=…&cert_course=…`** (handled in a dedicated `useEffect`).
- **`historySkipSyncRef`:** Skips the “push new history entry” effect for one cycle after programmatic navigation that already updated the URL — **unless** `historyPayloadsEqual(prev, payload)` is false (React moved but ref still set); see [`video-player-and-history.md`](./video-player-and-history.md).
- **`historyActionRef`:** `'replace'` vs `'push'` — used for auth return, certificate public links, deferred-route resolution, profile overlay transitions, etc.

**Debugging “Back button wrong” or “URL doesn’t match screen”:** trace `popstate` → `applyHistoryPayload`, then the effect that calls `pushState`/`replaceState` when `buildHistoryPayload` changes.

## Catalog and course context

| Concept | Role |
|---------|------|
| `catalogCourses` | **`useMemo`** over **`catalogCourseRows`**: published + optional creator draft rows (`mergeOwnerPreviewCourseRows`). Loaded via catalog `useEffect` + `refreshCatalogCourses`; **published** peek uses `peekResolvedCatalogCourses()`; **drafts/paths** use `creatorCatalogSession` so preview users do not see a long empty-then-pop-in gap — see [access-control-roadmap.md](./access-control-roadmap.md) §8. |
| `liveCatalogHydrated` | True when a session snapshot or first Firestore batch says the catalog is safe to show (published `peek`, creator cache, or live resolve). **Overview/player** use a skeleton until then to avoid partial curriculum. |
| `selectedCourse` | The course id the user entered overview/player with; may be a stale object reference. |
| `selectedCourseResolved` | **`useMemo`:** same course id but the **current row from `catalogCourses`**. Always prefer this for `CourseOverview` / `CoursePlayer` so curriculum matches Firestore. |
| `initialLesson` | Lesson to open in the player; set from deep link, resume logic, notification actions, or “start course” from overview. |
| `deferredCourseRoute` | If the hash asked for **overview/player** before that `courseId` existed in the first-paint catalog, the shell stores a deferred job and applies it when `catalogCourses` gains the course; if the course never appears after hydration, user is sent to catalog. |

**Cold-load deep links:** `getInitialRouteState` runs once with `peekResolvedCatalogCourses() ?? []` (no bundled catalog). It builds the initial location from **`mergeHashAndHistoryStatePayload(parseHashToPayload(hash), readPayloadFromHistoryState(history.state))`** so **certificate** (and similar) data survives refresh. Creator/admin initial rows can also hydrate from **`creatorCatalogSession`** when the cached profile uid matches — same §8. The shell can set `deferredCourseRoute` or fill `player` **lessonId** from resume when the hash has player without lesson.

**Overview / player React keys:** `CourseOverview` and `CoursePlayer` use **`courseOverviewPlayerInstanceKey`** (`courseId` + draft / admin-preview disambiguation only), **not** a curriculum signature of every lesson id. That avoids remounting when the live catalog merges drafts and replaying motion `initial` animations (often mistaken for theme flicker).

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
- **Navbar profile control:** [`Navbar.tsx`](../src/components/Navbar.tsx) **`NavProfileAvatar`** prefers **`photoURL`** (with `referrerPolicy="no-referrer"`, eager load, **`onError`** → initials on gradient) so initials do not flash over the photo while the image loads; the desktop profile button uses a visible **orange ring** plus **`focus-visible`** focus styles.

## Theme (light / dark)

- **Source of truth:** React state `theme` in `App.tsx` (`'dark' | 'light'`). **`document.body`** gets class **`light`** in a **`useLayoutEffect`** when theme is light (design tokens live in [`src/index.css`](../src/index.css): `:root` vs `body.light`).
- **Persistence (signed-in):** [`src/utils/uiThemePreference.ts`](../src/utils/uiThemePreference.ts) — `localStorage` key **`skilllearn:uiTheme:{uid}`**. Theme toggle writes when **`user?.uid`** is set. **Guests** are not persisted; when auth is known guest, sync forces **dark**.
- **First paint:** [`index.html`](../index.html) runs an **inline script** (before the app bundle) that reads **`igolden.auth.profile.v1`** + the same theme key and adds **`body.light`** when stored theme is light — reduces flash before React runs (must stay in sync with `authProfileCache` / `uiThemePreference` key strings).
- **Auth transition:** **`uiThemeSyncedForAuthKeyRef`** applies stored theme only when the auth key (**guest** vs **uid**) **changes**, so a toggle before `user` is set is not overwritten when Firebase attaches.
- **Tailwind `dark:` vs app theme:** Many learner accents use CSS variables. Where Tailwind **`dark:`** would follow **system** preference, the app defines **`@custom-variant app-dark (body:not(.light) &);`** in `index.css` so “dark styling” tracks **app** theme (e.g. overview/player emerald lines).

## Contact page

- **`ContactForm`** receives **`user`**, **`isAuthReady`**, and **`navUser`** (same composite as the navbar). **“Checking sign-in…”** shows only when **`!isAuthReady && !navUser`**. If a **cached profile** exists, the **form** shows immediately; **submit** stays disabled until **`user`** (Firebase) exists so Firestore rules see a real token.

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
| Deep link / hash | `appHistory.ts`, `getInitialRouteState` (hash + `history.state` merge), `applyHistoryPayload`, `deferredCourseRoute` effects. |
| Theme / `body.light` | `App.tsx` + [`uiThemePreference.ts`](../src/utils/uiThemePreference.ts) + [`index.html`](../index.html) inline bootstrap; `index.css` `app-dark` variant. |
| Contact auth UX | `ContactForm.tsx` (`navUser` / `isAuthReady`). |

## Refactors (for humans)

If `App.tsx` grows further, the lowest-risk extractions are usually: **history sync** (custom hook), **notification merge + admin moderation listeners**, and **initial route / deferred route** helpers (already partially isolated in `getInitialRouteState`, including **certificate** restore from merged hash + state). Keep **`buildHistoryPayload` / `applyHistoryPayload`** behavior identical when splitting—add integration tests or manual checklists if you extract them. **Theme** persistence is already isolated in **`uiThemePreference.ts`**.
