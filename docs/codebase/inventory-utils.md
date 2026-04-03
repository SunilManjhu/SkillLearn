# Inventory: `src/utils` (all `.ts` files)

Alphabetical. Each module is **pure logic, Firestore I/O, or cross-cutting helpers** unless noted.

## `src/utils/adminModerationFirestore.ts`

- **Role:** Admin reads/writes for **reports**, **URL suggestions**, **contact messages** (list, subscribe, delete).
- **Primary exports:** `AdminReportRow`, `AdminSuggestionRow`, `AdminContactMessageRow`, `list*ForAdmin`, `subscribe*ForAdmin`, `delete*AsAdmin`.
- **Used by:** `AdminModerationSection`.

## `src/utils/adminUsersFirestore.ts`

- **Role:** Admin **user directory**: subscribe/list users, promote/demote roles in Firestore.
- **Primary exports:** `AdminUserRow`, `subscribeUsersForAdmin`, `listUsersForAdmin`, `updateUserRoleAsAdmin`, `upsertUserRoleAsAdmin`.
- **Used by:** `AdminUserRolesSection`.

## `src/utils/alertsFirestore.ts`

- **Role:** **Broadcast alerts** to enrolled learners, **report resolved** notices, fetch active alerts by course enrollment, per-user read/dismiss state.
- **Primary exports:** `BroadcastAlertType`, `createBroadcastAlert`, `createReportResolvedNotice`, `fetchActiveAlertsForCourses`, `reportNoticesFromQuerySnapshot`, `loadUserAlertState`, `markAlertRead`, `markAlertDismissed`.
- **Used by:** `App.tsx` (navbar merge), `AdminPage` (send alerts).

## `src/utils/appHistory.ts`

- **Role:** Serialize/deserialize **SPA location** to hash + `history.state` (`APP_HISTORY_KEY`); equality and course-aware resolution. **`mergeHashAndHistoryStatePayload`** combines hash + stack state (e.g. preserves **`learningPathId`** and **`certificate`** when the hash is only `#/certificate`).
- **Primary exports:** `APP_HISTORY_KEY`, `AppHistoryPayload`, `AppHistoryView`, `AdminHistoryTab`, `payloadToHash`, `parseHashToPayload`, `buildHistoryUrl`, `readPayloadFromHistoryState`, `mergeHashAndHistoryStatePayload`, `historyPayloadsEqual`, `resolvePayloadForCourses`, `shouldPushCourseOverviewBeforePlayer`, `historyBackOrFallback`.
- **Used by:** `App.tsx`.

## `src/utils/authErrors.ts`

- **Role:** User-facing strings for Firebase Auth failures.
- **Primary exports:** `formatAuthError`.
- **Used by:** Sign-in gates, profile.

## `src/utils/authProfileCache.ts`

- **Role:** **localStorage** cache of display name/photo/uid for instant navbar paint before `onAuthStateChanged` finishes. Key **`skillstream.auth.profile.v1`** — the same key is read by [`index.html`](../../index.html) for **theme** first paint (see `uiThemePreference`).
- **Primary exports:** `AuthProfileSnapshot`, `readCachedAuthProfile`, `writeCachedAuthProfile`, `clearCachedAuthProfile`.
- **Used by:** `App.tsx`, `uiThemePreference.ts`, resume/deep-link helpers.

## `src/utils/authReturnContext.ts`

- **Role:** **sessionStorage** stash of intended route/course before **redirect-based** Google sign-in; consumed on return.
- **Primary exports:** `AuthReturnPayload`, `stashAuthReturnState`, `consumeAuthReturnState`.
- **Used by:** `App.tsx` (`applyAuthReturnPayload`), login flows.

## `src/utils/catalogCategoryExtras.ts`

- **Role:** **Custom catalog category** labels beyond presets; localStorage + `CustomEvent` for live updates.
- **Primary exports:** `CATALOG_CATEGORY_EXTRAS_CHANGED`, `readCatalogCategoryExtras`, `add/remove/replaceCatalogCategoryExtra`.
- **Used by:** Admin catalog category panels, `App.tsx`, filters.

