import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { loadCreatorLearningPathsForOwner } from './creatorLearningPathsFirestore';
import { loadLearningPathsFromFirestore } from './learningPathsFirestore';

export function displayTitlesCollide(a: string, b: string): boolean {
  const t = (s: string) => s.trim();
  const x = t(a);
  const y = t(b);
  if (!x || !y) return false;
  return x.localeCompare(y, undefined, { sensitivity: 'base' }) === 0;
}

export type TitleConflictHit = {
  entity: 'course' | 'path';
  id: string;
  title: string;
};

export async function loadPathTitlesForConflictCheck(options: {
  mode: 'admin' | 'creator';
  creatorOwnerUid?: string;
}): Promise<TitleConflictHit[]> {
  const out: TitleConflictHit[] = [];
  const seen = new Set<string>();

  const pub = await loadLearningPathsFromFirestore();
  for (const p of pub.paths) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ entity: 'path', id: p.id, title: p.title });
  }

  if (options.mode === 'admin') {
    const snap = await getDocs(collection(db, 'creatorLearningPaths'));
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const title = d.data().title;
      out.push({
        entity: 'path',
        id: d.id,
        title: typeof title === 'string' ? title : d.id,
      });
    }
  } else if (options.creatorOwnerUid) {
    const cr = await loadCreatorLearningPathsForOwner(options.creatorOwnerUid);
    for (const p of cr.paths) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ entity: 'path', id: p.id, title: p.title });
    }
  }

  return out;
}

export function findCourseSaveTitleConflict(
  draftTitle: string,
  draftCourseId: string,
  courses: { id: string; title: string }[]
): TitleConflictHit | null {
  for (const c of courses) {
    if (c.id === draftCourseId) continue;
    if (displayTitlesCollide(draftTitle, c.title)) {
      return { entity: 'course', id: c.id, title: c.title };
    }
  }
  return null;
}

/** Paths may share a display title with a course; only other paths collide. */
export function findPathSaveTitleConflict(
  pathTitle: string,
  pathId: string,
  paths: TitleConflictHit[]
): TitleConflictHit | null {
  for (const p of paths) {
    if (p.id === pathId) continue;
    if (displayTitlesCollide(pathTitle, p.title)) return p;
  }
  return null;
}
