import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Play, StickyNote } from 'lucide-react';
import type { Course, Lesson } from '../data/courses';
import type { LessonProgress } from '../utils/courseProgress';
import { isLessonPlaybackComplete, progressPercent } from '../utils/courseProgress';
import { LessonNotesRichEditor } from './LessonNotesRichEditor';
import { plainFirstLineFromHtml } from '../utils/lessonNoteHtml';

export type CoursePlayerSidebarPanelsProps = {
  course: Course;
  expandedModules: string[];
  onToggleModule: (moduleId: string) => void;
  onSelectLesson: (lesson: Lesson) => void;
  currentLesson: Lesson;
  progressByLesson: Record<string, LessonProgress>;
  lessonDurationLabel: (lesson: Lesson) => string;
  notesExpanded: boolean;
  onNotesExpandedChange: (expanded: boolean) => void;
  /** Live HTML from the rich editor (for collapsed preview). */
  noteText: string;
  /** HTML loaded from storage for this lesson; drives editor mount content when the lesson changes. */
  noteEditorInitialHtml: string;
  /** Remount the rich editor after the panel closes so the next open loads flushed HTML from storage. */
  notesEditorKey: string;
  /** Current lesson id — editor syncs document when this changes. */
  notesLessonId: string;
  onNoteTextChange: (value: string) => void;
  onNoteBlur?: () => void;
  /** After notes are flushed on close; bumps parent key so the editor reloads from disk next time. */
  onNotesPanelClose?: () => void;
  /** Unique id for aria-controls / region (each mounted instance must differ). */
  notesRegionId: string;
};

/**
 * Course outline playlist + collapsible lesson notes. Notes overlay covers the playlist scroll area when expanded.
 */
export function CoursePlayerSidebarPanels({
  course,
  expandedModules,
  onToggleModule,
  onSelectLesson,
  currentLesson,
  progressByLesson,
  lessonDurationLabel,
  notesExpanded,
  onNotesExpandedChange,
  noteText,
  noteEditorInitialHtml,
  notesEditorKey,
  notesLessonId,
  onNoteTextChange,
  onNoteBlur,
  onNotesPanelClose,
  notesRegionId,
}: CoursePlayerSidebarPanelsProps) {
  const previewShort = (() => {
    const plain = plainFirstLineFromHtml(noteText, 72);
    return plain || null;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[var(--border-color)] p-4 sm:p-6">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Course Content</h2>
        <div className="mt-1 text-sm text-[var(--text-secondary)]">
          {course.modules.length} modules •{' '}
          {course.modules.reduce((acc, m) => acc + m.lessons.length, 0)} lessons
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          <div className="divide-y divide-[var(--border-color)]">
            {course.modules.map((module, idx) => (
              <div key={module.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => onToggleModule(module.id)}
                  className="flex min-h-11 items-center justify-between p-4 text-left transition-colors hover:bg-[var(--hover-bg)] touch-manipulation"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-sm text-[var(--text-secondary)]">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 text-sm font-semibold text-[var(--text-primary)]">{module.title}</span>
                  </div>
                  {expandedModules.includes(module.id) ? (
                    <ChevronDown size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                  ) : (
                    <ChevronRight size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                  )}
                </button>

                <AnimatePresence>
                  {expandedModules.includes(module.id) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden bg-black/5"
                    >
                      {module.lessons.map((lesson) => {
                        const pct = progressPercent(progressByLesson[lesson.id]);
                        const done = isLessonPlaybackComplete(progressByLesson[lesson.id]);
                        return (
                          <button
                            key={lesson.id}
                            type="button"
                            onClick={() => onSelectLesson(lesson)}
                            className={`flex w-full min-h-11 flex-col gap-1.5 p-4 pl-12 text-left text-sm transition-colors hover:bg-[var(--hover-bg)] touch-manipulation ${
                              currentLesson.id === lesson.id
                                ? 'bg-orange-500/10 text-orange-500'
                                : 'text-[var(--text-secondary)]'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              {currentLesson.id === lesson.id ? (
                                <Play size={14} fill="currentColor" className="shrink-0" aria-hidden />
                              ) : done ? (
                                <CheckCircle2 size={14} className="shrink-0 text-orange-500/80" aria-hidden />
                              ) : (
                                <CheckCircle2 size={14} className="shrink-0 text-gray-600" aria-hidden />
                              )}
                              <span className="min-w-0 flex-1 truncate font-medium">{lesson.title}</span>
                              <span className="shrink-0 text-xs opacity-60">{lessonDurationLabel(lesson)}</span>
                            </div>
                            <div className="flex w-full items-center gap-2 pl-7">
                              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hover-bg)]">
                                <div
                                  className="h-full rounded-full bg-orange-500 transition-[width] duration-300"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-[var(--text-muted)]">
                                {pct}%
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {notesExpanded ? (
            <motion.div
              key="notes-overlay"
              id={notesRegionId}
              role="region"
              aria-label={`Lesson notes for ${currentLesson.title}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute inset-0 z-10 flex flex-col bg-[var(--bg-secondary)] shadow-[0_-4px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.35)]"
            >
              <button
                type="button"
                aria-expanded={true}
                aria-controls={notesRegionId}
                onClick={() => {
                  onNoteBlur?.();
                  onNotesPanelClose?.();
                  onNotesExpandedChange(false);
                }}
                className="flex w-full shrink-0 min-h-11 touch-manipulation items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2 text-left transition-colors hover:bg-[var(--hover-bg)] sm:min-h-[3.25rem] sm:px-4"
                aria-label={`Collapse notes for ${currentLesson.title}`}
              >
                <StickyNote size={18} className="shrink-0 text-orange-500/90" aria-hidden />
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-[var(--text-primary)]">Notes</span>
                  <p className="truncate text-xs text-[var(--text-muted)]">{currentLesson.title}</p>
                </div>
                <ChevronDown size={22} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
              </button>
              <LessonNotesRichEditor
                key={notesEditorKey}
                lessonId={notesLessonId}
                initialHtml={noteEditorInitialHtml}
                onHtmlChange={onNoteTextChange}
                onBlur={onNoteBlur}
                aria-label={`Notes for ${currentLesson.title}`}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {!notesExpanded ? (
        <>
          <div className="shrink-0 border-t border-[var(--border-color)]" aria-hidden />
          <button
            type="button"
            aria-expanded={false}
            aria-controls={notesRegionId}
            onClick={() => onNotesExpandedChange(true)}
            className="flex w-full min-h-11 touch-manipulation items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--hover-bg)]"
          >
            <StickyNote size={18} className="shrink-0 text-orange-500/90" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-[var(--text-primary)]">Notes</span>
              {previewShort ? (
                <span className="line-clamp-1 text-xs text-[var(--text-muted)]">{previewShort}</span>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">Tap to add notes for this lesson</span>
              )}
            </span>
            <ChevronUp size={20} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}