## `src/utils/catalogCategoryPresets.ts`

- **Role:** **Default and normalized** main/more category pill presets; cache helpers for admin + catalog UI.
- **Primary exports:** `CatalogCategoryPresetsState`, `DEFAULT_CATALOG_CATEGORY_PRESETS`, `normalizeCatalogCategoryPresets`, `get/setCachedCatalogCategoryPresets`, `catalogCategoriesRowFromState`, `allPresetCatalogCategoriesFromState`, `CATALOG_CATEGORY_PRESETS_CHANGED`.
- **Used by:** `App.tsx`, admin presets panel, filters.

## `src/utils/catalogCategoryPresetsFirestore.ts`

- **Role:** Load/save **site-wide** catalog category presets document in Firestore.
- **Primary exports:** `CATALOG_CATEGORY_PRESETS_DOC_ID`, `loadCatalogCategoryPresets`, `saveCatalogCategoryPresets`.
- **Used by:** `App.tsx`, admin.

## `src/utils/catalogSkillExtras.ts`

- **Role:** Custom **skill** tags in localStorage (mirror of category extras pattern).
- **Primary exports:** `CATALOG_SKILL_EXTRAS_CHANGED`, read/add/remove/replace helpers.
- **Used by:** Catalog filter, admin.

## `src/utils/catalogSkillPresets.ts`

- **Role:** Built-in **skill** pill list for library filters.
- **Primary exports:** `CATALOG_SKILL_PRESETS`, `allPresetCatalogSkills`.
- **Used by:** `App.tsx`, `CourseLibraryCategoryFilter`.

## `src/utils/certificateFirestore.ts`

- **Role:** Deterministic **certificate id**, persist certificate metadata to Firestore, hydrate **completion timestamps** from stored certs.
- **Primary exports:** `buildCertificateId`, `persistCertificateToFirestore`, `hydrateCompletionTimestampsFromCertificates`.
- **Used by:** `App.tsx` completion flow, profile.

## `src/utils/courseCompletionLog.ts`

- **Role:** **localStorage** completion timestamps per user; merge remote certificate-derived times.
- **Primary exports:** `recordCourseCompletion`, `loadCompletionTimestamps`, `mergeCompletionTimestampFromRemote`, `clearCourseCompletionTimestamp`.
- **Used by:** Player completion, profile stats, certificates.

## `src/utils/courseDraftValidation.ts`

- **Role:** Validate **admin course draft** structure (including quiz lessons) before publish.
- **Primary exports:** `validateLessonQuiz`, `validateCourseDraft`.
- **Used by:** `AdminCourseCatalogSection`.

## `src/utils/courseLessons.ts`

- **Role:** Flatten curriculum, **next lesson** navigation, stable lesson key string.
- **Primary exports:** `flattenLessons`, `getLastLessonInCourse`, `getNextLesson`, `courseLessonIdsKey`.
- **Used by:** Player, overview, progress.

## `src/utils/courseProgress.ts`

- **Role:** **Lesson progress** in localStorage + **Firestore sync**; resume/start lesson; course completion detection; hydrate all courses for a user.
- **Primary exports:** `LessonProgress`, `loadLessonProgressMap`, `reconcileLessonProgressMap`, completion helpers, `getResumeOrStartLesson`, `syncProgressToFirestore`, `hydrateAllUserProgressFromFirestore`, `ensureSyntheticProgressForRecordedCompletions`, etc.
- **Used by:** `App.tsx`, `CoursePlayer`, `CourseOverview`, profile.

## `src/utils/courseRating.ts`

- **Role:** Post-course **star rating** localStorage + Firestore sync; dismiss/remind flows.
- **Primary exports:** `CourseRating`, `loadCourseRating`, `syncCourseRatingToFirestore`, `hydrateAllCourseRatingsFromFirestore`, `saveCourseRating`, `hasRatedOrDismissed`, etc.
- **Used by:** `CoursePlayer`, profile.

## `src/utils/courseStructuredIds.ts`

