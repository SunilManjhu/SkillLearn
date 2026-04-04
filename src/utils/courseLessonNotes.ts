import type { Course } from '../data/courses';
import { isLessonNoteContentEmpty } from './lessonNoteHtml';

const PREFIX = 'skilllearn-lesson-notes:';

/** One lesson entry; matches a future Firestore-friendly document shape. */
/** `text` is HTML from the rich-text editor (legacy Markdown/plain may exist until next save). */
export type LessonNoteEntry = { text: string; updatedAt: string };

export type LessonNotesDocumentV1 = {
  v: 1;
  lessons: Record<string, LessonNoteEntry>;
};

function storageKey(courseId: string, userId: string | null | undefined): string {
  if (userId) return `${PREFIX}user:${userId}:${courseId}`;
  return `${PREFIX}anon:${courseId}`;
}

function emptyDoc(): LessonNotesDocumentV1 {
  return { v: 1, lessons: {} };
}

function parseDoc(raw: string | null): LessonNotesDocumentV1 {
  if (!raw) return emptyDoc();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyDoc();
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== 1 || !rec.lessons || typeof rec.lessons !== 'object' || Array.isArray(rec.lessons)) {
      return emptyDoc();
    }
    return { v: 1, lessons: rec.lessons as Record<string, LessonNoteEntry> };
  } catch {
    return emptyDoc();
  }
}

/** Full map for a course (all lessons with saved notes). */
export function loadLessonNotesMap(courseId: string, userId?: string | null): Record<string, LessonNoteEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const doc = parseDoc(localStorage.getItem(storageKey(courseId, userId)));
    return doc.lessons && typeof doc.lessons === 'object' ? { ...doc.lessons } : {};
  } catch {
    return {};
  }
}

export function readLessonNoteText(courseId: string, userId: string | null | undefined, lessonId: string): string {
  const map = loadLessonNotesMap(courseId, userId);
  const t = map[lessonId]?.text;
  return typeof t === 'string' ? t : '';
}

function writeDoc(courseId: string, userId: string | null | undefined, doc: LessonNotesDocumentV1): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(courseId, userId), JSON.stringify(doc));
  } catch {
    /* quota or private mode */
  }
}

/** Persist immediately (use on blur and for debounced flush). */
export function flushLessonNote(
  courseId: string,
  userId: string | null | undefined,
  lessonId: string,
  text: string
): void {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey(courseId, userId)) : null;
  let doc = parseDoc(raw);
  if (isLessonNoteContentEmpty(text)) {
    const { [lessonId]: _removed, ...rest } = doc.lessons;
    doc = { v: 1, lessons: rest };
  } else {
    doc = {
      v: 1,
      lessons: {
        ...doc.lessons,
        [lessonId]: { text, updatedAt: new Date().toISOString() },
      },
    };
  }
  writeDoc(courseId, userId, doc);
}

/**
 * Debounced saver: `schedule` on each keystroke; `cancel` on lesson change before sync flush.
 */
export function createDebouncedLessonNoteSave(
  courseId: string,
  userId: string | null | undefined,
  delayMs: number
): { schedule: (lessonId: string, text: string) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { lessonId: string; text: string } | null = null;

  const run = () => {
    timer = null;
    if (pending) {
      flushLessonNote(courseId, userId, pending.lessonId, pending.text);
      pending = null;
    }
  };

  return {
    schedule: (lessonId: string, text: string) => {
      pending = { lessonId, text };
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/** Clear all lesson notes for a course in localStorage (e.g. if mirroring progress clear). */
export function clearLessonNotesLocal(courseId: string, userId: string | null | undefined): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(courseId, userId));
  } catch {
    /* ignore */
  }
}

/** Shape suitable for a future `users/{uid}/courseNotes/{courseId}` document. */
export function lessonNotesDocumentForFirestore(course: Course, userId: string): LessonNotesDocumentV1 {
  const lessons = loadLessonNotesMap(course.id, userId);
  return { v: 1, lessons };
}
