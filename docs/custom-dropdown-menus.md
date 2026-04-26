# Custom dropdown & listbox menu styling

Item lists that behave like **dropdowns with discrete options** in this repo’s **React UI** use **`AdminListboxSelect`** or **`AdminCatalogCoursePicker`** (portaled, themed, dense rows). Add new pickers the same way rather than raw `<select>`.

## Source of truth

- **Constants:** [`src/ui/customMenuClasses.ts`](../src/ui/customMenuClasses.ts) — import these Tailwind class strings; do not copy-paste long class lists into new components.
- **Reference implementations:** [`AdminCatalogCoursePicker.tsx`](../src/components/admin/AdminCatalogCoursePicker.tsx) (courses + lazy load), [`AdminListboxSelect.tsx`](../src/components/admin/AdminListboxSelect.tsx) (generic string options). Shared placement + z-index: [`adminListboxPanelStyle.ts`](../src/components/admin/adminListboxPanelStyle.ts). Reused option rows (levels, hierarchy audience): [`adminListboxSharedOptions.ts`](../src/components/admin/adminListboxSharedOptions.ts).

## Principles

1. **No `min-h-11` on single-line rows** unless you truly need a fixed 44px hit target without padding — it leaves empty space above/below the text. Prefer **`py-1.5`** + **`leading-none`** so row height follows the label.
2. **Panel vertical padding:** use **`py-0`** on the scrollable list container; space comes from each row’s padding.
3. **Horizontal padding:** listbox rows use **`px-2 sm:px-2.5`**; shell nav rows use **`px-3`**; account rows with icons use **`px-4`** (see constants).
4. **Touch:** `py-1.5` (~12px vertical padding) + `text-sm` + `leading-none` yields roughly **36–40px** row height — acceptable for dense admin lists; increase only where UX testing requires 44px minimum.
5. **Portaled menus** (fixed to `document.body`): keep **`[scrollbar-width:thin]`** and **`[-webkit-overflow-scrolling:touch]`** on scrollable panels when lists can grow long.

## Which constant to use

| UI | Panel | Row |
|----|--------|-----|
| Admin course picker (portal) | `CUSTOM_LISTBOX_PANEL` | `CUSTOM_LISTBOX_OPTION_SINGLE` |
| Generic admin string pickers (`AdminListboxSelect`) | `CUSTOM_LISTBOX_PANEL` | `CUSTOM_LISTBOX_OPTION_SINGLE`; trigger `ADMIN_LISTBOX_TRIGGER` / `ADMIN_LISTBOX_TRIGGER_BODY`. `density="compact"` only narrows panel width to the trigger (e.g. Roles). |
| Admin creator inventory combobox | same panel + your own `absolute`/`max-h`/position | `CUSTOM_LISTBOX_OPTION_TWO_LINE` |
| In-page admin scroll lists (no shadow) | `ADMIN_EMBEDDED_SCROLL_LIST` (+ `max-h-*`, scrollbar utilities) | reuse row tokens or local card layout |
| Path builder folder drill | `ADMIN_EMBEDDED_SCROLL_LIST_DIVIDED` | grid row: `py-1.5` + `leading-none` (see modal code) |
| Path builder course / module / lesson pick | (modal body) | `PATH_MODAL_LIST_ROW_COURSE` / `PATH_MODAL_LIST_ROW_TWO_LINE` |
| Navbar Paths / Skills | `SHELL_DROPDOWN_PANEL` | `SHELL_DROPDOWN_PATH_LINK` / `SHELL_DROPDOWN_SKILLS_BUTTON` |
| Navbar account menu | (existing card layout) | `SHELL_PROFILE_MENUITEM` |
| Navbar notifications | Card list (not a compact menu row spec) | — |
| Course player speed listbox | Local dark surface + scroll container | `OVERLAY_LISTBOX_OPTION_ROW` + your own `text-*` / `hover:*` / `text-[13px]` |

## Admin portal — all tabs (coverage)

