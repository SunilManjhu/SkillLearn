import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type { MindmapTreeNode } from '../data/pathMindmap';
import {
  collectCourseIdsFromMindmapTree,
  mindmapDocumentWithCenterChildren,
  removeCourseIdFromMindmapBranchList,
} from '../data/pathMindmap';
import type { LearningPath } from '../data/learningPaths';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { docToLearningPath, loadLearningPathsFromFirestore, saveLearningPath } from './learningPathsFirestore';
import {
  loadCreatorLearningPathsForOwner,
  saveCreatorLearningPath,
  saveCreatorPathMindmapToFirestore,
} from './creatorLearningPathsFirestore';
import { outlineChildrenFromPathFirestoreData, savePathMindmapToFirestore } from './pathMindmapFirestore';

export type LearningPathCourseRefHit = {
  pathId: string;
  title: string;
  persistence: 'published' | 'creator';
  ownerUid?: string;
};

export type FindLearningPathRefsForCourseOptions = {
  /**
   * When deleting a creator-owned course, only that owner's paths can reference it.
   * Omit when deleting a published catalog course (scan all creator paths; requires admin list permission).
   */
  creatorOwnerUidForScopedScan?: string;
};

export function learningPathReferencesCourseId(
  path: LearningPath,
  outlineChildren: MindmapTreeNode[],
  courseId: string
): boolean {
  if (outlineChildren.length > 0) {
    if (collectCourseIdsFromMindmapTree(outlineChildren).has(courseId)) return true;
    return path.courseIds.includes(courseId);
  }
  return path.courseIds.includes(courseId);
}

export async function findLearningPathReferencesToCourseId(
  courseId: string,
  options?: FindLearningPathRefsForCourseOptions
): Promise<LearningPathCourseRefHit[]> {
  const hits: LearningPathCourseRefHit[] = [];

  const pub = await loadLearningPathsFromFirestore();
  for (const p of pub.paths) {
    const outline = pub.outlineChildrenByPathId[p.id] ?? [];
    if (learningPathReferencesCourseId(p, outline, courseId)) {
      hits.push({ pathId: p.id, title: p.title, persistence: 'published' });
    }
  }

  const scoped = options?.creatorOwnerUidForScopedScan?.trim();
  if (scoped) {
    const cr = await loadCreatorLearningPathsForOwner(scoped);
    for (const p of cr.paths) {
      const outline = cr.outlineChildrenByPathId[p.id] ?? [];
      if (learningPathReferencesCourseId(p, outline, courseId)) {
        hits.push({ pathId: p.id, title: p.title, persistence: 'creator', ownerUid: scoped });
      }
    }
    return hits;
  }

  try {
    const snap = await getDocs(collection(db, 'creatorLearningPaths'));
    for (const d of snap.docs) {
      const raw = d.data() as Record<string, unknown>;
      const p = docToLearningPath(d.id, raw);
      if (!p) continue;
      const ownerUid = typeof raw.ownerUid === 'string' ? raw.ownerUid.trim() : '';
      const outline = outlineChildrenFromPathFirestoreData(raw);
      if (learningPathReferencesCourseId(p, outline, courseId)) {
        hits.push({
          pathId: p.id,
          title: p.title,
          persistence: 'creator',
          ownerUid: ownerUid || undefined,
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorLearningPaths');
  }

  return hits;
}

export type RemoveCourseFromPathOptions = {
  /** Admin updating another user's creator path while deleting a published course from that outline. */
  allowNonOwnerCreatorPathWrite?: boolean;
};

export async function removeCourseIdFromLearningPathDocument(
  hit: LearningPathCourseRefHit,
  courseId: string,
  options?: RemoveCourseFromPathOptions
): Promise<boolean> {
  const coll = hit.persistence === 'published' ? 'learningPaths' : 'creatorLearningPaths';
  const ref = doc(db, coll, hit.pathId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${coll}/${hit.pathId}`);
    return false;
  }
  if (!snap.exists()) return false;
  const raw = snap.data() as Record<string, unknown>;
  const path = docToLearningPath(hit.pathId, raw);
  if (!path) return false;

  const outline = outlineChildrenFromPathFirestoreData(raw);
  const hadOutline = outline.length > 0;
  const newOutline = hadOutline ? removeCourseIdFromMindmapBranchList(outline, courseId) : [];
  const nextCourseIds = hadOutline
    ? [...collectCourseIdsFromMindmapTree(newOutline)]
    : path.courseIds.filter((id) => id !== courseId);

  const nextPath: LearningPath = { ...path, courseIds: nextCourseIds };

  if (hit.persistence === 'published') {
    const okPath = await saveLearningPath(nextPath);
    if (!okPath) return false;
    if (hadOutline) {
      const okMm = await savePathMindmapToFirestore(
        hit.pathId,
        mindmapDocumentWithCenterChildren(newOutline)
      );
      if (!okMm) return false;
    }
    return true;
  }

  const ownerUid = hit.ownerUid?.trim();
  if (!ownerUid) return false;
  const okPath = await saveCreatorLearningPath(nextPath, ownerUid, {
    allowNonOwnerWriter: options?.allowNonOwnerCreatorPathWrite === true,
  });
  if (!okPath) return false;
  if (hadOutline) {
    const okMm = await saveCreatorPathMindmapToFirestore(
      hit.pathId,
      mindmapDocumentWithCenterChildren(newOutline)
    );
    if (!okMm) return false;
  }
  return true;
}
