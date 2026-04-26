import type { Course } from '../../data/courses';

/** Course editor “Level” pickers (toolbar + details). */
export const ADMIN_COURSE_LEVEL_LISTBOX_OPTIONS: Array<{ value: Course['level']; label: string }> = [
  { value: 'Beginner', label: 'Beginner' },
  { value: 'Intermediate', label: 'Intermediate' },
  { value: 'Advanced', label: 'Advanced' },
  { value: 'Proficient', label: 'Proficient' },
];

