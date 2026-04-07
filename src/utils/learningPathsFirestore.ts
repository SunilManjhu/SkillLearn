import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { MindmapTreeNode } from '../data/pathMindmap';
import type { LearningPath } from '../data/learningPaths';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { outlineChildrenFromPathFirestoreData, PATH_MINDMAP_FIELD } from './pathMindmapFirestore';

const MAX_COURSE_IDS = 100;
const MAX_TITLE = 500;
const MAX_DESCRIPTION = 20000;
const MAX_ID_LEN = 200;

function parseCourseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || x.length === 0 || x.length > MAX_ID_LEN) return null;
    out.push(x);
  }
  if (out.length > MAX_COURSE_IDS) return null;
  return out;
}

export function docToLearningPath(id: string, data: Record<string, unknown>): LearningPath | null {
  if (typeof data.title !== 'string' || data.title.length === 0 || data.title.length > MAX_TITLE) {
    return null;
  }
  const courseIds = parseCourseIds(data.courseIds);
  if (courseIds === null) return null;
  if (data.description !== undefined && typeof data.description !== 'string') return null;
  if (data.description !== undefined && (data.description as string).length > MAX_DESCRIPTION) {
    return null;
  }
  const path: LearningPath = { id, title: data.title, courseIds };
  if (typeof data.description === 'string' && data.description.length > 0) {
    path.description = data.description;
  }
  if ('catalogPublished' in data) {
    if (typeof data.catalogPublished !== 'boolean') return null;
    path.catalogPublished = data.catalogPublished;
  }
  return path;
}

/**
 * Full-document save: always write `catalogPublished` as a boolean so `setDoc` does not drop draft `false`
 * when the in-memory path omits the field (treated as published).
 */
export function pathToFirestorePayload(path: LearningPath): Record<string, unknown> {
  const { id: _id, catalogPublished: _cp, ...rest } = path;
  const catalogPublished = path.catalogPublished !== false;
  return {
    ...rest,
    catalogPublished,
    updatedAt: serverTimestamp(),
  };
}

/** All document ids in `learningPaths` (includes docs that fail `docToLearningPath`). */
export async function listLearningPathDocumentIds(): Promise<string[]> {
  try {
    const snap = await getDocs(collection(db, 'learningPaths'));
    return snap.docs.map((d) => d.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'learningPaths');
    return [];
  }
}

export type LearningPathsFirestoreLoadResult = {
  paths: LearningPath[];
  /** Top-level mindmap branches keyed by path id (from the same `getDocs` — avoids a per-path `getDoc` in the catalog). */
  outlineChildrenByPathId: Record<string, MindmapTreeNode[]>;
};

export async function loadLearningPathsFromFirestore(): Promise<LearningPathsFirestoreLoadResult> {
  try {
    const snap = await getDocs(collection(db, 'learningPaths'));
    const out: LearningPath[] = [];
    const outlineChildrenByPathId: Record<string, MindmapTreeNode[]> = {};
    for (const d of snap.docs) {
      const raw = d.data() as Record<string, unknown>;
      const p = docToLearningPath(d.id, raw);
      if (p) {
        out.push(p);
        outlineChildrenByPathId[d.id] = outlineChildrenFromPathFirestoreData(raw);
      }
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return { paths: out, outlineChildrenByPathId };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'learningPaths');
    return { paths: [], outlineChildrenByPathId: {} };
  }
}

export async function saveLearningPath(path: LearningPath): Promise<boolean> {
  try {
    const ref = doc(db, 'learningPaths', path.id);
    const payload = { ...pathToFirestorePayload(path) } as Record<string, unknown>;
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as Record<string, unknown>;
      if (PATH_MINDMAP_FIELD in existing) {
        payload[PATH_MINDMAP_FIELD] = existing[PATH_MINDMAP_FIELD];
      }
    }
    await setDoc(ref, payload);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `learningPaths/${path.id}`);
    return false;
  }
}

export async function deleteLearningPath(pathId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'learningPaths', pathId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `learningPaths/${pathId}`);
    return false;
  }
}
