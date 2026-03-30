# Inventory: `src/data` and `src/hooks`

## `src/data/courses.ts`

- **Role:** Canonical **TypeScript types** for courses, modules, lessons, quiz shapes; quiz factory helpers; **`STATIC_CATALOG_FALLBACK`** bundled catalog when Firestore is empty or unavailable.
- **Primary exports:** `Course`, `Lesson`, `Module`, `QuizDefinition`, quiz question types, limits (`MAX_QUIZ_*`), `newQuizQuestionId`, `createDefaultMcqQuestion`, `createDefaultFreeformQuestion`, `STATIC_CATALOG_FALLBACK`, `COURSES`.
- **Used by:** Almost all learner and admin UI, Firestore publish layer.

## `src/data/learningPaths.ts`

- **Role:** **`LearningPath`** interface (id, title, courseIds, etc.) shared between UI and Firestore.
- **Primary exports:** `LearningPath` (and related shape).
- **Used by:** `App`, path mind map, `learningPathsFirestore.ts`.

## `src/data/pathMindmap.ts`

- **Role:** Types and parsers for **Learning Path outline** tree (`MindmapTreeNode`, `MindmapDocument`): `label` | `course` | `lesson` | `link` | `divider`, center node label, ID generation, normalization.
- **Primary exports:** `MindmapTreeNode`, `MindmapDocument`, `PATH_MINDMAP_CENTER_LABEL`, `newMindmapNodeId`, `normalizeMindmapNode`, `parseMindmapDocument`, `mindmapDocumentWithCenterChildren`, etc.
- **Used by:** Path builder UI, `pathMindmapFirestore.ts`, path progress helpers.

---

## `src/hooks/useBodyScrollLock.ts`

- **Role:** Locks document scroll when overlays/modals are open (mobile-friendly).
- **Primary exports:** `useBodyScrollLock(active)`.
- **Used by:** `AdminPage`, dialogs.

## `src/hooks/useDialogKeyboard.ts`

- **Role:** Escape to close, focus trap patterns for modal dialogs.
- **Primary exports:** `useDialogKeyboard(options)`.
- **Used by:** Admin and app modals.

## `src/hooks/useLearnerAiModelsSiteEnabled.ts`

- **Role:** Subscribes to Firestore site flag for **learner-facing AI models** UI toggle.
- **Primary exports:** `useLearnerAiModelsSiteEnabled`.
- **Used by:** Profile or settings surfaces that gate model picker.

## `src/hooks/useLearnerAssistantVisible.ts`

- **Role:** Combines site Firestore flag + local preference for learning assistant visibility.
- **Primary exports:** `useLearnerAssistantVisible`.
- **Used by:** Learner UI around assistant entry points.

## `src/hooks/useLearnerGeminiEnabled.ts`

- **Role:** Combines site settings + local preference for **Gemini** learner features.
- **Primary exports:** `useLearnerGeminiEnabled`.
- **Used by:** Course player / profile toggles.

## `src/hooks/useLearningAssistantFabVisible.ts`

- **Role:** Whether the floating learning assistant FAB should show (site + prefs).
- **Primary exports:** `useLearningAssistantFabVisible`.
- **Used by:** `App.tsx` (`DemoLearningAgent` mount).

## `src/hooks/useLearningAssistantSiteEnabled.ts`

- **Role:** Subscribes to Firestore **`learningAssistant`** site enable document.
- **Primary exports:** `useLearningAssistantSiteEnabled`.
- **Used by:** Hooks and components gating assistant.

## `src/hooks/useYoutubeResolvedSeconds.ts`

- **Role:** Resolves YouTube lesson durations (Data API when `VITE_YOUTUBE_DATA_API_KEY` set; else heuristics).
- **Primary exports:** `useYoutubeResolvedSeconds(course)`.
- **Used by:** Catalog / course cards where duration labels matter.
