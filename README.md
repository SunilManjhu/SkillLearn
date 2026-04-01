<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e7845049-4821-43c7-b79a-23149c24984f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Documentation (contributors / AI)

- **[docs/README.md](docs/README.md)** — index of internal guides.
- **[docs/codebase/README.md](docs/codebase/README.md)** — per-file reference for all `src` modules (utils, components, hooks, data) and key config.
- **[docs/development-and-debugging.md](docs/development-and-debugging.md)** — stack, env vars, project layout, URL/history behavior, Firebase & Gemini debugging, mobile notes, checklists.
- **[docs/app-shell-app-tsx.md](docs/app-shell-app-tsx.md)** — what [`src/App.tsx`](src/App.tsx) owns: views, history sync, catalog hydration, enrollment, admin/profile/player flows.
- **[docs/admin-reorder-scroll-viewport.md](docs/admin-reorder-scroll-viewport.md)** — admin arrow reorder, scroll-under-cursor behavior, and [`src/utils/reorderScrollViewport.ts`](src/utils/reorderScrollViewport.ts).
