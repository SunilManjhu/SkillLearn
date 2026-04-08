import React, { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  ChevronDown,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  List,
  ListOrdered,
  Minus,
  StickyNote,
  Undo2,
  Redo2,
} from 'lucide-react';
import { LessonNoteDivider } from '../extensions/lessonNoteDivider';
import { LessonNoteListBehavior } from '../extensions/lessonNoteListBehavior';
import { LessonNoteOrderedListMerge } from '../extensions/lessonNoteOrderedListMerge';
import { LessonNoteParagraph } from '../extensions/lessonNoteParagraph';
import { LessonNotePasteHtml } from '../extensions/lessonNotePasteHtml';
import { LessonNoteClipboardExport } from '../extensions/lessonNoteClipboardExport';
import {
  LessonNoteTimestampHighlight,
  NOTE_PLAYBACK_TICK_META,
} from '../extensions/lessonNoteTimestampHighlight';
import { migrateStoredNoteToHtml, normalizeLessonNoteHtmlForSave } from '../utils/lessonNoteHtml';

export type LessonNotesRichEditorProps = {
  /** When this changes, editor document is replaced from `initialHtml` (multiple sidebars / edge cases). */
  lessonId: string;
  initialHtml: string;
  onHtmlChange: (html: string) => void;
  onBlur?: () => void;
  /** Current lesson video time (seconds); timestamps in notes like `(1:20)` or `(0:43 - 1:45)` highlight while active. `null` disables. */
  playbackSeconds?: number | null;
  /** Fired when the Write notes disclosure opens or closes (mobile lesson meta visibility). */
  onSectionOpenChange?: (open: boolean) => void;
  /** Desktop (lg+): controlled disclosure; used with accordion against Video outline. */
  desktopOpen?: boolean;
  onDesktopUserSetOpen?: (open: boolean) => void;
  /** Desktop: notes block uses remaining sidebar height when open. */
  desktopFillColumn?: boolean;
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
      className={`inline-flex shrink-0 min-h-9 min-w-9 max-lg:min-h-10 max-lg:min-w-10 items-center justify-center rounded-md touch-manipulation disabled:pointer-events-none disabled:opacity-35 ${
        active
          ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
          : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function FormatToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-2 py-1.5 max-lg:w-full max-lg:flex-nowrap max-lg:justify-between max-lg:gap-0.5 max-lg:overflow-x-auto max-lg:overflow-y-hidden max-lg:overscroll-x-contain max-lg:px-2 max-lg:py-1.5 max-lg:touch-pan-x max-lg:[-ms-overflow-style:none] max-lg:[scrollbar-width:none] max-lg:[&_svg]:h-4 max-lg:[&_svg]:w-4 max-lg:[&::-webkit-scrollbar]:hidden lg:flex-wrap lg:px-3"
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
      <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-color)] max-lg:mx-px" aria-hidden />
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
      <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-color)] max-lg:mx-px" aria-hidden />
      <ToolbarButton
        label="Insert divider line"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={17} aria-hidden />
      </ToolbarButton>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-color)] max-lg:mx-px" aria-hidden />
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
  playbackSeconds = null,
  onSectionOpenChange,
  desktopOpen,
  onDesktopUserSetOpen,
  desktopFillColumn = false,
  'aria-label': ariaLabel,
}: LessonNotesRichEditorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const desktopControlled = typeof onDesktopUserSetOpen === 'function' && typeof desktopOpen === 'boolean';
  const notesSectionOpen = desktopControlled ? desktopOpen : internalOpen;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const playbackSecondsRef = useRef<number | null>(null);
  playbackSecondsRef.current = playbackSeconds ?? null;

  const timestampHighlightExt = useMemo(
    () =>
      LessonNoteTimestampHighlight.configure({
        getPlaybackSeconds: () => playbackSecondsRef.current ?? -1,
      }),
    []
  );

  const editor = useEditor({
    extensions: [
      LessonNotePasteHtml,
      LessonNoteClipboardExport,
      timestampHighlightExt,
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
          'lesson-notes-editor ProseMirror w-full max-w-full min-h-0 flex-1 select-text text-sm leading-relaxed text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] max-lg:min-h-[10rem] max-lg:rounded-xl max-lg:border max-lg:border-[var(--border-color)] max-lg:bg-[var(--bg-primary)] max-lg:p-4 max-lg:text-[15px] max-lg:leading-relaxed lg:min-h-[min(40vh,12rem)] lg:px-4 lg:py-3 xl:min-h-[min(42vh,16rem)] [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-bold [&_h2]:first:mt-0 [&_p]:mb-2 [&_p]:last:mb-0',
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

  useEffect(() => {
    playbackSecondsRef.current = playbackSeconds ?? null;
    if (!editor || editor.isDestroyed) return;
    const { view } = editor;
    view.dispatch(view.state.tr.setMeta(NOTE_PLAYBACK_TICK_META, true));
  }, [editor, playbackSeconds]);

  useEffect(() => {
    onSectionOpenChange?.(notesSectionOpen);
  }, [notesSectionOpen, onSectionOpenChange]);

  useLayoutEffect(() => {
    const el = detailsRef.current;
    if (!el || !desktopControlled) return;
    if (el.open !== notesSectionOpen) el.open = notesSectionOpen;
  }, [notesSectionOpen, desktopControlled]);

  const onNotesDetailsToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (desktopControlled) return;
    setInternalOpen(e.currentTarget.open);
  };

  const onDesktopNotesSummaryClick = (e: React.MouseEvent) => {
    if (!desktopControlled) return;
    e.preventDefault();
    onDesktopUserSetOpen?.(!notesSectionOpen);
  };

  const focusEditorFromShell = (e: React.PointerEvent) => {
    if (!editor || editor.isDestroyed) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.ProseMirror, [contenteditable="true"]')) return;
    if (target.closest('button, select, option, input, textarea, label')) return;
    editor.chain().focus('end').run();
  };

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col max-lg:w-full max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-hidden lg:min-h-0 lg:overflow-hidden ${
        desktopFillColumn ? 'lg:h-full lg:min-h-0 lg:flex-1 lg:flex-col' : 'lg:flex-1'
      }`}
    >
      <details
        ref={detailsRef}
        className={`group min-h-0 min-w-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/80 max-lg:flex max-lg:min-h-0 max-lg:flex-1 max-lg:flex-col max-lg:overflow-hidden max-lg:border-t max-lg:border-[var(--border-color)] max-lg:bg-[var(--bg-secondary)] max-lg:portrait:relative max-lg:portrait:z-0 max-lg:landscape:sticky max-lg:landscape:bottom-0 max-lg:landscape:z-40 max-lg:landscape:shadow-[0_-4px_20px_rgba(0,0,0,0.12)] dark:max-lg:landscape:shadow-[0_-4px_24px_rgba(0,0,0,0.35)] lg:shadow-none ${
          desktopFillColumn
            ? 'lg:grid lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:grid-rows-[auto_minmax(0,1fr)] lg:w-full'
            : 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden'
        }`}
        open={notesSectionOpen}
        onToggle={onNotesDetailsToggle}
      >
        <summary
          className="flex min-h-11 shrink-0 cursor-pointer list-none items-center justify-between gap-2 bg-[var(--bg-secondary)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] touch-manipulation sm:min-h-10 sm:px-4 lg:shrink-0 [&::-webkit-details-marker]:hidden"
          onClick={onDesktopNotesSummaryClick}
        >
          <span className="flex min-w-0 items-center gap-2 text-left leading-snug">
            <StickyNote size={14} className="shrink-0 opacity-80" aria-hidden />
            Write notes
          </span>
          <ChevronDown
            size={18}
            className="shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div
          className={`flex min-h-0 min-w-0 flex-col touch-manipulation max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-hidden lg:min-h-0 lg:flex-col lg:overflow-hidden ${
            desktopFillColumn ? 'lg:row-start-2 lg:h-full lg:max-h-full lg:min-h-0' : 'lg:flex-1'
          }`}
          onPointerDown={focusEditorFromShell}
        >
          <FormatToolbar editor={editor} />
          <div
            className={`min-h-0 min-w-0 max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto max-lg:portrait:overscroll-y-auto max-lg:landscape:overscroll-y-contain max-lg:px-0.5 max-lg:max-h-[min(55dvh,22rem)] lg:min-h-0 lg:max-h-full lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain ${
              desktopFillColumn ? 'lg:[&_.lesson-notes-editor]:!min-h-0 lg:[&_.lesson-notes-editor]:min-h-0' : ''
            }`}
          >
            <EditorContent
              editor={editor}
              className="h-auto min-h-0 w-full max-lg:h-auto [&_.ProseMirror]:pb-6 lg:[&_.ProseMirror]:pb-8"
            />
          </div>
        </div>
      </details>
    </div>
  );
}
