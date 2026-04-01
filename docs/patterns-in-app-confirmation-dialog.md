# Pattern: in-app confirmation and alert dialogs

Use **in-app modal dialogs** for destructive confirmations, permission errors, and other outcomes where the user must **read and choose** before continuing. Do **not** use `window.confirm`, `window.alert`, or `window.prompt` in product UI—they break theming, mobile layout, accessibility expectations, and consistency with the rest of SkillLearn.

---

## Policy

| Do | Don’t |
|----|--------|
| Render a **fixed overlay** + **panel** inside React, with app tokens (`var(--bg-secondary)`, borders, orange primary actions where appropriate). | Block the UI with **native browser dialogs**. |
| Wire **Escape** (dismiss / cancel) and **Enter** (primary action when focus is not in a text field) via [`useDialogKeyboard`](../src/hooks/useDialogKeyboard.ts). | Rely only on mouse for dismissal of important flows. |
| Lock page scroll with [`useBodyScrollLock`](../src/hooks/useBodyScrollLock.ts) while any such overlay is open. | Leave `body` scrollable under a full-screen modal. |
| Give the overlay **`role="dialog"`**, **`aria-modal="true"`**, **`aria-labelledby`** (title id), **`aria-describedby`** (body id). | Ship modal-looking UI without basic dialog semantics. |

---

## Hooks (required wiring)

### `useBodyScrollLock`

Pass **`true`** when **any** blocking overlay managed by that component is open. The hook is **reference-counted** globally: multiple open locks stack; the last release restores scroll.

Example (two mutually exclusive dialogs in one section):

```tsx
useBodyScrollLock(saveErrorDialog !== null || resetDefaultsDialogOpen);
```

### `useDialogKeyboard`

Call **once per dialog `open` state** (each hook registers its own listener). When a dialog opens, only one should be `open: true` at a time in normal UX; if two could overlap, prioritize which gets keyboard handling or consolidate state.

| Option | Role |
|--------|------|
| `open` | Whether this dialog is visible. |
| `onClose` | **Escape** and typically matches “cancel” / backdrop dismiss. |
| `onPrimaryAction` | **Enter** when focus is not in textarea, text `<input>`, `<select>`, or on a button/link (those keep native behavior). Optional for simple “OK only” alerts—use the same handler as `onClose`. |
| `closeOnEscape` | Default `true`. Set `false` only when Escape must not dismiss (rare). |

Reference implementation: [`AdminHeroPhoneAdsSection.tsx`](../src/components/admin/AdminHeroPhoneAdsSection.tsx) (Firestore save error + “Replace draft slides?” confirmation).

---

## Layout and visuals (match existing modals)

Canonical structure lives in **`AdminHeroPhoneAdsSection`**: save-error dialog and reset-defaults confirmation share the same shell.

1. **`AnimatePresence`** around the conditional root so enter/exit animations run.
2. **Overlay** (`fixed inset-0 z-[100]`): `flex items-end justify-center` on narrow viewports (sheet-like bottom alignment), `sm:items-center` on larger screens; `bg-black/60 backdrop-blur-sm`; padding including `pb-[max(1rem,env(safe-area-inset-bottom,0px))]` for notched phones.
3. **Backdrop click:** `onClick` on the overlay; if `e.target === e.currentTarget`, call **cancel/close** (same as Escape for confirmations).
4. **Panel:** `motion.div` from `motion/react` with short opacity/y transition; `w-full max-w-lg`, `rounded-2xl sm:rounded-3xl`, border + `bg-[var(--bg-secondary)]`, `shadow-2xl`; **`onClick` stopPropagation** so clicks inside don’t close.
5. **Header:** title (`h2` with stable `id` for `aria-labelledby`) + **X** close button (`aria-label="Close"`).
6. **Body:** descriptive copy with `id` for `aria-describedby`.
7. **Footer:** `border-t`; actions with **`min-h-11`** touch targets. For **confirm/cancel**, use a column on small screens (`flex flex-col gap-3`) with **secondary first**, **primary last** (primary at bottom on phone). On `sm:` use `flex-row justify-end` with appropriate gap.

**Primary action** (confirm, OK): `bg-orange-500` / `hover:bg-orange-600` matches other admin emphasis. Use **`autoFocus`** on the primary button when it is safe (no competing inputs inside the dialog).

---

## Copy and behavior

- **Title:** short question or outcome (“Replace draft slides?”, “Couldn’t save to Firestore”).
- **Body:** state the risk clearly (e.g. draft overwritten until save).
- **Cancel** vs **confirm:** cancel closes without side effects; confirm runs the mutation then closes (and may show a **toast** for success—toast is fine for lightweight feedback after the dialog closes).

---

## Where this pattern already appears

Use these as templates when adding new flows:

| Area | File | Notes |
|------|------|--------|
| Hero phone ads | [`AdminHeroPhoneAdsSection.tsx`](../src/components/admin/AdminHeroPhoneAdsSection.tsx) | Save error + replace-with-defaults confirmation. |
| Admin navigation guard | [`AdminPage.tsx`](../src/components/AdminPage.tsx) | Unsaved changes. |
| Admin exit (app shell) | [`App.tsx`](../src/App.tsx) | `adminExitGuardOpen`. |
| Content / catalog | [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx) | Multiple dialogs + keyboard hooks. |
| Path builder | [`PathBuilderSection.tsx`](../src/components/admin/PathBuilderSection.tsx) | Confirmations. |
| Profile | [`ProfilePage.tsx`](../src/components/ProfilePage.tsx) | Delete confirm, modals. |
| Course player | [`CoursePlayer.tsx`](../src/components/CoursePlayer.tsx) | Several dialog keyboards + scroll lock. |

---

## Checklist for a new confirmation

1. **State:** `useState(false)` or nullable payload for dialogs that need extra data (e.g. error message).
2. **Trigger:** button opens dialog; **no** `window.confirm`.
3. **`useBodyScrollLock`** includes this dialog’s open flag (combine with `||` if multiple).
4. **`useDialogKeyboard`** with `onClose` = cancel, `onPrimaryAction` = confirm (or same as close for single-button alerts).
5. **Markup:** `role="dialog"`, `aria-modal`, labelled title, described body, backdrop and X dismiss = cancel.
6. **Mobile:** verify **~375px** width—readable text, full-width buttons with `min-h-11`, safe-area padding on overlay.

---

## Lint / grep

The codebase should stay free of native blocking dialogs for UX flows:

```bash
rg 'window\.(confirm|alert|prompt)' src
```

If a third-party or debug-only exception is ever required, document it next to the call site; product-facing confirmations belong in this pattern.