| Admin tab / area | Custom lists / menus | Constants (when applicable) |
|------------------|----------------------|------------------------------|
| **Catalog** (`AdminCourseCatalogSection`) | Course picker (portal); level; add category/skill from list; visibility audience; split-divider / change-module-kind / copy-move-place modals | `AdminListboxSelect`, `CUSTOM_LISTBOX_*`, `ADMIN_EMBEDDED_SCROLL_LIST`, `adminListboxSharedOptions` |
| **Paths** (`PathBuilderSection`) | Path toolbar picker; place-duplicate order; place converted module; outline merge modals; add-branch lists; folder drill | `AdminListboxSelect`, `PATH_MODAL_LIST_ROW_*`, `ADMIN_EMBEDDED_SCROLL_LIST_DIVIDED` |
| **Categories & Skills** (`AdminCatalogTaxonomyPanel`) | Linked-courses confirm list | Tighter `ul`/`li` spacing (same rhythm as spec) |
| **Categories** (`AdminCatalogCategoriesPanel`) | Reassign target | `AdminListboxSelect` |
| **Presets / Skill presets** panels | Chips / inputs (no item list menus in scope) | — |
| **Creators** | Same as catalog creator block when on that sub-route | `CUSTOM_LISTBOX_*`, `ADMIN_EMBEDDED_SCROLL_LIST` |
| **AI** (`AdminGeminiModelsSection`) | Editable model list (inputs + reorder) — not a pick menu | Optional future pass; different pattern |
| **Marketing** (`AdminHeroPhoneAdsSection`) | Gradient, text block style, image fit — custom listboxes | `AdminListboxSelect` |
| **Moderation** | Scroll stacks of report/suggestion/contact **cards** | Card `space-y` tightened; not listbox tokens |
| **Roles** | Mobile cards + desktop table role pickers | `AdminListboxSelect` |
| **Alerts** (`AdminPage`) | Mobile section tab + alert type / course / module / lesson | `AdminListboxSelect` |

## Implemented today

- [`AdminCatalogCoursePicker.tsx`](../src/components/admin/AdminCatalogCoursePicker.tsx)
- [`AdminListboxSelect.tsx`](../src/components/admin/AdminListboxSelect.tsx) — all admin item pickers above (with `triggerClassName` / `aria-label` / `onTriggerBlur` as needed)
- [`adminListboxSharedOptions.ts`](../src/components/admin/adminListboxSharedOptions.ts) (course level + hierarchy audience option rows)
- [`CourseHierarchyVisibilityControls.tsx`](../src/components/admin/CourseHierarchyVisibilityControls.tsx) (audience listbox per row)
- [`AdminCreatorInventorySection.tsx`](../src/components/admin/AdminCreatorInventorySection.tsx) (combobox + embedded lists)
- [`PathBuilderSection.tsx`](../src/components/admin/PathBuilderSection.tsx) (path modals + folder drill)
- [`AdminCatalogTaxonomyPanel.tsx`](../src/components/admin/AdminCatalogTaxonomyPanel.tsx) (linked courses list density)
- [`AdminModerationSection.tsx`](../src/components/admin/AdminModerationSection.tsx) (scroll stack spacing)
- [`Navbar.tsx`](../src/components/Navbar.tsx) (Paths, Skills, account menu)
- [`CoursePlayer.tsx`](../src/components/CoursePlayer.tsx) (playback speed — `OVERLAY_LISTBOX_OPTION_ROW` + local colors)

New admin **single-choice lists** should use **`AdminListboxSelect`** (or **`AdminCatalogCoursePicker`** when loading a large course list on first open) so styling and panel placement stay consistent.

## Adding a new custom menu

1. Import from `src/ui/customMenuClasses.ts`.
2. If the panel is **not** admin-primary (`bg-[var(--bg-primary)]`), keep your surface colors local but reuse **`MENU_ROW_PAD_Y`**, **`MENU_ROW_TEXT`**, **`MENU_LISTBOX_PAD_X`** / **`MENU_SHELL_PAD_X`** / **`MENU_SHELL_PAD_X_WIDE`** for row rhythm.
3. Update this doc if you introduce a new variant (e.g. three-line row, destructive-only menu).
