# Theme and color palette

Allowed **neutral** colors for UI (light and dark) come from a single gray ramp, plus **real orange** only where explicitly allowed. This doc is the source of truth for contributors; the implementation lives in **[`src/index.css`](../src/index.css)**.

## Reference palette (ColorKit)

The neutral ramp matches this shared palette (cold / monochromatic muted grays):

| Step | Hex | Notes |
|------|-----|--------|
| Darkest | `#272828` | Near-black; darkest surfaces and borders (dark theme) |
| | `#393a3a` | |
| | `#4c4d4d` | |
| | `#616161` | |
| | `#757676` | |
| | `#8b8c8c` | |
| | `#a1a2a2` | |
| | `#b8b8b8` | |
| | `#cfcfcf` | |
| Lightest | `#e7e7e7` | Near-white; light theme page background |

**External reference:** [ColorKit — palette 272828…e7e7e7](https://colorkit.co/palette/272828-393a3a-4c4d4d-616161-757676-8b8c8c-a1a2a2-b8b8b8-cfcfcf-e7e7e7/)

## Where it is implemented

| Location | What it defines |
|----------|-----------------|
| [`src/index.css`](../src/index.css) `@theme` | `--color-brand-*`: **true orange** for limited surfaces (e.g. home, navbar). `--color-orange-*`: **remapped to the gray ramp** so existing `orange-*` Tailwind classes stay neutral site-wide. |
| [`src/index.css`](../src/index.css) `:root` | `--tone-950` … `--tone-100`: the ten hex values above (darkest → lightest). **Dark theme** semantic tokens: `--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-color`, `--hover-bg`, etc. |
| [`src/index.css`](../src/index.css) `body.light` | **Light theme** overrides for the same semantic variables. |
| Components | Prefer **`var(--bg-primary)`**, **`var(--text-muted)`**, **`border-[var(--border-color)]`**, etc., so light/dark stay consistent. Use **`brand-*`** only where product rules allow real orange; do not introduce arbitrary hex grays outside this ramp. |

### Light theme and hardcoded hex

`#e7e7e7` is **`--tone-100`**: in **dark** mode it is the main **foreground** (`--text-primary`). In **light** mode the page background *is* `#e7e7e7`, so using that hex for link or button text on a light card makes copy **unreadable**.

- Prefer **`text-[var(--text-primary)]`** (or **`--text-secondary`** for de-emphasized links) so the same component works in both themes.
- Example: auth gate links (“Sign in”, “Create an account”, “Privacy Policy”) use `var(--text-primary)` in [`AuthGatePage.tsx`](../src/components/AuthGatePage.tsx).

## Orange vs “orange” in Tailwind

- **`brand-*`** (e.g. `bg-brand-500`, `text-brand-600`): actual orange. Use sparingly per comments in `index.css` (e.g. home + navbar branding).
- **`orange-*`** in Tailwind: **not literal orange** in this project—they are aliased to the gray scale above so legacy class names do not pull in saturated orange.

## Semantic mapping (summary)

**Dark** (`:root`, default — `body` without `.light`):

- Page background tends toward mid grays (`--bg-primary`, `--bg-secondary` from `--tone-*`).
- Primary text uses the light end of the ramp (`--text-primary` → `--tone-100`).
- Muted text and borders use darker/lighter tones as listed in `index.css`.

**Light** (`body.light`):

- Page background `--bg-primary` → `--tone-100` (`#e7e7e7`), cards often `#ffffff`.
- Primary text `--text-primary` → `--tone-950` (`#272828`).
- Borders and hovers use lighter-tone mixes from the same ramp.

## Rules of thumb

1. **Neutrals:** Stick to `--tone-*` via semantic CSS variables or the approved `orange-*` remaps—not one-off random grays.
2. **Orange:** Use **`brand-*`** only where the design explicitly calls for real accent orange; elsewhere use semantic neutrals.
3. **Contrast:** When adding new surfaces, verify text vs background in both themes (toggle `body.light` in devtools or app theme control).
4. **Pointer:** In [`src/index.css`](../src/index.css), **`a[href]`** and **enabled `<button>`** use **`cursor: pointer`**; **disabled `<button>`** uses **`cursor: not-allowed`**. Specialized controls (e.g. drag **grab**) should set **`cursor-grab` / `cursor-grabbing`** via Tailwind so those utilities override the default button pointer.

## Related files

- [`src/index.css`](../src/index.css) — theme tokens and Tailwind `@theme` remap.
- [`src/components/LearnerPathCourseRowList.css`](../src/components/LearnerPathCourseRowList.css) — example of a component noting theme variables + true `brand` orange for a specific CTA.

When you **change** the ramp or semantic mapping, update this doc and the comment block at the top of the theme section in `index.css` so they stay aligned.
