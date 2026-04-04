import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const ORDERED_LIST = 'orderedList';

/**
 * When two numbered lists become siblings (e.g. user deletes the blank line between them),
 * merge them into one list so the browser shows 1…2…3…4 instead of 1…2 then 1…2 again.
 */
export const LessonNoteOrderedListMerge = Extension.create({
  name: 'lessonNoteOrderedListMerge',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('lessonNoteOrderedListMerge'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }

          let tr = newState.tr;
          let doc = tr.doc;
          let changed = false;

          while (doc.childCount >= 2) {
            let mergedThisPass = false;
            for (let i = doc.childCount - 2; i >= 0; i -= 1) {
              const a = doc.child(i);
              const b = doc.child(i + 1);
              if (a.type.name !== ORDERED_LIST || b.type.name !== ORDERED_LIST) {
                continue;
              }

              let pos = 0;
              for (let j = 0; j < i; j += 1) {
                pos += doc.child(j).nodeSize;
              }
              const from = pos;
              const to = pos + a.nodeSize + b.nodeSize;
              const mergedNode = a.type.create(a.attrs, a.content.append(b.content));
              tr = tr.replaceWith(from, to, mergedNode);
              changed = true;
              mergedThisPass = true;
              doc = tr.doc;
              break;
            }
            if (!mergedThisPass) {
              break;
            }
          }

          return changed ? tr : null;
        },
      }),
    ];
  },
});
