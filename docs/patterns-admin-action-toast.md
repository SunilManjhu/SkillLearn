## Admin action toast pattern

This project uses a **single, mobile-first toast** for short-lived admin feedback (success/danger/neutral). The toast:

- Renders via a **React portal** into `document.body` so it **does not participate in layout** (no `space-y-*` gaps, no scroll ancestor side-effects).
- Is **mobile-first**: full width between side insets + safe-area bottom on phones; becomes a bottom-right “chip” from `sm` up.
- **Auto-dismisses** after a short timeout, but **pauses while hovered or keyboard-focused** so users can read longer messages.

### Where it lives

- **Hook**: `src/components/admin/useAdminActionToast.tsx`
- **Usage pattern**:
  - Call `const { showActionToast, actionToast } = useAdminActionToast();`
  - Render `{actionToast}` somewhere inside your component JSX.
  - Call `showActionToast(message, variant)` when needed.

### API

`showActionToast(msg: string, variant?: 'success' | 'danger' | 'neutral')`

- **success**: emerald styling (default)
- **danger**: red styling
- **neutral**: muted styling

### Behavior rules

- **Single toast at a time**: new calls replace the previous toast and reset the timer.
- **Auto-dismiss**: default timeout is controlled by `TOAST_MS` in the hook.
- **Pause-to-read**:
  - Hovering the toast pauses the timer.
  - Focusing the toast (keyboard) pauses the timer.
  - Leaving/blur resumes with the remaining time (min 250ms).
- **Accessibility**:
  - Toast uses `role="status"` with `aria-live="polite"`.
  - Toast is focusable (`tabIndex={0}`) so keyboard users can pause it.

### When to use

Use the toast for:

- Save success/failure
- “Updated…” summaries
- Non-blocking validation feedback

Avoid using the toast for:

- Decisions that require confirmation (use an in-app modal/dialog)
- Long multi-step flows where progress needs persistent UI (use inline status UI)

### Recommended message style

- Keep it short. Prefer one sentence.
- If you must include details (e.g., which courses were updated), show a small number of names and summarize the rest:
  - Example: `Updated 7 courses: Intro to React, Hooks Deep Dive, C12 (+4 more).`

