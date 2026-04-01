# Access control: roles, creator isolation, and task roadmap

Notes for **contributors** and **QA**: how **admin**, **creator** (any number, e.g. creator1 / creator2), and **user** interact with data, plus **ordered tasks** with dependencies and test criteria. Pick tasks in order; finish and test each slice before moving on.

**Code touchpoints:** `firestore.rules` (`creatorCourses`, `creatorLearningPaths`, `users`), `src/utils/userProfileFirestore.ts` (`UserRole`), `src/utils/creatorCoursesFirestore.ts` (owner-scoped queries), `src/utils/creatorCatalogSession.ts` + catalog `useEffect` in `App.tsx` (session hydration — see §8).

---

## 1. Concepts

| Concept | Meaning |
|--------|--------|
| **Role** | Who the signed-in account is: `user` \| `creator` \| `admin` on `users/{uid}` (`UserRole` in code). |
| **Ownership** | Creator-owned docs live in `creatorCourses` and `creatorLearningPaths` with **`ownerUid`** = Firebase `uid` of that creator. **Creator1 vs creator2** is two different `ownerUid` values, not two role names. |
| **Isolation** | A creator must only **query** and **see** docs where `ownerUid == their uid`. Rules must allow **read/write only for owner or admin** on those collections. |
| **Scope (optional)** | Extra fields like `visibility` (`all` / signed-in / etc.) apply to **published / catalog** content; they do not replace `ownerUid` for private creator drafts. |

**Rule of thumb:** Security is **`role` + `ownerUid` + matching queries**. Admins get a deliberate bypass for support/audit.

---

## 2. How it works end-to-end (this repo)

1. **`users/{uid}`** holds `role: 'user' | 'creator' | 'admin'`.
2. **Firestore rules** (`firestore.rules`): `creatorCourses` / `creatorLearningPaths` — **read** if `resource.data.ownerUid == request.auth.uid` **or** `isAdmin()` (inventory/audit). **Writes** if `ownerUid` on the document matches `request.auth.uid` and **`hasCreatorRole() || isAdmin()`**, with `ownerUid` unchanged on update. Learners never need these collections; the public catalog uses **`publishedCourses`** (and related published data).
3. **Client** loads creator inventory with **`loadCreatorCoursesForOwner(ownerUid)`** (`where('ownerUid', '==', ownerUid)`). Admin inventory uses **`listCreatorCoursesForAdminByOwner`** / **`listCreatorLearningPathsForAdminByOwner`** (same query; allowed because reads are admin-wide).
4. **Client write guard:** `saveCreatorCourse` and `saveCreatorLearningPath` refuse when `ownerUid !== auth.currentUser.uid` so the app never attempts cross-owner writes from the studio.
5. **UI** (`App.tsx`, `Navbar.tsx`): **`#/creator`** only when signed in and `(role === 'creator' || isAdmin)` after `subscribeUserRole` resolves; otherwise URL is replaced with catalog. **`#/admin`** only for admins, with the same URL sync on kick-out. **Creator studio** is only composed from `CreatorPage` → `AdminCourseCatalogSection` with `catalogPersistence: { kind: 'creator', ownerUid: user.uid }`.
6. **Browse Catalog (learner grid)** for a signed-in **creator** or **admin**: `App` builds **`mergeOwnerPreviewCourseRows`** (all published rows, then all creator drafts — duplicate ids allowed) and **`mergeOwnerPreviewPaths`** (`learnerCatalogMerge.ts`). Draft rows use **`fromCreatorDraft`** for the **Draft** badge and for disambiguating selection vs the published row with the same id. Other users still only receive published data (no merge). Path outline uses **`creatorLearningPaths`** when the path id is in the user’s draft set (`usePathMindmapOutlineChildren`). **Session hydration** for this merge is documented in **§8** (do not regress).

---

## 3. Task list (priority, dependency, test)

Work **top to bottom**. Do not start a task until its **Depends on** items are done and tested.

### Phase A — Foundation (data & identity)

