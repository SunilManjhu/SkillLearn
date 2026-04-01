import { useEffect, useState } from 'react';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { fetchCreatorPathMindmapFromFirestore } from '../utils/creatorLearningPathsFirestore';
import { fetchPathMindmapFromFirestore } from '../utils/pathMindmapFirestore';

export type PathMindmapOutlineOptions = {
  /** When the path id is in this set, load from `creatorLearningPaths` (signed-in creator draft). */
  creatorDraftPathIds?: ReadonlySet<string> | null;
  /**
   * When published and creator draft share the same path id, set true to load the creator doc.
   * If omitted, falls back to `creatorDraftPathIds?.has(pathId)` for backwards compatibility.
   */
  useCreatorDraftMindmap?: boolean;
};

/**
 * Loads `pathMindmap` children for a learning path (published `learningPaths` or creator draft).
 * `children === null` while loading; `[]` when missing or empty.
 */
export function usePathMindmapOutlineChildren(
  pathId: string | null,
  options?: PathMindmapOutlineOptions
): {
  loading: boolean;
  children: MindmapTreeNode[] | null;
} {
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<MindmapTreeNode[] | null>(null);
  const draftSet = options?.creatorDraftPathIds;
  const explicitDraft = options?.useCreatorDraftMindmap;

  useEffect(() => {
    if (!pathId) {
      setLoading(false);
      setChildren(null);
      return;
    }
    const fromCreator =
      explicitDraft === true ||
      (explicitDraft !== false && explicitDraft === undefined && draftSet?.has(pathId) === true);
    let cancelled = false;
    setLoading(true);
    setChildren(null);
    const load = fromCreator ? fetchCreatorPathMindmapFromFirestore(pathId) : fetchPathMindmapFromFirestore(pathId);
    void load.then((doc) => {
      if (cancelled) return;
      if (!doc || doc.root.children.length === 0) setChildren([]);
      else setChildren(doc.root.children);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pathId, draftSet, explicitDraft]);

  return { loading, children };
}
