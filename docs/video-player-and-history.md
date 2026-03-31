# Video player, URL/history, and playback preferences

This document summarizes how the **course player** integrates with **`App.tsx`**, the **History API**, and **localStorage**, based on implementation and fixes in the SkillStream codebase. Use it when debugging Back navigation, reload behavior, or volume/mute persistence.

**Primary code:** [`src/components/CoursePlayer.tsx`](../src/components/CoursePlayer.tsx)  
**Shell / routing:** [`src/App.tsx`](../src/App.tsx), [`src/utils/appHistory.ts`](../src/utils/appHistory.ts)  
**YouTube helpers / playback prefs:** [`src/utils/youtube.ts`](../src/utils/youtube.ts)

**Related:** [`app-shell-app-tsx.md`](./app-shell-app-tsx.md) (broader shell), [`development-and-debugging.md`](./development-and-debugging.md).

---

## 1. Player modes (what actually plays)

`CoursePlayer` supports:

| Mode | When | Playback |
|------|------|----------|
| **YouTube embed** | `youtubeVideoIdFromUrl(activeVideoUrl)` resolves an id | `YT.Player` in a stable host `div` (destroy/recreate on lesson/url change; see comment about React vs iframe DOM). Custom chrome (seek, mute, volume, speed) uses the IFrame API. |
| **Native `<video>`** | Direct video URL, not YouTube | `<video controls>` for controls; same progress and outline UX as much as possible. |
| **Web / quiz / blocked** | Lesson type blocks video | No `<video>`/YouTube; quiz or external web flow. |

State such as `currentLesson`, `progressByLesson`, `mediaPaused`, and YouTube-only HUD state (`ytVolume`, `ytMuted`, etc.) lives inside `CoursePlayer`. The **shell** passes `course`, `initialLesson`, `user`, and `onActiveLessonIdChange` (see below).

---

## 2. Lesson identity in the URL (reload & sharing)

**Problem solved:** Reloading while on the player used to lose the active lesson because the hash often had **player without `lessonId`**, and cold load fell back to `getResumeOrStartLesson()` (first *incomplete* lesson in order), not “what I was watching.”

**Approach:**

- **`playerLessonIdForUrl`** in `App` tracks the **current lesson id** for history serialization.
- **`buildHistoryPayload`** sets `p.lessonId` when `currentView === 'player'` using `playerLessonIdForUrl ?? initialLesson?.id`.
- **`CoursePlayer`** calls **`onActiveLessonIdChange(lessonId)`** from a `useEffect` on `currentLesson.id` so sidebar/next-lesson changes update the shell.
- Navigation entry points (start from overview, path mindmap, notifications, `applyHistoryPayload`, catalog hydration) **set or clear** `playerLessonIdForUrl` together with `initialLesson` / `currentView`.

**History behavior:** When only the **lesson** changes but course/path/player view stays the same, the history sync uses **`replaceState`** (not an extra `pushState`) so **Back** still returns to **course overview** instead of stepping through past lessons.

**Hash shape:** Path-scoped player URLs include the lesson segment per [`payloadToHash`](../src/utils/appHistory.ts) (e.g. `#/course/<id>/player/path/<pathId>/<lessonId>`).

---

## 3. Browser Back and path-scoped catalog

**Serialized state:** `AppHistoryPayload` in `history.state` under `APP_HISTORY_KEY`, mirrored in the **hash** (`buildHistoryUrl` / `parseHashToPayload`). `mergeHashAndHistoryStatePayload` can merge path id from state when the hash is legacy.

**`historySkipSyncRef`:** After `popstate` or `hashchange`, the shell sets this ref so the **next** history-sync effect does **not** duplicate a `pushState`. **Important:** If the ref is set but React has already moved (e.g. overview → player), **`historyPayloadsEqual(prev, payload)` is false** — the effect must **not** skip, or the **player entry is never pushed** and Back can skip overview. The implementation only skips when **`historySkipSyncRef` is set *and* `prev` matches `payload`** (stack already aligned).

