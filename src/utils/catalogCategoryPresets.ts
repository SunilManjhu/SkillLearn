/**
 * Single source of truth for built-in course categories (Course Library filters, admin Category field, defaults).
 * User-added names also live in localStorage via catalogCategoryExtras.
 */

export const CATALOG_MAIN_PILLS = [
  'Software Development',
  'Cloud Computing',
  'Data Science',
  'Cybersecurity',
  'AI & ML',
] as const;

export const CATALOG_STATIC_MORE = [
  'Business',
  'Design',
  'Marketing',
  'Personal Development',
] as const;

/** Top filter row: All + primary topic pills. */
export const CATALOG_CATEGORIES_ROW: readonly string[] = ['All', ...CATALOG_MAIN_PILLS];

/** All preset labels (main + “More” bucket), no “All”. Use for admin datalist seeds and any full preset list. */
export function allPresetCatalogCategories(): string[] {
  return [...CATALOG_MAIN_PILLS, ...CATALOG_STATIC_MORE];
}

/** Default category for new drafts (first main pill). */
export function defaultNewCourseCategory(): string {
  return CATALOG_MAIN_PILLS[0];
}
