import { useEffect, useState } from 'react';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { fetchPathMindmapFromFirestore } from '../utils/pathMindmapFirestore';

/**
 * Loads `pathMindmap` children for a learning path (same document as learner outline).
 * `children === null` while loading; `[]` when missing or empty.
 */
export function usePathMindmapOutlineChildren(pathId: string | null): {
  loading: boolean;
  children: MindmapTreeNode[] | null;
} {
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<MindmapTreeNode[] | null>(null);

  useEffect(() => {
    if (!pathId) {
      setLoading(false);
      setChildren(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setChildren(null);
    void fetchPathMindmapFromFirestore(pathId).then((doc) => {
      if (cancelled) return;
      if (!doc || doc.root.children.length === 0) setChildren([]);
      else setChildren(doc.root.children);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pathId]);

  return { loading, children };
}
