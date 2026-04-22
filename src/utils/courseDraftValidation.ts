import {
  type Course,
  type Lesson,
  MAX_QUIZ_CHOICES,
  MAX_QUIZ_HINT_CONTEXT_LEN,
  MAX_QUIZ_PROMPT_LEN,
  MAX_QUIZ_QUESTIONS,
  MAX_QUIZ_RUBRIC_LEN,
} from '../data/courses';
import { isCourseLevel } from './courseTaxonomy';
import { lessonWebHref } from './lessonContent';
import { coerceQuizIndex } from './quizCoercion';
import { catalogMiniRichIsEffectivelyEmpty, catalogMiniRichPlainText } from './catalogMiniRichHtml';

/** Case-insensitive plain text — for duplicate title checks within one course (titles may store mini-HTML). */
function normCourseDisplayTitle(s: string): string {
  return catalogMiniRichPlainText(s).toLowerCase();
}

/** Per-lesson quiz checks; used by admin draft validation. */
export function validateLessonQuiz(l: Lesson, mi: number, li: number): string | null {
  const prefix = `Module ${mi + 1}, Lesson ${li + 1}`;
  if (l.contentKind !== 'quiz') return null;
  const qs = l.quiz?.questions;
  if (!qs?.length) return `${prefix}: Add at least one quiz question.`;
  if (qs.length > MAX_QUIZ_QUESTIONS) {
    return `${prefix}: Quiz cannot have more than ${MAX_QUIZ_QUESTIONS} questions.`;
  }
  for (let qi = 0; qi < qs.length; qi += 1) {
    const q = qs[qi];
    const qp = `${prefix}, Question ${qi + 1}`;
    if (!q.id.trim()) return `${qp}: Question ID is required.`;
    if (!q.prompt.trim()) return `${qp}: Prompt is required.`;
    if (q.prompt.length > MAX_QUIZ_PROMPT_LEN) return `${qp}: Prompt is too long.`;
    if (q.type === 'mcq') {
      if (q.choices.length < 2) return `${qp}: At least two choices are required.`;
      if (q.choices.length > MAX_QUIZ_CHOICES) return `${qp}: Too many choices.`;
      for (let ci = 0; ci < q.choices.length; ci += 1) {
        if (!q.choices[ci]?.trim()) return `${qp}: Choice ${ci + 1} cannot be empty.`;
      }
      const cIdx = coerceQuizIndex(q.correctIndex);
      if (cIdx === null || cIdx < 0 || cIdx >= q.choices.length) {
        return `${qp}: Select a valid correct answer.`;
      }
    } else if (q.type === 'freeform') {
      const rub = q.rubric?.trim() ?? '';
      if (rub.length > MAX_QUIZ_RUBRIC_LEN) return `${qp}: Rubric is too long.`;
      const hc = q.hintContext?.trim() ?? '';
      if (hc.length > MAX_QUIZ_HINT_CONTEXT_LEN) return `${qp}: Hint context is too long.`;
    } else {
      return `${qp}: Invalid question type.`;
    }
  }
  return null;
}

/** Same rules as admin catalog `validateDraft`. */
export function validateCourseDraft(c: Course): string | null {
  if (!c.title.trim()) return 'Title is required.';
  if (!c.author.trim()) return 'Author is required.';
  if (!c.thumbnail.trim()) return 'Thumbnail URL is required.';
  if (!c.categories?.length || !c.categories.some((x) => x.trim())) {
    return 'At least one category is required.';
  }
  if (!c.skills?.length || !c.skills.some((x) => x.trim())) {
    return 'At least one skill is required.';
  }
  if (!isCourseLevel(c.level)) return 'Level must be Beginner, Intermediate, Advanced, or Proficient.';
  if (!c.modules.length) return 'At least one module is required.';
  for (let mi = 0; mi < c.modules.length; mi += 1) {
    const m = c.modules[mi];
    if (!m.id.trim()) return `Module ${mi + 1}: Module ID is required.`;
    if (catalogMiniRichIsEffectivelyEmpty(m.title)) return `Module ${mi + 1}: Module title is required.`;
    if (!m.lessons.length) return 'Each module needs at least one lesson.';
    const playableInModule = m.lessons.filter((les) => les.contentKind !== 'divider').length;
    if (playableInModule === 0) {
      return `Module ${mi + 1}: Add at least one playable lesson (video, external page, or quiz), not only section dividers.`;
    }
    for (let li = 0; li < m.lessons.length; li += 1) {
      const l = m.lessons[li];
      if (!l.id.trim()) return `Module ${mi + 1}, Lesson ${li + 1}: Lesson ID is required.`;
      if (catalogMiniRichIsEffectivelyEmpty(l.title)) return `Module ${mi + 1}, Lesson ${li + 1}: Lesson title is required.`;
      const lessonTitleKey = normCourseDisplayTitle(l.title);
      for (let li2 = 0; li2 < li; li2 += 1) {
        const other = m.lessons[li2];
        if (catalogMiniRichPlainText(other.title) && normCourseDisplayTitle(other.title) === lessonTitleKey) {
          return `Module ${mi + 1}, Lesson ${li + 1}: Lesson title must be unique in this module (same as lesson ${li2 + 1}).`;
        }
      }
      if (l.contentKind === 'web') {
        if (!lessonWebHref(l)) {
          return `Module ${mi + 1}, Lesson ${li + 1}: Page URL is required (https:// or a valid domain).`;
        }
      } else if (l.contentKind === 'quiz') {
        const qe = validateLessonQuiz(l, mi, li);
        if (qe) return qe;
      } else if (l.contentKind === 'divider') {
        /* heading only */
      } else if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) {
        return `Module ${mi + 1}, Lesson ${li + 1}: Video URL is required and must start with http.`;
      }
    }
  }
  if (c.rating < 0 || c.rating > 5) return 'Rating must be 0–5.';
  return null;
}
