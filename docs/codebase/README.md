# Codebase file reference

Technical inventory of **every application source file** in this repo (TypeScript/TSX), plus **build/config/styling** entry points. Each entry states **role**, **main exports**, and **typical consumers** so developers and AI assistants can navigate without opening every file.

**Convention:** Paths are relative to the repository root. Firestore-backed modules are named `*Firestore.ts`. Deeper narratives live in [../app-shell-app-tsx.md](../app-shell-app-tsx.md), [../admin-portal-content.md](../admin-portal-content.md), [../admin-reorder-scroll-viewport.md](../admin-reorder-scroll-viewport.md), and [../development-and-debugging.md](../development-and-debugging.md).

## Index (by file group)

| File | Contents |
|------|----------|
| [inventory-entry-and-config.md](./inventory-entry-and-config.md) | `main.tsx`, `App.tsx`, `firebase.ts`, `vite-env.d.ts`, `youtube-global.d.ts`, `vite.config.ts`, `src/index.css`, Firebase/TS config JSON, `firestore.rules` |
| [inventory-data-hooks.md](./inventory-data-hooks.md) | `src/data/*`, `src/hooks/*` |
| [inventory-utils.md](./inventory-utils.md) | All `src/utils/*.ts` (47 files) |
| [inventory-components.md](./inventory-components.md) | All `src/components/**/*.tsx` |

## Maintenance

- When **adding or removing** a source file, update the relevant inventory file in the same PR.
- Prefer **one short sentence** for “Role”; avoid duplicating implementation detail that belongs in code comments.
- Run `find src -name '*.ts' -o -name '*.tsx' | sort` and reconcile against [inventory-utils.md](./inventory-utils.md) + [inventory-components.md](./inventory-components.md) + [inventory-data-hooks.md](./inventory-data-hooks.md) if unsure.
