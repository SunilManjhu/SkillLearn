# Learning path course list (flat dark UI)

This document is the **canonical spec** for the i-Golden learning-path course row layout. Use it as a **reference in prompts** for designers, LLMs, or future you—paste a short pointer like:

> Follow `docs/learning-path-course-list.md` for layout, tokens, and behavior.

---

## 1. Purpose

- **What:** A **vertical list of course rows** for a learning path (not a thumbnail card grid).
- **Where:** Primary learner view when a path defines ordered `courseIds` (e.g. `#/catalog/path/P1`).
- **Why:** One scannable list with progress and status at a glance; the **whole row** opens the course.

**Implementation in this repo (for engineers):**

- `src/components/LearnerPathCourseRowList.tsx` — row list + row component
- `src/components/LearnerPathCourseRowList.css` — scoped tokens and layout
- `src/components/LearnerPathMindmapPanel.tsx` — chooses row list vs. mindmap outline
- `src/utils/pathOutlineRowStatus.ts` — `getLearningPathCourseRowStatus()` shared with outline logic

---

## 2. Visual system

| Token        | Value       | Usage                                      |
|-------------|-------------|--------------------------------------------|
| Page bg     | `#111111`   | Outer / page background                    |
| Row surface | `#1e1e1e`   | Course row background                      |
| Border      | `#2a2a2a`   | Row border, progress track                 |
| Accent      | `#E85D24`   | In progress: icon, status text, bar fill   |
| Text        | `#dddddd`   | Primary titles (active / in progress)      |
| Muted       | `#888888`   | Metadata line                              |
| Dim         | `#555555`   | Not started status                         |
| Success     | `#4caf50`   | Completed: icon, status, bar fill          |
| Hover row   | `#252525`   | Row hover background                       |

**Rules**

- **Flat only:** no gradients, no box shadows on rows.
- **Typography:** `system-ui` or clean sans-serif.
- **Theming:** prefer **CSS custom properties** (see `.lpcr` in `LearnerPathCourseRowList.css`).

---

## 3. Single row layout (left → right)

### 3.1 Status icon (~40px circle)

- **Not started:** clock icon, muted, dark grey fill, grey border.
- **In progress:** clock icon **orange**, circle with orange border and light orange tint.
- **Completed:** checkmark **green**, green-tinted circle.

Icon is decorative for the row (whole row remains the control).

### 3.2 Course info (flexible, `min-width: 0`)

- **Title:** one line, **bold** (~15px). Brighter when started or completed; **more muted** when not started.
- **Metadata:** **exactly one line**, smaller (~13px), parts separated by **middle dots (·)**:

  `{N} lessons · {duration} · {difficulty} · {status label}`

  - Duration is a human string (e.g. `3h 20m`, `1h 45m`).
  - Difficulty: e.g. Beginner / Intermediate / Advanced / Proficient.

- **Status label** (same line):
  - **In progress** — `#E85D24`, semibold.
  - **Completed** — `#4caf50`, semibold.
  - **Not started** — `#555555`.

### 3.3 Progress (right column)

- **Bar:** ~**72px** wide, **3px** tall; track `#2a2a2a`; fill **accent** or **success** when completed.
- **Percent** immediately to the **right** of the bar, tabular numerals, muted.
- **Animation:** width **0 → value** on mount / update (~**600ms ease-out**).
- **Responsive:** below **~600px** viewport width, **hide the percent**; keep the bar.

---

## 4. Interaction

- **Hit target:** the **entire row** opens the course (e.g. `<button type="button">` or equivalent).
- **Keyboard:** visible **focus** ring (e.g. orange outline, offset).
- **No** separate “Continue” / “Open course” text button in the row; row affordance replaces it.

---

## 5. Data shape (conceptual)

Per course, in **path order**:

| Field             | Notes                                                |
|------------------|------------------------------------------------------|
| `id`             | Stable course id                                     |
| `title`          | Display title                                        |
| `status`         | `not_started` \| `in_progress` \| `completed`      |
| `progressPercent`| 0–100 for bar (align with lesson-completion rules)   |
| `lessonCount`    | Total lessons (and optionally completed count)     |
| `duration`       | Display string from catalog (e.g. course duration)   |
| `difficulty`     | Level label (e.g. `course.level`)                    |

In i-Golden, **status** and **percent** are derived from stored lesson progress and shared rules with the path outline (`getLearningPathCourseRowStatus`, `getCourseLessonProgressSummary`).

---

## 6. Empty and edge states

- **Path lists course IDs not present in published catalog:** show a short explanatory message (unpublished / missing).
- **Path has no resolvable courses:** empty or message; do not silently fall back to an unrelated layout without copy.

---

## 7. Optional page chrome (separate from rows)

May sit **above** the list (sticky or static):

- Eyebrow: **LEARNING PATH**
- **Path title**
- Short tagline, e.g. *Everything you need, in the right order. Go at your own pace.*
- Optional overall path progress
- Control to **leave the path** (e.g. “Browse all courses”)

Keep list component **focused on rows**; chrome can live in the parent layout (`App` path hero + `LearnerPathMindmapPanel`).

---

## 8. Explicit exclusions

- Primary path UI is **not** a multi-column **thumbnail card grid**.
- Rows are **not** a substitute for a full **accordion / mindmap** where product requires nested outline; those can coexist as separate modes (this repo: mindmap when `pathCourseIds` is empty).
- No **gradients** or **box shadows** on rows for this spec.

---

## 9. Reusable prompt block (copy for LLMs)

Use the following as a **verbatim appendix** in your prompt, or say: *“Implement per `docs/learning-path-course-list.md`.”*

---

**Prompt: Learning path course list (flat dark UI)**

Build a learning path view: a **vertical list of course rows** in path order. Each row opens the course; no thumbnail grid as primary.

**Visual:** Dark flat UI. Background `#111111`, row surface `#1e1e1e`, borders `#2a2a2a`, accent `#E85D24`, text `#dddddd` / `#888888` / `#555555`, success `#4caf50`, row hover `#252525`. No gradients or shadows on rows. System UI font. Use CSS variables for colors.

**Row layout:** (1) Left: **40px** circle — **clock** muted if not started; **clock** orange ring/tint if in progress; **check** green if completed. (2) Center: **bold title**; one metadata line: `N lessons · duration · difficulty · status` with middle dots — “In progress” orange, “Completed” green, “Not started” dim. (3) Right: **72×3px** progress bar + **%** to the right; animate fill 0→value in **600ms ease-out**; hide **%** under **600px** width.

**Interaction:** Whole row is clickable; keyboard focus ring visible.

**Data:** Per course: id, title, status, progress %, lesson count, duration string, difficulty.

**Empty:** Message if listed ids are missing from catalog.

**Exclude:** Card grid as main path UI; row shadows/gradients.

---

## 10. One-line cheat sheet

Dark flat list: full-width rows, left status clock/check circle, title + one line `lessons · duration · level · colored status`, thin progress bar + percent right; row opens course; colors `#111` / `#1e1e1e` / `#E85D24` / `#4caf50`.
