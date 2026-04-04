import { Paragraph } from '@tiptap/extension-paragraph';

/**
 * Block-level tags inside a div: treat as "structural" so we don't map the outer div to a paragraph.
 * (Nested divs are still unwrapped by the DOM parser; leaf-like divs become paragraphs.)
 */
const BLOCK_OR_COMPLEX = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIALOG',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HGROUP',
  'HR',
  'LI',
  'MAIN',
  'MENU',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'UL',
]);

function elementHasBlockishChild(el: HTMLElement): boolean {
  for (let i = 0; i < el.children.length; i += 1) {
    if (BLOCK_OR_COMPLEX.has(el.children[i].tagName)) {
      return true;
    }
  }
  return false;
}

/**
 * Paragraph that also accepts simple pasted `<div>` lines (Word, Google Docs, many mail clients).
 */
export const LessonNoteParagraph = Paragraph.extend({
  parseHTML() {
    return [
      ...(this.parent?.() ?? []),
      {
        tag: 'div',
        getAttrs: (node) => (elementHasBlockishChild(node as HTMLElement) ? false : null),
      },
    ];
  },
});
