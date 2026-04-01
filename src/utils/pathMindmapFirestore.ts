import { deleteField, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { MindmapDocument } from '../data/pathMindmap';
import { parseMindmapDocument } from '../data/pathMindmap';
import { db, handleFirestoreError, OperationType } from '../firebase';

export const PATH_MINDMAP_FIELD = 'pathMindmap' as const;

export async function fetchPathMindmapFromFirestore(pathId: string): Promise<MindmapDocument | null> {
  try {
    const snap = await getDoc(doc(db, 'learningPaths', pathId));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    return parseMindmapDocument(data[PATH_MINDMAP_FIELD]);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `learningPaths/${pathId}`);
    return null;
  }
}

export async function savePathMindmapToFirestore(pathId: string, mindmap: MindmapDocument): Promise<boolean> {
  try {
    const payload = JSON.parse(JSON.stringify(mindmap)) as Record<string, unknown>;
    await updateDoc(doc(db, 'learningPaths', pathId), {
      [PATH_MINDMAP_FIELD]: payload,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `learningPaths/${pathId}`);
    return false;
  }
}

export async function deletePathMindmapFromFirestore(pathId: string): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'learningPaths', pathId), {
      [PATH_MINDMAP_FIELD]: deleteField(),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `learningPaths/${pathId}`);
    return false;
  }
}
