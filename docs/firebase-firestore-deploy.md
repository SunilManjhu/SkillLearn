# Deploying Firestore security rules (SkillLearn)

This project uses a **named Firestore database**, not only the default `(default)` database. Rules must be published to the **same database** the app uses, or you will see `permission-denied` and other mismatches even when local `firestore.rules` is correct.

Always take **current** `projectId` and `firestoreDatabaseId` from `firebase-applet-config.json` at the repo root. The examples below match the layout as of this doc; if config changes, update `firebase.json` to stay in sync.

---

## 1. Which project and database?

| Source | What to read |
|--------|----------------|
| Firebase project | `projectId` in `firebase-applet-config.json` |
| Firestore database | `firestoreDatabaseId` in `firebase-applet-config.json` |

The web client initializes Firestore with that database id (see `src/firebase.ts`).

---

## 2. CLI deploy (repeatable, version-controlled)

### Prerequisites

- [Firebase CLI](https://firebase.google.com/docs/cli) installed (`firebase --version`).
- Logged in: `firebase login`. If deploy fails with an auth error, run `firebase login --reauth`.

### Command (from repo root)

```bash
npm run deploy:rules
```

This runs `firebase deploy --project <projectId> --only firestore:rules` using the `projectId` pinned in `package.json` scripts. Ensure that `projectId` matches `firebase-applet-config.json`.

### Why `firebase.json` matters

`firebase.json` must list **your named database** so the CLI deploys rules to it, not only to `(default)`:

```json
{
  "firestore": [
    {
      "database": "<same-as-firestoreDatabaseId-in-firebase-applet-config.json>",
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    }
  ]
}
```

If `firestoreDatabaseId` in the applet config ever changes, update `firebase.json` → `firestore[].database` to the same value before deploying.

### After deploy

- In Firebase Console → Firestore → select the **named** database → **Rules**, confirm the published text matches what you expect (or the timestamp updated).
- Retry the app flow that was failing (e.g. admin save to `siteSettings/heroPhoneAds`).

---

## 3. Console deploy (manual paste)

Use when the CLI is blocked (auth, CI, or you need an immediate publish).

1. Open [Firebase Console](https://console.firebase.google.com/) and select the project (`projectId` from config).
2. Go to **Build** → **Firestore Database**.
3. **Critical:** Use the database **selector** (if your project has multiple databases) and choose the database whose id equals **`firestoreDatabaseId`** from `firebase-applet-config.json`. Do **not** assume `(default)` unless the app actually uses it.
4. Open the **Rules** tab.
5. Paste the **entire** contents of the repo file `firestore.rules` (root of the repo).
6. Click **Publish**.

Manual publish to the **correct** named database fixed production behavior in cases where the app was pointed at that DB but rules had only been updated elsewhere.

---

## 4. Verification checklist

- [ ] Edited file is repo-root `firestore.rules`.
- [ ] Target **project** matches `firebase-applet-config.json` → `projectId`.
- [ ] Target **database** matches `firebase-applet-config.json` → `firestoreDatabaseId`.
- [ ] `firebase.json` `firestore[].database` matches `firestoreDatabaseId` (for CLI deploys).
- [ ] After publish, retest writes/reads that depend on the new rules.

---

## 5. Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| `permission-denied` after “deploying” rules | Rules published to **wrong database** (e.g. `(default)` only) or wrong project. Confirm in Console with the **named** DB selected. |
| CLI: credentials / auth errors | `firebase login --reauth`, then `npm run deploy:rules` again. |
| Rules look correct locally but app disagrees | Stale rules on the DB the app uses; republish to that DB via CLI or Console. |
| Validating rules | Firebase Console **Rules Playground**: select the **same** database the app uses when simulating requests. |

---

## 6. Related files (repo)

- `firestore.rules` — source of truth for security rules in git.
- `firebase.json` — maps rules file + **named** database for CLI.
- `firebase-applet-config.json` — `projectId`, `firestoreDatabaseId` used by the web app.
- `package.json` → script `deploy:rules` — deploy command for this project.

For AI assistants: when the user changes `firestore.rules` or reports Firestore permission issues, remind them that rules must be **published to the named database** in `firebase-applet-config.json`, and point them to this document.
