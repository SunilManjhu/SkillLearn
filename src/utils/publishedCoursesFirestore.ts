import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { Course, Lesson, Module, QuizDefinition, QuizQuestion } from '../data/courses';
import { MAX_QUIZ_CHOICES, MAX_QUIZ_QUESTIONS } from '../data/courses';
import { compactVisibleToRolesForPersist, parseVisibleToRolesField } from '../data/pathMindmap';
import { coerceQuizIndex } from './quizCoercion';
import { dedupeLabelsPreserveOrder, isCourseLevel, normalizeCourseTaxonomy } from './courseTaxonomy';
import { db, handleFirestoreError, OperationType } from '../firebase';

/**
 * In-memory: survives React 18 Strict Mode remount in the same JS load.
 * Session: survives full page refresh so overview can hydrate from last Firestore snapshot immediately.
 */
let lastResolvedCatalog: Course[] | null = null;

const RESOLVED_CATALOG_SESSION_KEY = 'skilllearn:resolvedCatalog:v1';

function readCatalogFromSession(): Course[] | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(RESOLVED_CATALOG_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    if (data.length === 0) return [];
    for (const item of data) {
      if (!item || typeof item !== 'object') return null;
      const c = item as Record<string, unknown>;
      if (typeof c.id !== 'string' || !Array.isArray(c.modules)) return null;
      for (const mod of c.modules) {
        if (!mod || typeof mod !== 'object') return null;
        const mo = mod as Record<string, unknown>;
        if (!Array.isArray(mo.lessons)) return null;
      }
    }
    return data as Course[];
  } catch {
    return null;
  }
}

function writeCatalogToSession(courses: Course[]): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(RESOLVED_CATALOG_SESSION_KEY, JSON.stringify(courses));
  } catch {
    /* quota / private mode */
  }
}

/** For catalog `useState` initializer: memory (Strict remount) then session (full refresh); caller may fall back to `[]`. */
export function peekResolvedCatalogCourses(): Course[] | null {
  if (lastResolvedCatalog) return lastResolvedCatalog;
  return readCatalogFromSession();
}

function parseQuizQuestion(raw: unknown): QuizQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.id !== 'string' || !q.id.trim()) return null;
  if (typeof q.prompt !== 'string' || !q.prompt.trim()) return null;
  if (q.type === 'mcq') {
    if (!Array.isArray(q.choices)) return null;
    /** Keep indices aligned with author `correctIndex` after dropping empty slots. */
    const choices: string[] = [];
    const sourceIndices: number[] = [];
    for (let i = 0; i < q.choices.length; i += 1) {
      const c = q.choices[i];
      if (typeof c === 'string' && c.trim()) {
        sourceIndices.push(i);
        choices.push(c.trim());
      }
    }
    if (choices.length < 2 || choices.length > MAX_QUIZ_CHOICES) return null;
    const rawMarked = coerceQuizIndex(q.correctIndex);
    if (rawMarked === null) return null;
    const correctIndex = sourceIndices.indexOf(rawMarked);
    if (correctIndex < 0) return null;
    return { id: q.id.trim(), type: 'mcq', prompt: q.prompt.trim(), choices, correctIndex };
  }
  if (q.type === 'freeform') {
    const rubric = typeof q.rubric === 'string' ? q.rubric : undefined;
    const hintContext = typeof q.hintContext === 'string' ? q.hintContext : undefined;
    return {
      id: q.id.trim(),
      type: 'freeform',
      prompt: q.prompt.trim(),
      ...(rubric !== undefined ? { rubric } : {}),
      ...(hintContext !== undefined ? { hintContext } : {}),
    };
  }
  return null;
}

function parseQuizDefinition(raw: unknown): QuizDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.questions)) return null;
  const questions: QuizQuestion[] = [];
  for (const item of o.questions) {
    if (questions.length >= MAX_QUIZ_QUESTIONS) break;
    const pq = parseQuizQuestion(item);
    if (pq) questions.push(pq);
  }
  return { questions };
}

function parseLesson(raw: unknown): Lesson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string') return null;
  const videoUrl = typeof o.videoUrl === 'string' ? o.videoUrl : '';
  const lesson: Lesson = {
    id: o.id,
    title: o.title,
    videoUrl,
  };
  if (typeof o.duration === 'string') lesson.duration = o.duration;
  if (typeof o.about === 'string') lesson.about = o.about;
  if (typeof o.videoOutlineNotes === 'string') lesson.videoOutlineNotes = o.videoOutlineNotes;
  if (o.contentKind === 'quiz') {
    lesson.contentKind = 'quiz';
    lesson.videoUrl = videoUrl;
    const quiz = parseQuizDefinition(o.quiz);
    if (quiz && quiz.questions.length > 0) lesson.quiz = quiz;
  } else if (o.contentKind === 'divider') {
    lesson.contentKind = 'divider';
    lesson.videoUrl = '';
  } else {
    if (o.contentKind === 'web') lesson.contentKind = 'web';
    if (typeof o.webUrl === 'string') lesson.webUrl = o.webUrl;
  }
  const lvr = parseVisibleToRolesField(o);
  if (lvr !== undefined) lesson.visibleToRoles = lvr;
  return lesson;
}

