import React, { useEffect, useMemo, useRef } from 'react';
import { ListVideo } from 'lucide-react';
import {
  formatSecondsAsMmSs,
  isPlaybackInVideoOutlineLine,
  parseVideoOutlineNotes,
  type VideoOutlineLine,
} from '../utils/videoOutlineNotes';

export type LessonVideoOutlineNotesProps = {
  text: string;
  onSeekSeconds: (seconds: number) => void;
  /** When false, timestamp lines render as static text (no seek). */
  seekEnabled: boolean;
  /** Current video time for highlighting while a line’s range is active; `null` disables. */
  playbackSeconds?: number | null;
};

function OutlineRow({
  line,
  seekEnabled,
  onSeekSeconds,
  playbackSeconds,
}: {
  line: VideoOutlineLine;
  seekEnabled: boolean;
  onSeekSeconds: (seconds: number) => void;
  playbackSeconds: number | null;
}) {
  const inRange = isPlaybackInVideoOutlineLine(playbackSeconds, line);
  const activeRing = inRange ? ' ring-1 ring-orange-400/50 ring-inset' : '';
  const activeText =
    inRange && line.highlight
      ? ' font-medium text-orange-600 dark:text-orange-400'
      : '';

  const canSeek = seekEnabled && line.seekStartSeconds !== null;
  if (canSeek && line.seekStartSeconds !== null) {
    const sec = line.seekStartSeconds;
    return (
      <li className="list-none scroll-my-2">
        <button
          type="button"
          onClick={() => onSeekSeconds(sec)}
          aria-current={inRange ? 'true' : undefined}
          data-outline-active={inRange ? 'true' : undefined}
          className={`w-full min-h-11 touch-manipulation rounded-lg px-2 py-2 text-left text-sm leading-snug text-[var(--text-primary)] transition-colors hover:bg-[var(--hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 sm:min-h-10 sm:px-2.5${activeRing}${activeText}`}
          aria-label={`Jump to ${formatSecondsAsMmSs(sec)}: ${line.visibleText}`}
        >
          {line.visibleText}
        </button>
      </li>
    );
  }
  return (
    <li
      className={`list-none scroll-my-2 px-2 py-2 text-sm leading-snug text-[var(--text-secondary)] sm:px-2.5${activeText}`}
      aria-current={inRange ? 'true' : undefined}
      data-outline-active={inRange ? 'true' : undefined}
    >
      {line.visibleText}
    </li>
  );
}

/**
 * Instructor-authored outline: timestamps are hidden; lines with a timestamp are tappable to seek.
 */
export function LessonVideoOutlineNotes({
  text,
  onSeekSeconds,
  seekEnabled,
  playbackSeconds = null,
}: LessonVideoOutlineNotesProps) {
  const lines = useMemo(() => parseVideoOutlineNotes(text), [text]);
  const listRef = useRef<HTMLUListElement>(null);

  const pb = Number.isFinite(playbackSeconds) && playbackSeconds >= 0 ? playbackSeconds : null;

  const activeLineIndex = useMemo(() => {
    if (pb === null) return -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (isPlaybackInVideoOutlineLine(pb, lines[i]!)) return i;
    }
    return -1;
  }, [lines, pb]);

  useEffect(() => {
    if (activeLineIndex < 0) return;
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-outline-active="true"]');
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeLineIndex]);

  if (lines.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/80">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] sm:px-4">
        <ListVideo size={14} className="shrink-0 opacity-80" aria-hidden />
        <span>Video outline</span>
      </div>
      <ul
        ref={listRef}
        className="max-h-[min(36vh,11rem)] space-y-0 overflow-y-auto overscroll-y-contain px-1 pb-2 sm:max-h-[min(40vh,12rem)]"
      >
        {lines.map((line, i) => (
          <OutlineRow
            key={i}
            line={line}
            seekEnabled={seekEnabled}
            onSeekSeconds={onSeekSeconds}
            playbackSeconds={pb}
          />
        ))}
      </ul>
    </div>
  );
}
