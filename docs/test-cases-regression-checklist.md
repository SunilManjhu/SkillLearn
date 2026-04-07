# Regression checklist (run after code changes)

This file is a **manual test checklist** to run after UI/navigation changes. Keep it updated when you add features or change routing.

**Scope:** i-Golden web app (mobile-first).  
**Goal:** Catch regressions quickly (routing, layout, responsive behavior, key flows).

---

## How to use

- Run through **Smoke (5 min)** for small PRs.
- Run through **Full (15–25 min)** for routing/layout/state changes.
- Test at:
  - **Mobile**: ~375×812 (iPhone-like)
  - **Desktop**: ≥1280px
  - Optional: **Tablet**: ~768px breakpoint

Record failures in the PR description or a tracking issue:
- **URL**
- **Steps**
- **Expected**
- **Actual**
- **Screenshot** (if UI)

---

## 0) Smoke (fast)

- **App loads**: `#/` renders without errors.
- **Catalog loads**: `#/catalog` shows course library.
- **Player deep link**: open any course overview then player; refresh keeps you on the same view.
- **Mobile navbar**: menu opens/closes; no horizontal overflow in top bar.

---

## 1) Routing: URL specificity + reload behavior (required)

### 1.1 Hash routes resolve correctly

- **Home**: `#/` → Home page.
- **Catalog**: `#/catalog` → Catalog grid + filters.
- **Catalog learning path**: `#/catalog/path/<pathId>` → Learning path view (see §4).
- **Course overview**: `#/course/<courseId>/overview` → Course overview.
- **Course player**: `#/course/<courseId>/player` (and optional lesson segment) → Player.
- **Admin**: `#/admin` and subroutes (if admin) land on correct tab.

### 1.2 Reload stays on the same place

For each of the above:
- Open the route
- Hard reload
- **Expected**: same route/view restores (no silent fallbacks to `#/catalog` unless intentionally handled with an explanation).

**Also verify:**

- **Certificate (in-app):** From a course, open the achievement/certificate view so the URL is `#/certificate` and the page shows your certificate. Hard reload → **still** on the certificate (not home/catalog) with the same data.
- **Theme:** While signed in, switch to **light** mode, reload → stays **light**. Sign out → reload as guest → **dark** default (guest choice not persisted).
- **Contact (signed in):** Open **Contact Us**, reload → form appears **without** a long “Checking sign-in…” flash when a session exists (cached profile).

### 1.3 Back/forward history is sane

- Navigate: Catalog → Path → Course → Back → returns to Path, Back → returns to Catalog.
- On mobile, using browser back does not leave you “stuck” in a stale view.

### 1.4 Hash edits update state (hashchange)

- While app is open, manually edit the URL hash (e.g. from `#/catalog` to `#/catalog/path/P1`).
- **Expected**: app state updates to the new view (no refresh required).

---

## 2) Feature behavior docs (required)

When you add or change a feature:
- **Document behavior** in a dedicated file under `docs/`.
- Include:
  - **Purpose**
  - **Data/source of truth**
  - **Edge cases**
  - **Mobile behavior**
  - **URLs involved** (if any)

Examples in this repo:
- `docs/learning-path-course-list.md`
- `docs/app-shell-app-tsx.md`

---

## 3) “Tool tip” / info tip pattern (required where applicable)

Use the existing pattern doc for admin inline help:
- **Reference**: `docs/patterns-admin-label-info-tip.md`

Checklist (when you touch any inline info tip):
- **Tap/click** opens/closes (no hover-only dependency).
- **Escape** closes.
- **Outside click/tap** closes (capture-phase pointerdown).
- **Mobile (<640px)**: fixed panel uses **top + left/right**, does not stretch-fullscreen.
- **Desktop (≥640px)**: absolute dropdown panel positions under the control.
- **Copy** is short **bullets**, not long paragraphs.

---

## 4) Learning path URLs + layouts (required)

Test these:
- `#/catalog/path/P1`
- `#/catalog/path/P2`

Checklist:
- **Path hero visible**: shows “Learning path”, title, tagline, and a way to return to full catalog.
- **Unknown pathId**:
  - If `P1`/`P2` does not exist in Firestore `learningPaths`, show a clear “unknown path” message (do not silently drop to full catalog).
- **Primary learner list layout**:
  - When the path defines ordered `courseIds`, show **flat course rows** (not a thumbnail grid).
  - Rows show: status icon (clock/check), title, one-line metadata, progress bar + percent (hidden under 600px).
- **Row interaction**:
  - Whole row clickable opens course.
  - Progress bar animates on mount/update.
- **Reload**: refreshing `#/catalog/path/P1` stays on that path.

Reference spec:
- `docs/learning-path-course-list.md`

---

## 5) Catalog filters + navbar browse interactions (required)

### 5.1 Navbar Skills / topic browse

- From **any state** (with existing catalog filters set), select a **Skill** from navbar.
- **Expected**:
  - Clears previous catalog filters
  - Narrows catalog to that selection
  - Does **not** “sync into” the Course filters pill (if using nav-only narrowing)

### 5.2 Course filters pill

- Apply a tag/skill/level from the Course filters control.
- **Expected**:
  - Starts from fresh if spec says so (e.g. clears nav-only narrowing first).
  - No clipped placeholder text in mobile top bar.
  - Search icon hides on focus if enabled.

### 5.3 Learning path → Browse catalog (mobile menu)

- While viewing `#/catalog/path/P1`, open mobile menu and tap **Browse Catalog**.
- **Expected**: leaves path scope and shows full catalog.

---

## 6) Mobile-first UI checks (required)

Run at ~375px width.

- **No horizontal scrolling** due to nav/filter controls.
- Tap targets ~44×44 for icon buttons.
- Catalog filter input:
  - Placeholder readable (no “es…” clipping).
  - Text entry not clipped.
- Notifications bell hidden on mobile while browsing catalog (if desired) does not break navigation.

---

## 7) Responsive checks (required)

Run at:
- **<600px**
- **~768px**
- **≥1024px**

Checklist:
- Layout reflows without overlap.
- Learning path rows:
  - Under 600px, hide progress percent text and shorten metadata per spec.
- Desktop does not hide critical headers (path hero still visible on path URLs).

---

## 8) Access control (roles, creator isolation)

See [`access-control-roadmap.md`](./access-control-roadmap.md). Quick checks:

- **User** (`role: user`): `#/creator` and `#/admin` redirect to catalog (URL updated); no Creator / Admin nav entries; catalog/player use published data only (no `creatorCourses` reads).
- **Creator A**: Creator studio lists only courses/paths with `ownerUid == A`; save/delete works; cannot read another creator’s draft by ID (permission error).
- **Creator B**: Same as A; confirms A’s content never appears in B’s studio list.
- **Admin**: Admin portal available; **Creators** tab can list another UID’s private inventory (read-only UI); Creator studio edits only **own** `ownerUid` drafts (same as creators).
- **Signed out**: `#/creator` / `#/admin` do not leave a stale hash (expect catalog + `#/catalog` or home per app behavior).

---

## 9) Suggested additions (add when relevant)

- **Auth**: signed out vs signed in differences, login redirect return state.
- **Admin guard**: navigating away from Admin with unsaved changes triggers guard.
- **Accessibility**: keyboard nav, focus visibility, aria labels for interactive controls.

