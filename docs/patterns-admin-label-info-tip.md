# Pattern: field label + inline info tip (admin)

Use this when a **form field label** (or section title styled like a field label) needs a short **help panel** next to it—without hover-only tooltips or a full separate help page.

---

## Adherence (do not skip)

Treat the bullets below as **requirements** for any new label + info tip in admin UI. The reference implementation already follows them.

| Area | Rule |
|------|------|
| **Copy** | **Concise bullet list only** (`<ul>` / `<li>`). One idea per bullet. No long paragraphs inside the panel. Prefer `space-y-1.5` / `sm:space-y-1` between items. |
| **Label + control** | **`text-xs font-semibold leading-none`**, label row **`min-h-6`** + **`items-center`**, info **`size-6`**, icon **14px**, **`rounded-md`**, **`gap-x-1.5`**. Do **not** use **`min-h-11`** on the info button. |
| **Grid neighbors** | If the label row sits in a **multi-column row**, **every** column’s label band uses **`min-h-6`** + **`items-center`** so controls align (not only the column with the tip). |
| **Interaction** | **Click/tap** to open/close only—**no hover-only** disclosure. **Escape** and **capture-phase `pointerdown`** outside the wrapper close the panel. **No `window.scrollBy`** when opening. |
| **Narrow (&lt;640px)** | Fixed panel: **`top`** from **`readFixedTipTopBelowAnchor`**, **`left-3` / `right-3`**. **Never** set **`bottom`** on the panel (it **stretch-fills** the viewport and empty space dominates for short tips). **Shrink-wrap** height with **`height: auto`**; cap with **`max-height`** via **`narrowAdminTipPanelStyle`** (**`top`** + **`--admin-tip-top`**) and the **`max-h-[calc(100dvh-var(--admin-tip-top)-…)]`** class. **`overflow-y-auto`** when content exceeds the cap. Re-sync **`top`** on **`scroll`** (capture) + **`resize`**. |
| **Wide (≥640px)** | **`absolute`**, **`top-full`**, **`mt-2`**, bounded width, **`text-xs`** body. |
| **A11y** | **`aria-expanded`**, **`aria-controls`**, **`aria-label`** (open vs close), panel **`id`** + **`role="region"`**. |
| **Lifecycle** | Close when **context goes away** (sub-tab, no draft, collapsing section, etc.). Reset fixed-top state when closing or leaving narrow mode. |

**Helpers / symbols** (see [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx)): **`TIPS_NARROW_MAX_PX`**, **`useTipsNarrowViewport`**, **`readFixedTipTopBelowAnchor`**, **`narrowAdminTipPanelStyle`**.

---

**Canonical implementation:** [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx):

- **Course** row and **Modules and lessons** (catalog sub-tab).
- **Categories** (Course details): **label + info** tip with short bullets (required count; when custom names hit library filters). Closing **Course details** closes the tip; same narrow/wide panel behavior as the other tips.

**Shared component (Marketing / reuse):** [`adminLabelInfoTip.tsx`](../src/components/admin/adminLabelInfoTip.tsx) exports **`AdminLabelInfoTip`** (same interaction, narrow/wide placement, and bullet list wrapper). **Marketing** tab: [`AdminHeroPhoneAdsSection.tsx`](../src/components/admin/AdminHeroPhoneAdsSection.tsx) — tips on the section title, default auto-advance, custom ads toggle, slides header, per-slide duration, and **Image URL** per image block. Use **`controlOnly`** when the label is separate (e.g. checkbox text or section `h2`).

**Disclosure widgets** for heavy admin rows (catalog **modules/lessons**, Marketing **slides**, etc.) are documented in [patterns-admin-disclosure-widgets.md](./patterns-admin-disclosure-widgets.md) (accordion: one module, one lesson, one slide editor at a time).

---

## Visual layout (match other field labels)

Keep the label visually consistent with **Document ID**, **Level**, and other `text-xs` labels in the same form.

**Tip body:** keep copy **short**—**bullet list** only (`<ul>` / `<li>`), one idea per line; avoid long paragraphs inside the panel.

**Label row**

- Wrapper: `flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1` — **`min-h-6`** matches the **`size-6`** info button so the row height matches sibling columns in a grid (plain labels in other columns should use the same **`min-h-6`** + **`items-center`** wrapper so inputs line up horizontally).
- Label (or `h3` if you need a heading for semantics):  
  `text-xs font-semibold leading-none text-[var(--text-secondary)]`

**Info control** (sits beside the label, not below it)

- **Size with the label**, not like a primary action: `inline-flex size-6 shrink-0` (~24×24px), `rounded-md`, border + background matching admin inputs.
- Icon (Lucide **Info**): **`size={14}`** so it fits the control; orange accent can match existing admin accents (`text-orange-500/90`).
- Do **not** use `min-h-11` here—that is for full-width controls (selects, sub-tab buttons). The compact **`size-6`** control aligns with the **`text-xs`** label row.

**Structure**

```text
<div class="flex min-h-6 … items-center …">  <!-- label row: fixed band height -->
  <label class="text-xs font-semibold leading-none …">…</label>
  <span class="relative inline-flex shrink-0 items-center gap-1">  <!-- positioning root -->
    <button type="button" ref={…} … />
    <div id="…" role="region" …>  <!-- panel: hidden | absolute | fixed --></div>
  </span>
</div>
```

---

## Alignment next to plain labels (grids / multi-column rows)

The info button sets a **minimum label-row height** (~24px for `size-6`). Neighboring columns that only show text labels often have a **shorter** first row, so their inputs sit **higher** than the column with the tip—see **Course** vs **Document ID** / **Level** in the catalog editor.

