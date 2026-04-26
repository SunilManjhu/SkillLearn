import type { PathOutlineAudienceRole } from './pathMindmap';

/**
 * `video` (default): embedded player from `videoUrl`. `web`: open `webUrl` in a new tab. `quiz`: in-player quiz.
 * `divider`: syllabus-only heading in the module list; not playable (uses `title` as the label).
 */
export type LessonContentKind = 'video' | 'web' | 'quiz' | 'divider';

export const MAX_QUIZ_QUESTIONS = 20;
export const MAX_QUIZ_CHOICES = 10;
export const MAX_QUIZ_PROMPT_LEN = 4000;
export const MAX_QUIZ_RUBRIC_LEN = 8000;
export const MAX_QUIZ_HINT_CONTEXT_LEN = 4000;

export type QuizQuestionType = 'mcq' | 'freeform';

export interface QuizQuestionMcq {
  id: string;
  type: 'mcq';
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export interface QuizQuestionFreeform {
  id: string;
  type: 'freeform';
  prompt: string;
  /** Instructor-only grading guidance for the model (not shown in the hint tutor). */
  rubric?: string;
  /** Optional context the hint tutor may use (not used for grading). */
  hintContext?: string;
}

export type QuizQuestion = QuizQuestionMcq | QuizQuestionFreeform;

export interface QuizDefinition {
  questions: QuizQuestion[];
}

export function newQuizQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultMcqQuestion(): QuizQuestionMcq {
  return {
    id: newQuizQuestionId(),
    type: 'mcq',
    prompt: '',
    choices: ['', ''],
    correctIndex: 0,
  };
}

export function createDefaultFreeformQuestion(): QuizQuestionFreeform {
  return {
    id: newQuizQuestionId(),
    type: 'freeform',
    prompt: '',
    rubric: '',
    hintContext: '',
  };
}

export interface Lesson {
  id: string;
  title: string;
  /** Omit for YouTube lessons when using Data API / player-resolved length. */
  duration?: string;
  /** Used when `contentKind` is `video` or omitted (default). Empty when `contentKind === 'quiz'`. */
  videoUrl: string;
  /** Shown under the player; updates per lesson. Omit for a short auto-generated blurb. */
  about?: string;
  /**
   * Optional multi-line outline for video lessons. Authors use `(M:SS)` or `(M:SS - M:SS)` per line;
   * learners see text without timestamps and can tap a line to seek the player.
   */
  videoOutlineNotes?: string;
  /** Omit or `video` = default embedded lesson. `web` requires `webUrl`. `quiz` requires `quiz`. `divider` = section heading only. */
  contentKind?: LessonContentKind;
  /** Required when `contentKind === 'web'`. */
  webUrl?: string;
  /** Required when `contentKind === 'quiz'`. */
  quiz?: QuizDefinition;
  /**
   * Same shape as path outline `visibleToRoles`: omit → everyone; if **`learner`** is present → everyone; otherwise
   * only listed roles (`admin` / `creator`) may see; `[]` → hidden for everyone.
   */
  visibleToRoles?: PathOutlineAudienceRole[];
}

export interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
  /** @see Lesson.visibleToRoles — applies to this section (module) and its lessons in the learner shell. */
  visibleToRoles?: PathOutlineAudienceRole[];
}

export type CourseLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Proficient';

export interface Course {
  id: string;
  title: string;
  author: string;
  authorBio?: string;
  thumbnail: string;
  description: string;
  level: CourseLevel;
  duration: string;
  rating: number;
  /** Library topic labels (multi). */
  categories: string[];
  /** Skill tags (multi), e.g. React, Python. */
  skills: string[];
  modules: Module[];
  /**
   * Same shape as path outline `visibleToRoles`: omit → everyone; if **`learner`** is present → everyone; otherwise
   * only listed roles may see; `[]` → hidden for everyone in catalog browse and the course shell.
   */
  visibleToRoles?: PathOutlineAudienceRole[];
  /**
   * Platform catalog visibility for documents in `publishedCourses`. When `false`, the course is a draft: hidden from
   * learner browse, path outlines, and path builder pickers until published. Omit or `undefined` = visible (legacy).
   */
  catalogPublished?: boolean;
}

/** True when the course should appear in learner catalog, paths, and path link pickers (`publishedCourses` only). */
export function isCourseCatalogPublished(course: Course): boolean {
  return course.catalogPublished !== false;
}

/** Empty: course catalog and lesson content load from Firestore only (`publishedCourses`, creator drafts). */
export const STATIC_CATALOG_FALLBACK: Course[] = [];
