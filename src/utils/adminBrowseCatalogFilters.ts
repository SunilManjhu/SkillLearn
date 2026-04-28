import type { CatalogCourseRow, CatalogLearningPathRow } from './learnerCatalogMerge';
import { catalogCourseEntryVisibleToViewer } from './courseHierarchyVisibility';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { pathOutlineHasVisibleLearnerRowForViewer } from '../data/pathMindmap';

/**
 * Published catalog row that learners do not see in the library shell but admins do
 * (administrator-only audience on the course). Excludes creator drafts and admin preview rows.
 */
export function catalogCourseRowIsLearnerHiddenAdminVisible(row: CatalogCourseRow): boolean {
  if (row.fromCreatorDraft || row.adminPreviewOwnerUid?.trim()) return false;
  const c = row.course;
  return (
    !catalogCourseEntryVisibleToViewer(c, false, false) && catalogCourseEntryVisibleToViewer(c, true, false)
  );
}

/** Published platform row that appears in the learner browse shell (everyone / learner audience). */
export function catalogCourseRowIsLearnerEveryoneCatalog(row: CatalogCourseRow): boolean {
  if (row.fromCreatorDraft || row.adminPreviewOwnerUid?.trim()) return false;
  return catalogCourseEntryVisibleToViewer(row.course, false, false);
}

/** Creator-studio merge row (draft / preview), not platform-published catalog. */
export function catalogCourseRowIsCreatorRoleCatalog(row: CatalogCourseRow): boolean {
  return row.fromCreatorDraft;
}

/** Union of learner catalog, creator catalog, and admin-only-audience rows (admin “Show all” browse). */
export function catalogCourseRowMatchesAdminBrowseShowAll(row: CatalogCourseRow): boolean {
  return (
    catalogCourseRowIsLearnerEveryoneCatalog(row) ||
    catalogCourseRowIsCreatorRoleCatalog(row) ||
    catalogCourseRowIsLearnerHiddenAdminVisible(row)
  );
}

/**
 * Published path row whose outline has no learner-visible rows but does for admins.
 * When `branches` is undefined, returns false (cannot classify yet).
 */
export function learningPathRowIsLearnerHiddenAdminVisible(
  row: CatalogLearningPathRow,
  branches: MindmapTreeNode[] | undefined,
  learnerOutlineCatalogCourseIdSet: ReadonlySet<string> | null
): boolean {
  if (row.fromCreatorDraft || row.adminPreviewOwnerUid?.trim()) return false;
  if (branches === undefined) return false;
  const learnerSees = pathOutlineHasVisibleLearnerRowForViewer(
    branches,
    false,
    learnerOutlineCatalogCourseIdSet,
    false
  );
  const adminSees = pathOutlineHasVisibleLearnerRowForViewer(branches, true, null, false);
  return !learnerSees && adminSees;
}

/** Published path whose outline would show at least one row to a learner in browse (matches {@link pathOutlineHasVisibleLearnerRowForViewer} when branches are still loading). */
export function learningPathRowIsLearnerEveryoneCatalog(
  row: CatalogLearningPathRow,
  branches: MindmapTreeNode[] | undefined,
  learnerOutlineCatalogCourseIdSet: ReadonlySet<string>
): boolean {
  if (row.fromCreatorDraft || row.adminPreviewOwnerUid?.trim()) return false;
  return pathOutlineHasVisibleLearnerRowForViewer(
    branches,
    false,
    learnerOutlineCatalogCourseIdSet,
    false
  );
}

export function learningPathRowIsCreatorRoleCatalog(row: CatalogLearningPathRow): boolean {
  return row.fromCreatorDraft;
}

/** Union of the three admin browse path buckets. */
export function learningPathRowMatchesAdminBrowseShowAll(
  row: CatalogLearningPathRow,
  branches: MindmapTreeNode[] | undefined,
  learnerOutlineCatalogCourseIdSet: ReadonlySet<string>
): boolean {
  return (
    learningPathRowIsLearnerEveryoneCatalog(row, branches, learnerOutlineCatalogCourseIdSet) ||
    learningPathRowIsCreatorRoleCatalog(row) ||
    learningPathRowIsLearnerHiddenAdminVisible(row, branches, learnerOutlineCatalogCourseIdSet)
  );
}