**Do this whenever the tip shares a horizontal row with other fields:**

1. **Tip column:** label row uses **`min-h-6`** + **`items-center`** (and **`leading-none`** on the label text) so height matches the **`size-6`** control.
2. **Sibling columns:** wrap each plain label in **`flex min-h-6 min-w-0 items-center`** and use **`leading-none`** on the same **`text-xs font-semibold …`** classes.

That keeps the **label band** the same height in every column, so **`gap-1` (or your chosen gap) + control** lines up across the grid. Without step 2, only the tip column changes and the layout looks “broken” even though the tip behavior is correct.

---

## Interaction (no hover-only tips)

- **Open / close:** `click` / `tap` on the button only (`aria-expanded` toggles).
- **Close:** **Escape** (`keydown` on `window`).
- **Close:** **`pointerdown`** on `document` in **capture** phase; ignore if target is inside the **wrapper** `span` (label + button + panel). This closes when tapping outside without relying on hover.
- **Do not** auto-scroll the window when the panel opens; let the user scroll if content is long.

---

## Responsive panel placement

Breakpoint matches Tailwind **`sm`** (640px): **narrow** = `max-width: 639px` (constant `TIPS_NARROW_MAX_PX` in the catalog section).

**Wide (≥640px)**

- Panel: `absolute left-0 top-full z-50 mt-2`, constrained width (`max-w-sm`, `min(22rem, calc(100vw - 2rem))`), `text-xs` body, scroll if needed.

**Narrow (&lt;640px)**

- Panel: **`position: fixed`**, **`left-3 right-3`**, measured **`top`** only—**do not** set **`bottom`** on the panel, or it **stretches** to the viewport and leaves a huge empty area for short tips.
- **Height:** default **`height: auto`** so the box **shrink-wraps** content. Cap with **`max-height: calc(100dvh - var(--admin-tip-top) - env(safe-area-inset-bottom, 0px) - 0.75rem)`** by setting **`--admin-tip-top`** inline to the same px as **`top`** (see **`narrowAdminTipPanelStyle`** in [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx)). Use **`overflow-y-auto`**, **`overflow-x-hidden`**, **`-webkit-overflow-scrolling: touch`** so long content scrolls inside the cap.
- **`top`:** from **`readFixedTipTopBelowAnchor`**. Recompute on **`scroll`** (capture) and **`resize`** while open.
- If `top` is not yet valid (e.g. −1), keep the panel **hidden** until layout has run (`useLayoutEffect` after open).

**Anti-patterns (narrow)**

- **`bottom: …`** (or Tailwind **`bottom-*`**) on the **same** fixed tip panel as **`top`** → full-viewport-height sheet; **rejected** for this pattern.
- **`max-h` tied only to `vh` without `--admin-tip-top`** → panel can still extend below the fold or cap wrong; use the **same anchor px** in **`top`** and in the **`max-height`** calc via **`--admin-tip-top`**.
- **Long prose** or **single multi-sentence `<p>`** as the tip body → **rejected**; split into **short bullets** (see **Adherence** table).

---

## Accessibility

- Button: `aria-expanded`, `aria-controls` → panel `id`, `aria-label` that reflects open vs closed (e.g. “Open … tips” / “Close … tips”).
- Panel: unique `id`, `role="region"`, `aria-label` describing the content.
- Optional: when narrow + fixed + open, `tabIndex={-1}` on the panel and `onPointerDown` to `focus({ preventScroll: true })` so keyboard users can move focus into scrollable content (see catalog implementation).

---

## State hygiene (per feature)

Close tips when context that owns them disappears—for example:

- Leaving a sub-tab or route that showed the tips.
- Clearing the underlying entity (e.g. no draft selected).

Reset **fixed `top`** state when the panel closes or when switching from narrow to wide viewport.

---

## Checklist for a new label + tip

1. **Copy:** short **`<ul>` / `<li>`** only; one idea per bullet; no paragraph blocks (see **Adherence**).
2. Same **label typography** as sibling fields: `text-xs font-semibold leading-none text-[var(--text-secondary)]`.
3. Label row **`min-h-6`** + **`items-center`**; **`size-6`** info button + **14px** icon, **`rounded-md`**, **`gap-x-1.5`** between label and control (no **`min-h-11`** on the info control).
4. **If in a grid or shared row with plain labels:** give **every** column the same **`min-h-6`** label wrapper (see **Alignment next to plain labels** above)—not only the column with the tip.
5. **Click/tap** toggle; **Escape** + **capture `pointerdown` outside** to close; **no** **`window.scrollBy`** on open.
6. **Wide:** `absolute` below anchor, bounded width, **`text-xs`** body.
7. **Narrow:** `fixed`, **`left-3` / `right-3`**, **`narrowAdminTipPanelStyle(top)`** (or equivalent **`top` + `--admin-tip-top`**), **`max-h-[calc(100dvh-var(--admin-tip-top)-…)]`**, **no `bottom`** on the panel, **`overflow-y-auto`**; sync **`top`** on **scroll** (capture) + **resize**; hide until **`top`** valid.
8. **`aria-*`** wired as in **Accessibility**.
9. Close on **context loss**; reset fixed-top state when closing or leaving narrow mode.

---

## Related docs

- [admin-portal-content.md](./admin-portal-content.md) — Content tab overview; mentions these rows in the Catalog UI notes.
- [mobile-responsive](../.cursor/rules/mobile-responsive.mdc) — mobile-first layout; this pattern uses a **24px** tip target (WCAG 2.5.8 minimum); larger **`min-h-11`** targets remain appropriate for primary controls elsewhere.
