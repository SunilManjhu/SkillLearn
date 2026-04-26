import type { Course } from '../../data/courses';

/** Course editor “Level” pickers (toolbar + details). */
export const ADMIN_COURSE_LEVEL_LISTBOX_OPTIONS: Array<{ value: Course['level']; label: string }> = [
  { value: 'Beginner', label: 'Beginner' },
  { value: 'Intermediate', label: 'Intermediate' },
  { value: 'Advanced', label: 'Advanced' },
  { value: 'Proficient', label: 'Proficient' },
];

/** Catalog / path outline “Show” audience (maps to `visibleToRoles` via parent `onChange`). */
export const COURSE_HIERARCHY_AUDIENCE_LISTBOX_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'everyone', label: 'User (admins included)' },
  { value: 'admin', label: 'Administrators only' },
];
