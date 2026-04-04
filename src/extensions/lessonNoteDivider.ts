import HorizontalRule from '@tiptap/extension-horizontal-rule';

/** Lesson note dividers use one visual style only (thick line). */
export type LessonDividerStyle = 'thick';

/**
 * Horizontal rule for notes, stored as `<hr data-divider-style="thick" class="lesson-note-divider">`.
 * Legacy thin/dotted values in saved HTML normalize to thick on load.
 */
export const LessonNoteDivider = HorizontalRule.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dividerStyle: {
        default: 'thick' as LessonDividerStyle,
        parseHTML: () => 'thick' as const,
        renderHTML: () => ({
          'data-divider-style': 'thick',
          class: 'lesson-note-divider',
        }),
      },
    };
  },

  /** No auto `---` / `***` rules — those eat lines that start with `--` (e.g. “-- Jyoti”); use the toolbar divider control instead. */
  addInputRules() {
    return [];
  },
});
