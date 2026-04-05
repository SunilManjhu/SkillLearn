import React from 'react';
import { ClipboardList, ExternalLink, Globe, Video } from 'lucide-react';
import type { Lesson } from '../../data/courses';
import { YoutubeUrlPreviewEmbed } from '../YoutubeUrlPreviewEmbed';
import { youtubeVideoIdFromUrl } from '../../utils/youtube';
import { lessonWebHref, lessonQuizDefinition } from '../../utils/lessonContent';

/**
 * Compact “live preview” for catalog lesson editing (video embed, external URL, quiz summary).
 * Styled like a small phone-style frame, similar to home hero phone ads preview.
 */
export function AdminLessonContentPreview({ lesson }: { lesson: Lesson }) {
  const isVideo = lesson.contentKind !== 'web' && lesson.contentKind !== 'quiz';
  const webHref = lesson.contentKind === 'web' ? lessonWebHref(lesson) : null;
  const quizDef = lesson.contentKind === 'quiz' ? lessonQuizDefinition(lesson) : null;
  const videoId = isVideo ? youtubeVideoIdFromUrl(lesson.videoUrl ?? '') : null;

  return (
    <div
      className="mx-auto w-full max-w-[16rem] rounded-[1.35rem] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 shadow-[0_8px_28px_rgba(0,0,0,0.18)] sm:max-w-[17.5rem] lg:mx-0 lg:max-w-none"
      aria-label="Lesson content preview"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Preview</span>
        <span className="h-1 w-8 shrink-0 rounded-full bg-[var(--border-color)]/80" aria-hidden />
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border-color)]/80 bg-black/40">
        {isVideo ? (
          videoId ? (
            <YoutubeUrlPreviewEmbed
              url={lesson.videoUrl}
              title="Lesson video preview"
              className="!aspect-video !rounded-none !border-0"
            />
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-[var(--bg-primary)] px-3 text-center">
              <Video className="h-8 w-8 text-[var(--text-muted)]" aria-hidden />
              <p className="text-[11px] leading-snug text-[var(--text-muted)]">Add a valid YouTube URL to see the embed.</p>
            </div>
          )
        ) : lesson.contentKind === 'web' ? (
          webHref ? (
            <div className="flex min-h-[11rem] flex-col bg-[var(--bg-primary)]">
              <div className="flex items-center gap-2 border-b border-[var(--border-color)]/60 px-2 py-1.5">
                <Globe className="h-3.5 w-3.5 shrink-0 text-orange-500/90" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-[var(--text-secondary)]" title={webHref}>
                  {webHref}
                </span>
                <a
                  href={webHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-semibold text-orange-500 hover:bg-orange-500/10"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Open
                </a>
              </div>
              <iframe
                src={webHref}
                title="External page preview"
                className="min-h-[9.5rem] w-full flex-1 border-0 bg-white"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              />
              <p className="border-t border-[var(--border-color)]/50 px-2 py-1 text-[9px] leading-snug text-[var(--text-muted)]">
                Some sites block embedding; learners still open the full page in the player.
              </p>
            </div>
          ) : (
            <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-[var(--bg-primary)] px-3 text-center">
              <Globe className="h-8 w-8 text-[var(--text-muted)]" aria-hidden />
              <p className="text-[11px] leading-snug text-[var(--text-muted)]">Enter a valid https URL for a live frame preview.</p>
            </div>
          )
        ) : (
          <div className="min-h-[11rem] bg-[var(--bg-primary)] px-2.5 py-2">
            {quizDef && quizDef.questions.length > 0 ? (
              <>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-primary)]">
                  <ClipboardList className="h-3.5 w-3.5 text-orange-500" aria-hidden />
                  Quiz · {quizDef.questions.length} question{quizDef.questions.length === 1 ? '' : 's'}
                </div>
                <ul className="space-y-1.5">
                  {quizDef.questions.slice(0, 4).map((q, i) => (
                    <li
                      key={q.id || i}
                      className="rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-secondary)]/80 px-2 py-1.5"
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                        {q.type === 'mcq' ? 'Multiple choice' : 'Open-ended'}
                      </span>
                      <p className="mt-0.5 line-clamp-3 text-[10px] leading-snug text-[var(--text-secondary)]">
                        {q.prompt.trim() || '(No prompt yet)'}
                      </p>
                    </li>
                  ))}
                </ul>
                {quizDef.questions.length > 4 ? (
                  <p className="mt-2 text-[9px] text-[var(--text-muted)]">+ {quizDef.questions.length - 4} more…</p>
                ) : null}
              </>
            ) : (
              <div className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-2 px-2 text-center">
                <ClipboardList className="h-8 w-8 text-[var(--text-muted)]" aria-hidden />
                <p className="text-[11px] leading-snug text-[var(--text-muted)]">Add questions to preview the quiz structure.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
