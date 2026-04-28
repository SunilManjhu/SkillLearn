import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { MindmapDocument, MindmapTreeNode } from '../data/pathMindmap';
import { parseMindmapDocument } from '../data/pathMindmap';
import type { LearningPath } from '../data/learningPaths';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { docToLearningPath, pathToFirestorePayload } from './learningPathsFirestore';
import { outlineChildrenFromPathFirestoreData, PATH_MINDMAP_FIELD } from './pathMindmapFirestore';

/** Document ids for this owner (includes docs that fail `docToLearningPath`). */
export async function listCreatorLearningPathDocumentIdsForOwner(ownerUid: string): Promise<string[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'creatorLearningPaths'), where('ownerUid', '==', ownerUid))
    );
    return snap.docs.map((d) => d.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorLearningPaths');
    return [];
  }
}

/** All `creatorLearningPaths` document ids (any owner) — use when allocating new path ids for creators. */
export async function listAllCreatorLearningPathDocumentIds(): Promise<string[]> {
  try {
    const snap = await getDocs(collection(db, 'creatorLearningPaths'));
    return snap.docs.map((d) => d.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorLearningPaths');
    return [];
  }
}

export type CreatorLearningPathsLoadResult = {
  paths: LearningPath[];
  outlineChildrenByPathId: Record<string, MindmapTreeNode[]>;
};

export async function loadCreatorLearningPathsForOwner(ownerUid: string): Promise<CreatorLearningPathsLoadResult> {
  try {
    const snap = await getDocs(
      query(collection(db, 'creatorLearningPaths'), where('ownerUid', '==', ownerUid))
    );
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
    handleFirestoreError(error, OperationType.LIST, 'creatorLearningPaths');
    return { paths: [], outlineChildrenByPathId: {} };
  }
}

export async function listCreatorLearningPathsForAdminByOwner(ownerUid: string): Promise<LearningPath[]> {
  const r = await loadCreatorLearningPathsForOwner(ownerUid);
  return r.paths;
}

/** Admin browse: every `creatorLearningPaths` doc with parseable `ownerUid` + outline children (same shape as per-owner load). */
export async function loadAllCreatorLearningPathsForAdmin(): Promise<
  Array<{ path: LearningPath; ownerUid: string; outlineChildren: MindmapTreeNode[] }>
> {
  try {
    const snap = await getDocs(collection(db, 'creatorLearningPaths'));
    const out: Array<{ path: LearningPath; ownerUid: string; outlineChildren: MindmapTreeNode[] }> = [];
    for (const d of snap.docs) {
      const raw = d.data() as Record<string, unknown>;
      const ownerUid = typeof raw.ownerUid === 'string' ? raw.ownerUid.trim() : '';
      const p = docToLearningPath(d.id, raw);
      if (p && ownerUid) {
        out.push({
          path: p,
          ownerUid,
          outlineChildren: outlineChildrenFromPathFirestoreData(raw),
        });
      }
    }
    out.sort((a, b) => a.path.title.localeCompare(b.path.title, undefined, { sensitivity: 'base' }));
    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorLearningPaths');
    return [];
  }
}

export type SaveCreatorLearningPathOptions = {
  allowNonOwnerWriter?: boolean;
};

export async function saveCreatorLearningPath(
  path: LearningPath,
  ownerUid: string,
  options?: SaveCreatorLearningPathOptions
): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return false;
  }

  const isPrivilegedWriter = options?.allowNonOwnerWriter === true;
  const ref = doc(db, 'creatorLearningPaths', path.id);
  let resolvedOwnerUid: string;

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const raw = existing.data()?.ownerUid;
      const fromDb = typeof raw === 'string' ? raw.trim() : '';
      if (isPrivilegedWriter) {
        resolvedOwnerUid = fromDb || ownerUid.trim() || uid;
      } else {
        if (fromDb && fromDb !== uid) {
          return false;
        }
        resolvedOwnerUid = uid;
      }
    } else if (isPrivilegedWriter) {
      const t = ownerUid.trim();
      if (!t) return false;
      resolvedOwnerUid = t;
    } else {
      resolvedOwnerUid = uid;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `creatorLearningPaths/${path.id}`);
    return false;
  }

  if (!isPrivilegedWriter && uid !== resolvedOwnerUid) {
    return false;
  }

  try {
    const payload = { ...pathToFirestorePayload(path), ownerUid: resolvedOwnerUid } as Record<string, unknown>;
    await setDoc(ref, payload, { merge: true });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `creatorLearningPaths/${path.id}`);
    return false;
  }
}

export async function deleteCreatorLearningPath(pathId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'creatorLearningPaths', pathId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `creatorLearningPaths/${pathId}`);
    return false;
  }
}

export async function fetchCreatorPathMindmapFromFirestore(pathId: string): Promise<MindmapDocument | null> {
  try {
    const snap = await getDoc(doc(db, 'creatorLearningPaths', pathId));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    return parseMindmapDocument(data[PATH_MINDMAP_FIELD]);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `creatorLearningPaths/${pathId}`);
    return null;
  }
}

export async function saveCreatorPathMindmapToFirestore(
  pathId: string,
  mindmap: MindmapDocument
): Promise<boolean> {
  try {
    const payload = JSON.parse(JSON.stringify(mindmap)) as Record<string, unknown>;
    await updateDoc(doc(db, 'creatorLearningPaths', pathId), {
      [PATH_MINDMAP_FIELD]: payload,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `creatorLearningPaths/${pathId}`);
    return false;
  }
}
