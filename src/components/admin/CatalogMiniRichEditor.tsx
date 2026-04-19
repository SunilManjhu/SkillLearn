import React, { useEffect, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Undo2,
  Redo2,
} from 'lucide-react';
import { LessonNoteParagraph } from '../../extensions/lessonNoteParagraph';
import { LessonNotePasteHtml } from '../../extensions/lessonNotePasteHtml';
import {
  catalogMiniRichEditorContent,
  normalizeCatalogMiniRichForSave,
} from '../../utils/catalogMiniRichHtml';

function MiniToolbarBtn({
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
      className={`inline-flex shrink-0 min-h-8 min-w-8 items-center justify-center rounded-md touch-manipulation disabled:pointer-events-none disabled:opacity-35 ${
        active
          ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
          : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function MiniToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-[var(--border-color)]/80 bg-[var(--bg-primary)]/50 px-1 py-0.5"
      role="toolbar"
      aria-label="Text formatting"
    >
      <MiniToolbarBtn
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} aria-hidden />
      </MiniToolbarBtn>
      <MiniToolbarBtn
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} aria-hidden />
      </MiniToolbarBtn>
      <MiniToolbarBtn
        label="Underline"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={15} aria-hidden />
      </MiniToolbarBtn>
      <MiniToolbarBtn
        label="Subscript"
        active={editor.isActive('subscript')}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <SubscriptIcon size={15} aria-hidden />
      </MiniToolbarBtn>
      <MiniToolbarBtn
        label="Superscript"
        active={editor.isActive('superscript')}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <SuperscriptIcon size={15} aria-hidden />
      </MiniToolbarBtn>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--border-color)]" aria-hidden />
      <MiniToolbarBtn label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <Undo2 size={15} aria-hidden />
      </MiniToolbarBtn>
      <MiniToolbarBtn label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <Redo2 size={15} aria-hidden />
      </MiniToolbarBtn>
    </div>
  );
}

export type CatalogMiniRichEditorProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  'aria-label': string;
  variant: 'title' | 'multiline';
  error?: boolean;
  placeholder?: string;
};

export function CatalogMiniRichEditor({
  id,
  value,
  onChange,
  'aria-label': ariaLabel,
  variant,
  error,
  placeholder = '',
}: CatalogMiniRichEditorProps) {
  const editor = useEditor({
    extensions: [
      LessonNotePasteHtml,
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        link: false,
        paragraph: false,
        underline: false,
      }),
      LessonNoteParagraph,
      Underline,
      Subscript.extend({ excludes: 'superscript' }),
      Superscript.extend({ excludes: 'subscript' }),
      ...(placeholder
        ? [
            Placeholder.configure({
              placeholder,
            }),
          ]
        : []),
    ],
    content: catalogMiniRichEditorContent(value),
    editorProps: {
      attributes: {
        class:
          variant === 'title'
            ? 'catalog-mini-rich ProseMirror min-h-9 w-full max-w-full px-2 py-1.5 text-sm font-semibold leading-snug outline-none focus:outline-none [&_p]:m-0 [&_p]:inline [&_p]:leading-snug'
            : 'catalog-mini-rich ProseMirror min-h-[4.5rem] w-full max-w-full px-2.5 py-1.5 text-sm leading-relaxed outline-none focus:outline-none sm:px-3 sm:py-2 [&_p]:my-1 [&_p]:first:mt-0 [&_p]:last:mb-0',
        'aria-label': ariaLabel,
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(normalizeCatalogMiniRichForSave(ed.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = normalizeCatalogMiniRichForSave(catalogMiniRichEditorContent(value));
    const current = normalizeCatalogMiniRichForSave(editor.getHTML());
    if (incoming === current) return;
    editor.commands.setContent(catalogMiniRichEditorContent(value), { emitUpdate: false });
  }, [editor, value]);

  const borderClass = error ? 'border-red-500' : 'border-[var(--border-color)]';

  return (
    <div
      id={id}
      data-catalog-mini-rich
      className={`min-w-0 w-full overflow-hidden rounded-md border bg-[var(--bg-primary)] ${borderClass}`}
    >
      <MiniToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