- **Role:** **Structured course ids** (`C1`, `C2`, …) validation and **remap** module/lesson ids by order for admin operations.
- **Primary exports:** `STRUCTURED_COURSE_ID_RE`, `isStructuredCourseId`, `remapStructuredCourseModuleLessonIdsByOrder`.
- **Used by:** Admin catalog, publish layer.

## `src/utils/creatorCatalogSession.ts`

- **Role:** **Session + in-memory cache** for signed-in **creator/admin browse preview**: last **draft courses and draft paths** per `ownerUid`, and last **merged** `LearningPath[]` for the navbar keyed by Firebase `uid` (signed-out → `null`). Prevents draft rows and paths from appearing only after a second Firestore round while published data hydrates from `peekResolvedCatalogCourses`. See [`../access-control-roadmap.md`](../access-control-roadmap.md) §8 — do not regress the two-phase paint + write pattern.
- **Primary exports:** `peekResolvedCreatorCatalog`, `writeResolvedCreatorCatalog`, `peekMergedCatalogLearningPaths`, `writeMergedCatalogLearningPaths`, `CreatorCatalogBundle`.
- **Used by:** `App.tsx` (catalog `useEffect`, initial state, `fetchCatalogSnapshot`).

## `src/utils/courseTaxonomy.ts`

- **Role:** Library **filters**: levels, category/skill tags, `courseMatchesLibraryFilters`, toggle helpers, normalization on courses.
- **Primary exports:** `LibraryFilterState`, `COURSE_LEVELS`, `normalizeCourseTaxonomy`, `courseMatchesLibraryFilters`, `toggleFilterTag`, etc.
- **Used by:** `App.tsx` catalog grid.

## `src/utils/enrollmentsFirestore.ts`

- **Role:** Record and list **user ↔ course** enrollments in Firestore.
- **Primary exports:** `enrollmentDocId`, `enrollUserInCourse`, `fetchEnrolledCourseIds`.
- **Used by:** `App.tsx`, alerts targeting.

## `src/utils/externalUrl.ts`

- **Role:** Normalize user-entered **external links** (http/https) for mind map / lessons.
- **Primary exports:** `normalizeExternalHref`.
- **Used by:** Path builder, validation.

## `src/utils/formatGenaiError.ts`

- **Role:** Classify **retryable** Gemini quota errors; format errors for UI/logging.
- **Primary exports:** `isRetryableQuotaError`, `formatGenaiError`.
- **Used by:** `geminiClient`, `DemoLearningAgent`, quiz AI flows.

## `src/utils/geminiClient.ts`

- **Role:** **`generateContentWithModelChain`**: tries Firestore-resolved model list (fallback to env) until success or fatal error.
- **Primary exports:** `generateContentWithModelChain`, re-exports from `geminiModelEnv`.
- **Used by:** Learning assistant, Gemini quiz helpers.

## `src/utils/geminiModelEnv.ts`

- **Role:** Read **Gemini model chain** and API key from **build-time** `process.env` (`vite.config` `define`).
- **Primary exports:** `getGeminiApiKey`, `getGeminiModelPrimary`, `getGeminiModelChain`.
- **Used by:** Client code that needs env defaults (before Firestore override).

## `src/utils/geminiModelSettingsFirestore.ts`

- **Role:** Admin **Gemini model list** in Firestore (`siteSettings/geminiAiModels`): load/save, normalization, **`getResolvedGeminiModelChain`** for runtime.
- **Primary exports:** `GEMINI_AI_MODELS_DOC_ID`, `getResolvedGeminiModelChain`, `loadGeminiAiModelsForAdmin`, `saveGeminiAiModels`, validators, cache invalidation event.
- **Used by:** `geminiClient`, `AdminGeminiModelsSection`.

## `src/utils/geminiQuiz.ts`

- **Role:** Gemini calls for **quiz grading** (freeform, MCQ probes, weak-answer hints, reveal answer).
- **Primary exports:** `gradeFreeformAnswer`, `probeIncorrectMcq`, `probeWeakFreeform`, `resolveMcqCorrectIndex`, `revealFreeformModelAnswer`.
- **Used by:** `CourseQuizPanel`.

