import { Extension } from '@tiptap/core';
import { isAtStartOfNode } from '@tiptap/core';
import { Fragment, type Node as PmNode, type ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';

const LIST_ITEM = 'listItem';
const ORDERED_LIST = 'orderedList';
const BULLET_LIST = 'bulletList';

function isInEmptyListItemParagraph(state: EditorState): boolean {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) {
    return false;
  }
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === LIST_ITEM) {
      return true;
    }
  }
  return false;
}

function findListItemContext($from: ResolvedPos): { listItemDepth: number; listDepth: number } | null {
  let listItemDepth = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === LIST_ITEM) {
      listItemDepth = d;
      break;
    }
  }
  if (listItemDepth < 1) return null;
  return { listItemDepth, listDepth: listItemDepth - 1 };
}

/**
 * Enter inside a list item (start, middle, or end of the first paragraph) when a non-empty
 * row follows: insert a plain paragraph between two list segments instead of splitListItem’s
 * empty bullet/number row. Ordered lists get a correct `start` on the tail.
 */
function insertParagraphBetweenListSegments(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;

  if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size === 0) {
    return false;
  }

  const ctx = findListItemContext($from);
  if (!ctx) return false;
  const { listItemDepth, listDepth } = ctx;

  if ($from.index(listItemDepth) !== 0) return false;

  const listNode = $from.node(listDepth);
  const listType = listNode.type.name;
  if (listType !== ORDERED_LIST && listType !== BULLET_LIST) return false;

  const indexInList = $from.index(listDepth);
  if (indexInList >= listNode.childCount - 1) return false;

  const nextItem = listNode.child(indexInList + 1);
  if (nextItem.type.name !== LIST_ITEM) return false;
  const firstInNext = nextItem.firstChild;
  if (!firstInNext || !firstInNext.isTextblock || firstInNext.content.size === 0) {
    return false;
  }

  const listItemType = state.schema.nodes[LIST_ITEM];
  if (!listItemType) return false;

  const para = $from.parent;
  const off = $from.parentOffset;
  const pSize = para.content.size;
  const atEnd = off === pSize;
  const atStart = off === 0;

  if (atStart && indexInList === 0) return false;

  const gapPara = state.schema.nodes.paragraph.create();

  let firstPart: Fragment;
  let secondPart: Fragment;
  /** Tail list’s first displayed index = ol.start + this (0-based offset into original list). */
  let tailStartDelta: number;

  if (atEnd) {
    const head: PmNode[] = [];
    for (let i = 0; i <= indexInList; i += 1) head.push(listNode.child(i));
    const tail: PmNode[] = [];
    for (let i = indexInList + 1; i < listNode.childCount; i += 1) tail.push(listNode.child(i));
    firstPart = Fragment.from(head);
    secondPart = Fragment.from(tail);
    tailStartDelta = indexInList + 1;
  } else if (atStart) {
    const head: PmNode[] = [];
    for (let i = 0; i < indexInList; i += 1) head.push(listNode.child(i));
    const tail: PmNode[] = [];
    for (let i = indexInList; i < listNode.childCount; i += 1) tail.push(listNode.child(i));
    firstPart = Fragment.from(head);
    secondPart = Fragment.from(tail);
    tailStartDelta = indexInList;
  } else {
    const currentItem = $from.node(listItemDepth);
    const leftPara = state.schema.nodes.paragraph.create(para.attrs, para.content.cut(0, off));
    const rightPara = state.schema.nodes.paragraph.create(para.attrs, para.content.cut(off));
    const leftItem = listItemType.create(currentItem.attrs, Fragment.from([leftPara]));
    const rightItem = listItemType.create(currentItem.attrs, Fragment.from([rightPara]));
    const head: PmNode[] = [];
    for (let i = 0; i < indexInList; i += 1) head.push(listNode.child(i));
    head.push(leftItem);
    const tail: PmNode[] = [rightItem];
    for (let i = indexInList + 1; i < listNode.childCount; i += 1) tail.push(listNode.child(i));
    firstPart = Fragment.from(head);
    secondPart = Fragment.from(tail);
    tailStartDelta = indexInList + 1;
  }

  if (secondPart.childCount === 0) return false;

  let secondAttrs = listNode.attrs;
  if (listType === ORDERED_LIST) {
    const start = typeof listNode.attrs.start === 'number' ? listNode.attrs.start : 1;
    secondAttrs = { ...listNode.attrs, start: start + tailStartDelta };
  }

  const firstList = listNode.type.create(listNode.attrs, firstPart);
  const secondList = listNode.type.create(secondAttrs, secondPart);

  const listPos = $from.before(listDepth);
  const listEnd = $from.after(listDepth);
  const tr = state.tr.replaceWith(listPos, listEnd, Fragment.from([firstList, gapPara, secondList]));
  const cursorPos = listPos + firstList.nodeSize + 1;
  tr.setSelection(TextSelection.create(tr.doc, cursorPos));

  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Word-style list exit: Enter or Backspace on an empty bullet/numbered row leaves the list (plain paragraph).
 * Runs before default list keymaps via priority.
 */
export const LessonNoteListBehavior = Extension.create({
  name: 'lessonNoteListBehavior',

  priority: 110,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (insertParagraphBetweenListSegments(editor.state, editor.view.dispatch)) {
          return true;
        }
        if (!isInEmptyListItemParagraph(editor.state)) {
          return false;
        }
        return editor.chain().focus().liftListItem(LIST_ITEM).run();
      },
      Backspace: ({ editor }) => {
        if (!editor.state.selection.empty) {
          return false;
        }
        if (!isAtStartOfNode(editor.state)) {
          return false;
        }
        if (!isInEmptyListItemParagraph(editor.state)) {
          return false;
        }
        return editor.chain().focus().liftListItem(LIST_ITEM).run();
      },
    };
  },
});
