# Pattern: field label + inline info tip (admin)

Use this when a **form field label** (or section title styled like a field label) needs a short **help panel** next to it—without hover-only tooltips or a full separate help page.

**Canonical implementation:** [`AdminCourseCatalogSection.tsx`](../src/components/admin/AdminCourseCatalogSection.tsx) — **Course** row and **Modules and lessons** row (catalog sub-tab).

---

## Visual layout (match other field labels)

Keep the label visually consistent with **Document ID**, **Level**, and other `text-xs` labels in the same form.

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

- Panel: **`position: fixed`**, horizontal inset **`left-3 right-3`**, `z-[120]`, `max-h` with overflow, safe-area padding on bottom.
- **`top`:** set from the **info button** element:  
  `getBoundingClientRect().bottom + gapPx` (e.g. 8px)—see `readFixedTipTopBelowAnchor` in the same file. Recompute on **`scroll`** (capture) and **`resize`** while open so the panel stays under the anchor after layout changes.
- If `top` is not yet valid (e.g. −1), keep the panel **hidden** until layout has run (`useLayoutEffect` after open).

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

1. Same **label typography** as sibling fields: `text-xs font-semibold leading-none text-[var(--text-secondary)]`.
2. Label row **`min-h-6`** + **`items-center`**; **`size-6`** info button + **14px** icon, **`rounded-md`**, **`gap-x-1.5`** between label and control.
3. **If in a grid or shared row with plain labels:** give **every** column the same **`min-h-6`** label wrapper (see **Alignment next to plain labels** above)—not only the column with the tip.
4. **Click/tap** toggle; **Escape** + **capture `pointerdown` outside** to close.
5. **Wide:** absolute below anchor; **narrow:** fixed with **`left-3` / `right-3`** and measured **`top`** under the button; sync on scroll/resize.
6. **`aria-*`** wired as above.
7. Close on **context loss** (tab change, unmount, data cleared).

---

## Related docs

- [admin-portal-content.md](./admin-portal-content.md) — Content tab overview; mentions these rows in the Catalog UI notes.
- [mobile-responsive](../.cursor/rules/mobile-responsive.mdc) — mobile-first layout; this pattern uses a **24px** tip target (WCAG 2.5.8 minimum); larger **`min-h-11`** targets remain appropriate for primary controls elsewhere.