## `src/utils/learnerAiModelsSettingsFirestore.ts`

- **Role:** Site flag document for **learner AI models** section enable/disable.
- **Primary exports:** `LEARNER_AI_MODELS_DOC_ID`, `load/save/subscribeLearnerAiModelsSiteEnabled`, `parseLearnerAiModelsSiteEnabled`.
- **Used by:** `useLearnerAiModelsSiteEnabled`, admin AI controls.

## `src/utils/learnerAssistantPreference.ts`

- **Role:** **localStorage** preference for assistant visibility + broadcast event.
- **Primary exports:** `LEARNER_ASSISTANT_PREFERENCE_CHANGED`, `read/writeLearnerAssistantVisible`.
- **Used by:** Profile, hooks.

## `src/utils/learnerGeminiPreference.ts`

- **Role:** **localStorage** preference for learner Gemini features.
- **Primary exports:** `LEARNER_GEMINI_PREFERENCE_CHANGED`, `read/writeLearnerGeminiEnabled`.
- **Used by:** Profile, hooks.

## `src/utils/learningAssistantSettingsFirestore.ts`

- **Role:** Site document for **learning assistant** master switch.
- **Primary exports:** `LEARNING_ASSISTANT_DOC_ID`, `load/save/subscribeLearningAssistantSiteEnabled`.
- **Used by:** Admin AI site controls, hooks.

## `src/utils/learningPathsFirestore.ts`

- **Role:** CRUD **learning path** documents (title, courseIds, metadata) in Firestore.
- **Primary exports:** `pathToFirestorePayload`, `loadLearningPathsFromFirestore`, `saveLearningPath`, `deleteLearningPath`.
- **Used by:** `App.tsx`, `PathBuilderSection`, admin.

## `src/utils/learningPathStructuredIds.ts`

- **Role:** **Structured path ids** (`P1`, `P2`, …) validation and next-id allocation helper.
- **Primary exports:** `STRUCTURED_LEARNING_PATH_ID_RE`, `isStructuredLearningPathId`, `firstAvailableStructuredLearningPathId`.
- **Used by:** Path admin.

## `src/utils/learningStats.ts`

- **Role:** Derive **profile stats** (courses completed, hours, streaks) from progress + completion maps.
- **Primary exports:** `computeLearningStats`, `computeCourseEnrollmentCounts`.
- **Used by:** `ProfilePage`, marketing copy if any.

## `src/utils/lessonContent.ts`

- **Role:** Type guards and accessors for **lesson content kind** (video / web / quiz).
- **Primary exports:** `lessonWebHref`, `isWebLesson`, `isQuizLesson`, `lessonQuizDefinition`, `lessonBlocksVideoPlayback`, `isVideoLesson`.
- **Used by:** Player, overview, admin validation.

## `src/utils/parseAssistantReply.ts`

- **Role:** Parse **JSON-shaped** replies from the learning assistant for structured UI actions.
- **Primary exports:** `AssistantReply`, `parseAssistantReplyJson`.
- **Used by:** `DemoLearningAgent`.

## `src/utils/pathMindmapFirestore.ts`

- **Role:** Load/save/delete **mind map document** nested on a learning path in Firestore.
- **Primary exports:** `PATH_MINDMAP_FIELD`, `fetchPathMindmapFromFirestore`, `savePathMindmapToFirestore`, `deletePathMindmapFromFirestore`.
- **Used by:** Path builder, learner mind map panel.

## `src/utils/pathOutlineRowStatus.ts`

- **Role:** Per-row **completion status** for path outline UI from course + lesson progress.
- **Primary exports:** `PathOutlineRowStatus`, `getPathOutlineRowStatus`.
- **Used by:** `LearnerPathMindmapPanel`, `PathMindmapOutline`.

## `src/utils/pathSectionProgress.ts`

- **Role:** Aggregate **progress** for a subtree of the mind map (course counts, external links).
- **Primary exports:** `collectCourseIdsInSubtree`, `countCatalogCoursesInSubtree`, `countExternalLinksInSubtree`, `computePathSectionProgress`.
- **Used by:** Learner path UI.

