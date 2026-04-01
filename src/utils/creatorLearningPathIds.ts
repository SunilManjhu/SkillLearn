import { collection, doc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Allocate a new document id for `creatorLearningPaths`.
 * Uses Firestore's client-side auto-id (globally unique) so we never collide with another
 * creator's `P1` / `P2` doc in the same collection.
 */
export function newCreatorLearningPathFirestoreId(): string {
  return doc(collection(db, 'creatorLearningPaths')).id;
}
