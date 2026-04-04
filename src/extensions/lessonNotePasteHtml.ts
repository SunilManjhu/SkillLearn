import { Extension } from '@tiptap/core';

/**
 * Normalize clipboard HTML before ProseMirror parses it so common apps keep bold, lists, etc.
 * - Drops embedded Word/browser `<style>`, `<meta>`, `<link>` noise that can confuse parsing.
 */
export const LessonNotePasteHtml = Extension.create({
  name: 'lessonNotePasteHtml',

  priority: 1000,

  transformPastedHTML(html) {
    if (typeof DOMParser === 'undefined' || !html?.trim()) {
      return html;
    }
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const root = doc.body;
      root.querySelectorAll('style, meta, link, title').forEach((el) => el.remove());
      return root.innerHTML;
    } catch {
      return html;
    }
  },
});