## `src/utils/publishedCoursesFirestore.ts`

- **Role:** **Published catalog**: peek `sessionStorage` cache, resolve Firestore `publishedCourses` (no bundled fallback), save/delete course, Firestore payload shape. Pairs with **`creatorCatalogSession.ts`** for creator preview hydration — see [`../access-control-roadmap.md`](../access-control-roadmap.md) §8.
- **Primary exports:** `peekResolvedCatalogCourses`, `resolveCatalogCourses`, `loadPublishedCoursesFromFirestore`, `savePublishedCourse`, `deletePublishedCourse`, `courseToFirestorePayload`.
- **Used by:** `App.tsx`, admin catalog.

## `src/utils/quizAttemptsFirestore.ts`

- **Role:** Persist **quiz attempt** records per user/question for analytics/history.
- **Primary exports:** `QuizAttemptPerQuestion`, `saveQuizAttempt`.
- **Used by:** `CourseQuizPanel`.

## `src/utils/quizCoercion.ts`

- **Role:** Safe coercion of **quiz answer** payloads (indices, scores) from loose JSON.
- **Primary exports:** `coerceQuizIndex`, `mcqIndicesMatch`, `coerceScore0to100`.
- **Used by:** Quiz panel, Firestore writes.

## `src/utils/reorderScrollViewport.ts`

- **Role:** **Viewport-stable** arrow reorder: `window.scrollBy` math + focus after DOM swap; shared selectors for admin reorder buttons.
- **Primary exports:** `scrollWindowToKeepReorderControlViewportY`, `applyReorderViewportScrollAndFocus`, `REORDER_DATA_ATTR_SELECTORS`, `escapeSelectorAttrValue`, `queryElementInScopeOrDocument`.
- **See:** [../admin-reorder-scroll-viewport.md](../admin-reorder-scroll-viewport.md).

## `src/utils/scrollDocumentToTop.ts`

- **Role:** Scroll `document.documentElement` / `body` to top after navigations.
- **Primary exports:** `scrollDocumentToTop`.
- **Used by:** `App.tsx`, many navigations.

## `src/utils/uiThemePreference.ts`

- **Role:** Persist **light/dark** choice per signed-in user in **localStorage** (`skilllearn:uiTheme:{uid}`); synchronous **session read** via cached auth profile for first paint.
- **Primary exports:** `readPersistedUiThemeForUser`, `writePersistedUiThemeForUser`, `readInitialUiThemeForSession`.
- **Used by:** `App.tsx`.

## `src/utils/userProfileFirestore.ts`

- **Role:** Ensure **`users/{uid}`** profile exists; **subscribe** role (`user` | `admin`); count admins; delete profile doc.
- **Primary exports:** `UserRole`, `ensureUserProfile`, `subscribeUserRole`, `fetchUserRole`, `countFirestoreAdminUsers`, `deleteUserProfileDocument`, `parseUserRoleFromUserDoc`.
- **Used by:** `App.tsx`, account deletion, admin roles.

## `src/utils/youtube.ts`

- **Role:** YouTube **iframe API** loader, URL → video id / embed URL, **caption** prefs in localStorage, embed src builder, optional top crop constant.
- **Primary exports:** `loadYoutubeIframeApi`, `youtubeVideoIdFromUrl`, `youtubeUrlToEmbedUrl`, caption read/write helpers, `youtubeEmbedSrcForVideoId`, `YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS`, etc.
- **Used by:** `CoursePlayer`.

## `src/utils/youtubeDataApi.ts`

- **Role:** Optional **YouTube Data API v3** batch duration fetch; ISO 8601 duration parse; clock formatting for UI.
- **Primary exports:** `parseYoutubeIso8601Duration`, `formatSecondsAsLessonClock`, `getYoutubeDataApiKey`, `listYoutubeLessonsInCourse`, `fetchYoutubeVideoDurationsSeconds`, `lessonDurationLabel`.
- **Used by:** `useYoutubeResolvedSeconds`, catalog.

</think>


<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace