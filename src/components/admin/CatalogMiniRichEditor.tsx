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
          ? 'bg-[#616161]/15 text-[#393a3a] app-dark:text-[#cfcfcf]'
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
      className="absolute bottom-full left-0 right-0 z-[60] mb-0.5 hidden flex-wrap items-center justify-start gap-0.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 py-0.5 shadow-lg group-focus-within/catalog-mini-rich:flex"
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
  /** Merged onto the outer shell (e.g. `h-full min-h-0` beside a matched-height textarea). */
  className?: string;
};

export function CatalogMiniRichEditor({
  id,
  value,
  onChange,
  'aria-label': ariaLabel,
  variant,
  error,
  placeholder = '',
  className,
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
            ? 'catalog-mini-rich ProseMirror flex min-h-0 w-full min-w-0 flex-1 items-center px-2 py-0 text-sm font-semibold leading-none outline-none focus:outline-none [&_p]:m-0 [&_p]:flex [&_p]:min-h-0 [&_p]:flex-1 [&_p]:items-center [&_p]:leading-none [&_p]:pb-0 [&_p_br]:m-0 [&_p_br]:block [&_p_br]:h-0 [&_p_br]:leading-none [&_p_br]:overflow-hidden'
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

  const borderClass = error ? 'border-[#616161]' : 'border-[var(--border-color)]';

  return (
    <div
      id={id}
      data-catalog-mini-rich
      className={`group/catalog-mini-rich relative z-0 min-w-0 w-full overflow-visible rounded-md border bg-[var(--bg-primary)] ${borderClass}${className ? ` ${className}` : ''}`}
    >
      <MiniToolbar editor={editor} />
      {variant === 'title' ? (
        <div className="flex min-h-11 min-w-0 items-stretch overflow-hidden rounded-md sm:min-h-7">
          <EditorContent
            editor={editor}
            className="flex min-h-0 min-w-0 flex-1 [&_.tiptap]:flex [&_.tiptap]:min-h-0 [&_.tiptap]:flex-1 [&_.tiptap]:items-stretch"
          />
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md">
          <EditorContent editor={editor} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain" />
        </div>
      )}
    </div>
  );
}