function parseModule(raw: unknown): Module | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string' || !Array.isArray(o.lessons)) return null;
  const lessons: Lesson[] = [];
  for (const l of o.lessons) {
    const pl = parseLesson(l);
    if (pl) lessons.push(pl);
  }
  if (lessons.length === 0) return null;
  const mod: Module = { id: o.id, title: o.title, lessons };
  const mvr = parseVisibleToRolesField(o);
  if (mvr !== undefined) mod.visibleToRoles = mvr;
  return mod;
}

export function docToCourse(id: string, data: Record<string, unknown>): Course | null {
  if (
    typeof data.title !== 'string' ||
    typeof data.author !== 'string' ||
    typeof data.thumbnail !== 'string' ||
    typeof data.description !== 'string' ||
    typeof data.duration !== 'string' ||
    typeof data.rating !== 'number' ||
    typeof data.level !== 'string' ||
    !isCourseLevel(data.level) ||
    !Array.isArray(data.modules)
  ) {
    return null;
  }
  const modules: Module[] = [];
  for (const m of data.modules) {
    const pm = parseModule(m);
    if (pm) modules.push(pm);
  }
  if (modules.length === 0) return null;

  const categories: string[] = [];
  if (Array.isArray(data.categories)) {
    for (const x of data.categories) {
      if (typeof x === 'string' && x.trim()) categories.push(x.trim());
    }
  }
  if (categories.length === 0 && typeof data.category === 'string' && data.category.trim()) {
    categories.push(data.category.trim());
  }
  if (categories.length === 0) return null;

  const skills: string[] = [];
  if (Array.isArray(data.skills)) {
    for (const x of data.skills) {
      if (typeof x === 'string' && x.trim()) skills.push(x.trim());
    }
  }

  const course: Course = {
    id,
    title: data.title,
    author: data.author,
    thumbnail: data.thumbnail,
    description: data.description,
    level: data.level,
    duration: data.duration,
    rating: data.rating,
    categories: dedupeLabelsPreserveOrder(categories),
    skills: dedupeLabelsPreserveOrder(skills),
    modules,
  };
  if (typeof data.authorBio === 'string') course.authorBio = data.authorBio;
  if (data.catalogPublished === false) {
    course.catalogPublished = false;
  }
  const cvr = parseVisibleToRolesField(data);
  if (cvr !== undefined) course.visibleToRoles = cvr;
  return normalizeCourseTaxonomy(course);
}

/** All document ids in `publishedCourses` (includes docs that fail `docToCourse`). */
export async function listPublishedCourseDocumentIds(): Promise<string[]> {
  try {
    const snap = await getDocs(collection(db, 'publishedCourses'));
    return snap.docs.map((d) => d.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'publishedCourses');
    return [];
  }
}

/** Loads all documents from `publishedCourses`. Returns [] on error or empty collection. */
export async function loadPublishedCoursesFromFirestore(): Promise<Course[]> {
  try {
    const snap = await getDocs(collection(db, 'publishedCourses'));
    const out: Course[] = [];
    for (const d of snap.docs) {
      const c = docToCourse(d.id, d.data() as Record<string, unknown>);
      if (c) out.push(c);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'publishedCourses');
    return [];
  }
}

export async function resolveCatalogCourses(): Promise<Course[]> {
  const remote = await loadPublishedCoursesFromFirestore();
  const result = remote;
  lastResolvedCatalog = result;
  writeCatalogToSession(result);
  return result;
}

/** Firestore rejects `undefined` anywhere in the payload (e.g. `{ ...lesson, webUrl: undefined }` from admin patches). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep).filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const cleaned = stripUndefinedDeep(v);
    if (cleaned !== undefined) {
      out[k] = cleaned;
    }
  }
  return out;
}

function courseWithCompactedVisibilityRoles(course: Course): Course {
  const cr = compactVisibleToRolesForPersist(course.visibleToRoles);
  return {
    ...course,
    ...(cr !== undefined ? { visibleToRoles: cr } : {}),
    modules: course.modules.map((m) => {
      const mr = compactVisibleToRolesForPersist(m.visibleToRoles);
      return {
        ...m,
        ...(mr !== undefined ? { visibleToRoles: mr } : {}),
        lessons: m.lessons.map((l) => {
          const lr = compactVisibleToRolesForPersist(l.visibleToRoles);
          return { ...l, ...(lr !== undefined ? { visibleToRoles: lr } : {}) };
        }),
      };
    }),
  };
}

/**
 * Persists full course shape to `publishedCourses` / `creatorCourses`.
 * Always writes `catalogPublished` as a boolean so a full `setDoc` never drops a draft (`false`) when the in-memory
 * course omits the field (treated as published).
 */
export function courseToFirestorePayload(course: Course): Record<string, unknown> {
  const compacted = courseWithCompactedVisibilityRoles(course);
  const { id: _id, ...rest } = compacted;
  const cleaned = stripUndefinedDeep(rest) as Record<string, unknown>;
  const catalogPublished = course.catalogPublished !== false;
  return {
    ...cleaned,
    catalogPublished,
    updatedAt: serverTimestamp(),
  };
}

/** Admin: write or overwrite one published course (document id = course.id). */
export async function savePublishedCourse(course: Course): Promise<boolean> {
  try {
    await setDoc(doc(db, 'publishedCourses', course.id), courseToFirestorePayload(course));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `publishedCourses/${course.id}`);
    return false;
  }
}

/** Admin: remove a course from the live catalog. */
export async function deletePublishedCourse(courseId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'publishedCourses', courseId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `publishedCourses/${courseId}`);
    return false;
  }
}

