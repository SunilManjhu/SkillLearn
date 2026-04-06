import React, { useCallback, useLayoutEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ChevronDown, ChevronRight, Play, StickyNote } from 'lucide-react';
import type { Course, Lesson } from '../data/courses';
import type { LessonProgress } from '../utils/courseProgress';
import { isLessonPlaybackComplete, progressPercent } from '../utils/courseProgress';
import { LessonNotesRichEditor } from './LessonNotesRichEditor';
import { LessonVideoOutlineNotes } from './LessonVideoOutlineNotes';

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
  /** Video time (seconds) for highlighting `(M:SS)` / `(M:SS - M:SS)` in notes; `null` when no seekable video. */
  notesPlaybackSeconds?: number | null;
  /** Seek embedded video (YouTube or native) when the learner taps an outline line. */
  onVideoSeekSeconds?: (seconds: number) => void;
  /** Mobile: notify when video outline disclosure opens/closes (CoursePlayer hides lesson meta). */
  onVideoOutlineOpenChange?: (open: boolean) => void;
  /** Mobile: notify when Write notes disclosure opens/closes (CoursePlayer hides lesson meta). */
  onWriteNotesOpenChange?: (open: boolean) => void;
};

/**
 * Course outline playlist + lesson notes. Header tabs switch between content and notes; notes overlay covers the playlist when Notes is selected.
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
  noteText: _noteText,
  noteEditorInitialHtml,
  notesEditorKey,
  notesLessonId,
  onNoteTextChange,
  onNoteBlur,
  onNotesPanelClose,
  notesRegionId,
  notesPlaybackSeconds = null,
  onVideoSeekSeconds,
  onVideoOutlineOpenChange,
  onWriteNotesOpenChange,
}: CoursePlayerSidebarPanelsProps) {
  const [isLgViewport, setIsLgViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsLgViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /** Desktop: accordion when opening one disclosure; playback can still auto-expand outline while notes stay open. */
  const [lgOutlineOpen, setLgOutlineOpen] = useState(false);
  const [lgNotesOpen, setLgNotesOpen] = useState(false);

  useLayoutEffect(() => {
    setLgOutlineOpen(false);
    setLgNotesOpen(false);
  }, [currentLesson.id]);

  const handleDesktopOutlineUserSetOpen = useCallback((open: boolean) => {
    setLgOutlineOpen(open);
    if (open) setLgNotesOpen(false);
  }, []);

  const handleDesktopNotesUserSetOpen = useCallback((open: boolean) => {
    setLgNotesOpen(open);
    if (open) setLgOutlineOpen(false);
  }, []);

  const handleDesktopAutoExpandOutline = useCallback(() => {
    setLgOutlineOpen(true);
  }, []);

  const hasVideoOutline =
    Boolean(currentLesson.videoOutlineNotes?.trim()) &&
    currentLesson.contentKind !== 'web' &&
    currentLesson.contentKind !== 'quiz';

  const outlineDesktopFill = Boolean(isLgViewport && hasVideoOutline && lgOutlineOpen);
  const notesDesktopFill = Boolean(isLgViewport && lgNotesOpen);

  const openNotes = () => onNotesExpandedChange(true);
  const closeNotes = () => {
    onNoteBlur?.();
    onNotesPanelClose?.();
    onNotesExpandedChange(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col max-lg:min-h-0 max-lg:portrait:h-auto max-lg:landscape:h-full">
      <div className="shrink-0 space-y-2 border-b border-[var(--border-color)] px-3 py-3 sm:space-y-2.5 sm:px-4 sm:py-4">
        <div
          className="flex rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-1 dark:bg-black/20"
          role="tablist"
          aria-label="Sidebar view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!notesExpanded}
            onClick={() => {
              if (notesExpanded) closeNotes();
            }}
            className={`flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors sm:min-h-10 sm:px-3 ${
              !notesExpanded
                ? 'bg-[var(--bg-secondary)] text-orange-600 shadow-sm dark:text-orange-400'
                : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span className="truncate">Course content</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={notesExpanded}
            aria-controls={notesRegionId}
            id={`${notesRegionId}-tab`}
            onClick={() => {
              if (!notesExpanded) openNotes();
            }}
            className={`flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors sm:min-h-10 sm:px-3 ${
              notesExpanded
                ? 'bg-[var(--bg-secondary)] text-orange-600 shadow-sm dark:text-orange-400'
                : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
            }`}
          >
            <StickyNote size={16} className="shrink-0 opacity-90" aria-hidden />
            <span className="truncate">Notes</span>
          </button>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          {notesExpanded ? (
            <span className="line-clamp-2 font-medium text-[var(--text-primary)]">{currentLesson.title}</span>
          ) : (
            <>
              {course.modules.length} modules •{' '}
              {course.modules.reduce((acc, m) => acc + m.lessons.length, 0)} lessons
            </>
          )}
        </p>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col max-lg:min-h-0 max-lg:portrait:flex-none max-lg:portrait:w-full max-lg:portrait:overflow-visible">
        {/* Desktop: playlist stays mounted under the overlay. Mobile: hide when Notes is open so notes use real flex height (absolute overlay had 0-height parent). */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain max-lg:min-h-[max(10rem,min(26dvh,14rem))] ${
            notesExpanded ? 'max-lg:hidden' : ''
          }`}
        >
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
                        if (lesson.contentKind === 'divider') {
                          return (
                            <div
                              key={lesson.id}
                              role="presentation"
                              className="border-t border-[var(--border-color)]/60 px-4 py-2.5 pl-12 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                            >
                              {lesson.title.trim() || 'Section'}
                            </div>
                          );
                        }
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
              role="tabpanel"
              aria-labelledby={`${notesRegionId}-tab`}
              aria-label={`Lesson notes for ${currentLesson.title}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="z-10 flex min-h-0 min-w-0 flex-col bg-[var(--bg-secondary)] max-lg:flex-none max-lg:min-h-0 max-lg:landscape:flex-1 max-lg:landscape:min-h-0 max-lg:landscape:overflow-y-auto max-lg:landscape:overscroll-y-contain max-lg:portrait:overflow-visible max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] lg:absolute lg:inset-0 lg:overflow-hidden lg:shadow-[0_-4px_24px_rgba(0,0,0,0.12)] dark:lg:shadow-[0_-4px_24px_rgba(0,0,0,0.35)]"
            >
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-lg:flex-none max-lg:overflow-visible max-lg:portrait:overflow-visible max-lg:landscape:min-h-0 max-lg:landscape:flex-1 max-lg:landscape:overflow-hidden lg:min-h-0">
                {hasVideoOutline ? (
                  <LessonVideoOutlineNotes
                    text={currentLesson.videoOutlineNotes!}
                    seekEnabled={typeof onVideoSeekSeconds === 'function'}
                    onSeekSeconds={(sec) => onVideoSeekSeconds?.(sec)}
                    playbackSeconds={notesPlaybackSeconds}
                    onOpenChange={isLgViewport ? undefined : onVideoOutlineOpenChange}
                    {...(isLgViewport
                      ? {
                          desktopOpen: lgOutlineOpen,
                          onDesktopUserSetOpen: handleDesktopOutlineUserSetOpen,
                          onDesktopAutoExpandOutline: handleDesktopAutoExpandOutline,
                          desktopFillColumn: outlineDesktopFill,
                        }
                      : {})}
                  />
                ) : null}
                <div
                  className={`min-h-0 flex-1 max-lg:portrait:flex-none max-lg:landscape:min-h-0 max-lg:landscape:flex-1 max-lg:shrink-0 max-lg:self-stretch max-lg:relative max-lg:z-0 ${
                    isLgViewport
                      ? lgNotesOpen
                        ? 'lg:min-h-0 lg:flex-1'
                        : 'lg:shrink-0 lg:flex-none'
                      : 'lg:flex-1'
                  }`}
                >
                  <LessonNotesRichEditor
                    key={notesEditorKey}
                    lessonId={notesLessonId}
                    initialHtml={noteEditorInitialHtml}
                    onHtmlChange={onNoteTextChange}
                    onBlur={onNoteBlur}
                    playbackSeconds={notesPlaybackSeconds}
                    aria-label={`Notes for ${currentLesson.title}`}
                    onSectionOpenChange={onWriteNotesOpenChange}
                    {...(isLgViewport
                      ? {
                          desktopOpen: lgNotesOpen,
                          onDesktopUserSetOpen: handleDesktopNotesUserSetOpen,
                          desktopFillColumn: notesDesktopFill,
                        }
                      : {})}
                  />
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
