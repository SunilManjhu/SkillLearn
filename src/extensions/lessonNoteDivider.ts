import HorizontalRule from '@tiptap/extension-horizontal-rule';

export type LessonDividerStyle = 'thin' | 'thick' | 'dotted';

/**
 * Horizontal rule with student-friendly variants (thin / thick / dotted), stored as
 * `<hr data-divider-style="…" class="lesson-note-divider--…">`.
 */
export const LessonNoteDivider = HorizontalRule.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dividerStyle: {
        default: 'thin' as LessonDividerStyle,
        parseHTML: (element) => {
          const d = element.getAttribute('data-divider-style');
          if (d === 'thick' || d === 'dotted' || d === 'thin') return d;
          return 'thin';
        },
        renderHTML: (attributes) => {
          const style = (attributes.dividerStyle as LessonDividerStyle) || 'thin';
          return {
            'data-divider-style': style,
            class: `lesson-note-divider lesson-note-divider--${style}`,
          };
        },
      },
    };
  },

  /** No auto `---` / `***` rules — those eat lines that start with `--` (e.g. “-- Jyoti”); use the divider menu instead. */
  addInputRules() {
    return [];
  },
});