**`shouldPushCourseOverviewBeforePlayer`:** Before opening the player from overview, sometimes an extra **`pushState(overview)`** is required when the **visible hash** looks like overview but **`history.state` / stack** would otherwise let the sync **push player on top of catalog/path** (Back would go to path, not course overview). If the heuristic says **no** push, **do not** unconditionally push anyway — that **duplicated** the same overview URL and forced **two** Backs on the same hash.

**`historyActionRef`:** `'replace'` vs `'push'` for auth return, certificates, profile overlay, etc. Special cases push instead of replace when replacing would **drop** an overview or path entry (see `pushInsteadOfReplaceForPlayer`, `pushInsteadOfReplaceForCatalogToOverview` in `App`).

---

## 4. Cold load (`getInitialRouteState`)

Runs once with the initial catalog peek/static fallback. If the hash is **player** without `lessonId`, it may fill **`lessonId`** from `getResumeOrStartLesson()` — so **persisting lesson in the URL** (section 2) is the reliable way to reopen the same lesson after refresh.

---

## 5. Volume and mute persistence

**Storage keys** (in [`youtube.ts`](../src/utils/youtube.ts)):

| Key | Meaning |
|-----|--------|
| `skilllearn-player-volume` | Integer **0–100** (slider level). |
| `skilllearn-player-muted` | `'1'` / `'0'`. |

**YouTube:** Custom HUD drives `setVolume` / `mute` / `unMute` via the IFrame API. **Writes** happen on mute toggle and volume slider changes.

**Reload / `onReady` quirk:** Calling **`setVolume` then `unMute`** on the player during `onReady` can leave **audible volume at 100** (API ordering). The stable pattern is **`unMute()` then `setVolume(volPref)`** when the user wants sound; when muted, **`setVolume(volPref)` then `mute()`**. HUD state should follow **saved prefs**, not an immediate **`getVolume()`** right after init (can report 100 incorrectly).

**Per-lesson layout reset:** When `currentLesson.id` changes, the shell resets many player UI flags; **volume/mute state is re-read from `readPlayerVolumePreference` / `readPlayerMutedPreference`**, not hardcoded to 100 / unmuted.

**Native `<video>`:** On `loadedMetadata`, `volume` / `muted` are applied from the same prefs; **`onVolumeChange`** persists when the user uses browser controls.

**Captions:** Separate keys (`skilllearn-youtube-cc-*`) — unrelated to volume/mute.

---

## 6. Firestore: catalog skill presets (learners)

The app loads **`siteSettings/catalogSkillPresets`** for catalog UI (skill filter pills). **`siteSettings/catalogCategoryPresets`** already had **`allow read: if true`** in [`firestore.rules`](../firestore.rules); **`catalogSkillPresets`** needed an explicit rule with the same read policy (and admin-only writes), otherwise **authenticated non-admins** received permission errors on `get`.

---

## 7. Static assets (favicon)

Vite serves [`public/`](../public/) at the site root. **`public/favicon.ico`** and **`public/favicon.svg`** plus `<link rel="icon">` entries in [`index.html`](../index.html) prevent **404** on `/favicon.ico` during local dev.

---

## 8. Quick file map

| Concern | Where to look |
|--------|----------------|
| History sync effect, skip/stale logic | `App.tsx` — `useEffect` on `buildHistoryPayload` / `currentView` / … |
| `handleStartCourseFromOverview`, `playerLessonIdForUrl` | `App.tsx` |
| YouTube player create / `onReady` / `onStateChange` | `CoursePlayer.tsx` |
| Volume/mute read/write | `youtube.ts`, `CoursePlayer.tsx` |
| Hash ↔ payload | `appHistory.ts` |

---

*Last aligned with implementation in the repo at the time of writing; if behavior drifts, prefer source and tests over this file.*
