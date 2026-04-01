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
import type { MindmapDocument } from '../data/pathMindmap';
import { parseMindmapDocument } from '../data/pathMindmap';
import type { LearningPath } from '../data/learningPaths';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { docToLearningPath, pathToFirestorePayload } from './learningPathsFirestore';
import { PATH_MINDMAP_FIELD } from './pathMindmapFirestore';

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

export async function loadCreatorLearningPathsForOwner(ownerUid: string): Promise<LearningPath[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'creatorLearningPaths'), where('ownerUid', '==', ownerUid))
    );
    const out: LearningPath[] = [];
    for (const d of snap.docs) {
      const p = docToLearningPath(d.id, d.data() as Record<string, unknown>);
      if (p) out.push(p);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorLearningPaths');
    return [];
  }
}

export async function listCreatorLearningPathsForAdminByOwner(ownerUid: string): Promise<LearningPath[]> {
  return loadCreatorLearningPathsForOwner(ownerUid);
}

export async function saveCreatorLearningPath(path: LearningPath, ownerUid: string): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid || uid !== ownerUid) {
    return false;
  }
  try {
    const ref = doc(db, 'creatorLearningPaths', path.id);
    const payload = { ...pathToFirestorePayload(path), ownerUid } as Record<string, unknown>;
    // No pre-read: `get` on a missing doc can be denied under some rule sets. Shallow merge keeps
    // existing `pathMindmap` (and other fields) when updating title/courseIds/ownerUid.
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
