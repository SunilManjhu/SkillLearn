import React, { type ReactNode, useEffect, useId, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  List,
  ListOrdered,
  Undo2,
  Redo2,
} from 'lucide-react';
import { LessonNoteDivider, type LessonDividerStyle } from '../extensions/lessonNoteDivider';
import { LessonNoteListBehavior } from '../extensions/lessonNoteListBehavior';
import { LessonNoteOrderedListMerge } from '../extensions/lessonNoteOrderedListMerge';
import { LessonNoteParagraph } from '../extensions/lessonNoteParagraph';
import { LessonNotePasteHtml } from '../extensions/lessonNotePasteHtml';
import { LessonNoteClipboardExport } from '../extensions/lessonNoteClipboardExport';
import { migrateStoredNoteToHtml, normalizeLessonNoteHtmlForSave } from '../utils/lessonNoteHtml';

export type LessonNotesRichEditorProps = {
  /** When this changes, editor document is replaced from `initialHtml` (multiple sidebars / edge cases). */
  lessonId: string;
  initialHtml: string;
  onHtmlChange: (html: string) => void;
  onBlur?: () => void;
  'aria-label': string;
};

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded-md touch-manipulation disabled:pointer-events-none disabled:opacity-35 ${
        active
          ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
          : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function DividerInsertControl({ editor }: { editor: Editor }) {
  const selectId = useId();
  const [selectKey, setSelectKey] = useState(0);

  return (
    <div className="flex min-h-9 items-center">
      <label htmlFor={selectId} className="sr-only">
        Insert divider line
      </label>
      <select
        id={selectId}
        key={selectKey}
        aria-label="Insert divider line"
        defaultValue=""
        className="max-w-[9.5rem] min-h-9 min-w-0 cursor-pointer rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs font-medium text-[var(--text-primary)] touch-manipulation sm:max-w-none sm:text-sm"
        onChange={(e) => {
          const v = e.target.value as LessonDividerStyle | '';
          if (v === 'thin' || v === 'thick' || v === 'dotted') {
            editor.chain().focus().insertContent({ type: 'horizontalRule', attrs: { dividerStyle: v } }).run();
            setSelectKey((k) => k + 1);
          }
        }}
      >
        <option value="">Divider…</option>
        <option value="thin">Thin line</option>
        <option value="thick">Thick line</option>
        <option value="dotted">Dotted line</option>
      </select>
    </div>
  );
}

function FormatToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-2 py-1.5 sm:px-3"
      role="toolbar"
      aria-label="Text formatting"
    >
      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={17} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={17} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={17} aria-hidden />
      </ToolbarButton>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-color)]" aria-hidden />
      <ToolbarButton
        label={editor.isActive('heading', { level: 2 }) ? 'Normal text' : 'Heading'}
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => {
          if (editor.isActive('heading', { level: 2 })) {
            editor.chain().focus().setParagraph().run();
          } else {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          }
        }}
      >
        <Heading2 size={17} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={17} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={17} aria-hidden />
      </ToolbarButton>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-color)]" aria-hidden />
      <DividerInsertControl editor={editor} />
      <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-color)]" aria-hidden />
      <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <Undo2 size={17} aria-hidden />
      </ToolbarButton>
      <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <Redo2 size={17} aria-hidden />
      </ToolbarButton>
    </div>
  );
}

/**
 * Word-style rich notes: WYSIWYG with a simple formatting toolbar (no Markdown for students).
 */
export function LessonNotesRichEditor({
  lessonId,
  initialHtml,
  onHtmlChange,
  onBlur,
  'aria-label': ariaLabel,
}: LessonNotesRichEditorProps) {
  const editor = useEditor({
    extensions: [
      LessonNotePasteHtml,
      LessonNoteClipboardExport,
      StarterKit.configure({
        heading: { levels: [2] },
        codeBlock: false,
        code: false,
        horizontalRule: false,
        paragraph: false,
        underline: false,
      }),
      LessonNoteParagraph,
      Underline,
      LessonNoteDivider,
      LessonNoteListBehavior,
      LessonNoteOrderedListMerge,
      Placeholder.configure({
        placeholder: ({ editor }) =>
          editor.isEmpty
            ? 'Write your notes here… Tap the buttons above to make text bold, add lists, and more.'
            : '',
      }),
    ],
    content: migrateStoredNoteToHtml(initialHtml),
    editorProps: {
      attributes: {
        class:
          'lesson-notes-editor ProseMirror min-h-[8rem] w-full max-w-full flex-1 select-text px-3 py-3 text-sm leading-relaxed text-[var(--text-primary)] focus:outline-none sm:px-4 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-bold [&_h2]:first:mt-0 [&_p]:mb-2 [&_p]:last:mb-0',
        'aria-label': ariaLabel,
      },
      handleDOMEvents: {
        blur: () => {
          onBlur?.();
          return false;
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      onHtmlChange(normalizeLessonNoteHtmlForSave(ed.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const html = migrateStoredNoteToHtml(initialHtml);
    editor.commands.setContent(html, { emitUpdate: false });
  }, [editor, lessonId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FormatToolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <EditorContent editor={editor} className="h-full min-h-0 [&_.ProseMirror]:min-h-[min(40vh,12rem)]" />
      </div>
    </div>
  );
}