| ID | Task | Priority | Depends on | Done when / test |
|----|------|----------|------------|-------------------|
| **A1** | **`users/{uid}.role` is correct** for test accounts: one `admin`, two `creator`, one `user`. | P0 | — | In Firestore Console (or admin UI), each test user’s doc shows expected `role`. |
| **A2** | **App reads role after sign-in** (`fetchUserRole` / `subscribeUserRole`) and derives `isAdmin`, `isCreator`, default `user`. | P0 | A1 | Sign in as each role; UI or logs show correct role (no stale `user` for creators/admins). |

### Phase B — Server-side enforcement (Firestore)

| ID | Task | Priority | Depends on | Done when / test |
|----|------|----------|------------|-------------------|
| **B1** | **Rules for `creatorCourses` / `creatorLearningPaths`**: read = owner OR admin; create/update/delete = creator with matching `ownerUid`; `ownerUid` cannot change on update. | P0 | A1 | Rules deploy succeeds; Emulator or Console rules simulator: creator A **denied** read on creator B’s doc; **admin** allowed read. |
| **B2** | **`users` collection rules**: only admins can set `role` to `creator`/`admin` (match existing policy); users cannot escalate. | P0 | A1 | Non-admin cannot write `role: 'admin'` on their own doc (verify in emulator or blocked write). |

### Phase C — Client queries & creator studio

| ID | Task | Priority | Depends on | Done when / test |
|----|------|----------|------------|-------------------|
| **C1** | **All creator-studio list/load paths** use **owner-scoped queries** (`ownerUid == auth.currentUser.uid`). No `getDocs(collection(...))` without filter for non-admin. | P0 | B1, A2 | Signed in as creator1: list shows only creator1’s courses. Network tab / Firestore usage shows filtered query only. |
| **C2** | **Saves set `ownerUid`** to current user on create; never trust client to pick another user’s uid without admin flow. | P0 | C1 | New course doc in Console has `ownerUid` = creator’s uid. |
| **C3** | **Admin inventory / audit** uses explicit admin APIs (e.g. `listCreatorCoursesForAdminByOwner(ownerUid)` or filter-by-UID in admin UI), not the creator’s self-scoped query. | P1 | B1, A2 | Admin can open inventory, enter creator2’s uid, see their courses; creator2 cannot do the same for creator1’s uid via normal studio. |

### Phase D — Routing & UX guards

| ID | Task | Priority | Depends on | Done when / test |
|----|------|----------|------------|-------------------|
| **D1** | **Creator routes** (`#/creator`, etc.): only `role === 'creator'` or `admin` if you allow admins in studio—document the choice. | P0 | A2 | `user` navigates to creator URL → redirect or deny; `creator` OK. |
| **D2** | **Admin routes**: only `isAdmin`. | P0 | A2 | `creator` and `user` cannot open admin panels. |
| **D3** | **Nav links**: show Creator entry only for creators (and admins if desired); Admin only for admins. | P1 | D1, D2 | Each role sees only appropriate nav. |

### Phase E — Learner (`user`) vs catalog

| ID | Task | Priority | Depends on | Done when / test |
|----|------|----------|------------|-------------------|
| **E1** | **Learner app** reads only **published / catalog** collections and visibility rules—not raw `creatorCourses` unless you explicitly publish into a public shape. | P0 | (catalog design) | Signed in as `user`: can complete learner flows; no Firestore permission errors on creator collections. |
| **E2** | If **publishing** copies or references creator drafts → define one flow (admin publish, or creator “publish” to a public collection) and test **user** sees content, **other creator** does not see draft. | P1 | E1, C2 | End-to-end: creator1 publishes → user sees; creator2 does not see creator1’s draft in studio. |

### Phase F — Regression & hardening

| ID | Task | Priority | Depends on | Done when / test |
|----|------|----------|------------|-------------------|
| **F1** | **Matrix test** (manual or scripted): for each action (list/read/write/delete), verify admin / creator1 / creator2 / user. | P1 | A–E | Short checklist table; all cells behave as expected. |
| **F2** | **Direct document ID guess**: as creator2, open or fetch creator1’s course ID (if known) → must **fail** at rules. | P1 | B1 | Permission denied in app or rules. |

---

## 4. Dependency graph (summary)

```
A1 (user roles in DB)
  → A2 (app reads role)
      → D1, D2, D3 (routing/nav)
      → C3 (admin UI)

A1 → B1, B2 (rules)
  → C1, C2 (creator queries + saves)
      → E2 (publish flow)

E1 (learner reads catalog) can parallelize with C* once B1 is stable

F1, F2 after main phases
```

---

## 5. Role matrix (target behavior)

| Actor | `creatorCourses` / `creatorLearningPaths` | Admin UI | Learner catalog |
|--------|--------------------------------------------|----------|-----------------|
| **admin** | Read (and policy-defined write) all | Full access | As designed |
| **creator** | Read/write **own** `ownerUid` only | No (unless also admin) | As learner if you allow |
| **user** | No access | No | Read per visibility rules |

---

## 6. Admin accounts without `role: 'creator'`

**Decision (implemented):** Admins with `role: 'admin'` only may open **Creator studio** and read/write **`creatorCourses` / `creatorLearningPaths` only where `ownerUid == their Firebase uid`** (same as creators). They can **read any** creator doc for support via **`isAdmin()`** on read rules. They **cannot** write another creator’s drafts via the API (rules enforce `ownerUid == request.auth.uid` on creates/updates/deletes). Cross-creator edits would require a Cloud Function or admin tool that uses elevated server credentials—not the current client SDK paths.

---

## 7. Suggested order to ship

- **Minimum for creator isolation:** Phases **A → B → C → D**.
- **Learners on published content:** **E**.
- **Confidence before “done”:** **F**.

---

## 8. Browse catalog: creator draft delay & session cache (do not regress)

**Problem we hit:** Published courses could appear immediately from **`peekResolvedCatalogCourses()`** (`publishedCoursesFirestore.ts` → `sessionStorage`), while **creator drafts** only existed after **`creatorCourses` / `creatorLearningPaths`** returned. That made drafts (and merged navbar paths) feel “late” or like a second load wave. A follow-on attempt to **`Promise.all` all four reads** (published, public paths, creator courses, creator paths) **before any paint** made the **entire** grid wait on the **slowest** query—often worse UX than the two-phase approach.

**Implemented pattern (stale-while-revalidate):**

| Piece | Role |
|--------|------|
| **`src/utils/creatorCatalogSession.ts`** | **`peekResolvedCreatorCatalog(ownerUid)`** / **`writeResolvedCreatorCatalog`**: last **draft courses + draft paths** per owner in `sessionStorage` + in-memory (same-tab remount). **`peekMergedCatalogLearningPaths(expectedUid)`** / **`writeMergedCatalogLearningPaths`**: last **merged** navbar path list for that Firebase `uid` (or `null` when signed out). |
| **`App.tsx` catalog `useEffect`** | Start **creator** queries **in parallel** with published/paths. After the **first** `await` on published + public paths only, paint **`mergeOwnerPreviewCourseRows(published, cachedDrafts)`** and **`mergeOwnerPreviewPaths(pubPaths, cachedDraftPaths)`** using **`peekResolvedCreatorCatalog`**, not an empty draft list. When Firestore returns, replace with live data and **call the `write*` helpers** so the next reload is instant. **`fetchCatalogSnapshot`** (refresh) must **also** update these writes. |
| **Initial `useState` in `App.tsx`** | Hydrate **`catalogCourseRows`**, **`learningPaths`**, **`catalogPrivatePathIds`**, **`liveCatalogHydrated`**, **`learningPathsFetched`** from published peek + creator session where **`readCachedAuthProfile()`** uid matches (same rules as merged-paths uid). |

**Do not:**

- Replace the two-phase creator flow with **one** `Promise.all` of four queries **before** the first catalog paint for preview users, unless you explicitly accept **slower time-to-first-pixel** for the whole grid.
- Drop the **session writes** after a successful load, or drafts will lose “instant on refresh” behavior.
- Use **`mergeOwnerPreviewCourseRows(published, [])`** on the first paint for creator/admin preview without substituting **cached** drafts (that recreates the visible delay).

**First visit / empty cache:** There is still **network** latency until the first successful Firestore snapshot; only **repeat** visits (or same tab after first load) get synchronous hydration from session.

---
