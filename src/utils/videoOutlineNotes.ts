import {
  NOTE_TIMESTAMP_POINT_DURATION_SEC,
  NOTE_TIMESTAMP_REGEX,
} from './noteTimestampDecorations';

function mmssToSeconds(min: string, sec: string): number {
  return parseInt(min, 10) * 60 + parseInt(sec, 10);
}

function firstTimestampInLine(line: string): RegExpExecArray | null {
  const r = new RegExp(NOTE_TIMESTAMP_REGEX.source, NOTE_TIMESTAMP_REGEX.flags);
  return r.exec(line);
}

function stripTimestampSpans(line: string): string {
  return line
    .replace(new RegExp(NOTE_TIMESTAMP_REGEX.source, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export type VideoOutlineLine = {
  visibleText: string;
  /** Start of the first `(M:SS)` / `(M:SS - M:SS)` on the line; `null` if none. */
  seekStartSeconds: number | null;
  /**
   * When the line has a timestamp, the playback window for highlighting (same rules as lesson note timestamps).
   */
  highlight?: { lo: number; hi: number; inclusiveEnd: boolean };
};

/**
 * One entry per non-empty source line. Timestamps are stripped from `visibleText`;
 * `seekStartSeconds` is taken from the first timestamp on that line.
 */
export function parseVideoOutlineNotes(raw: string): VideoOutlineLine[] {
  if (!raw || !raw.trim()) return [];
  const out: VideoOutlineLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const m = firstTimestampInLine(line);
    const visibleText = stripTimestampSpans(line);
    if (!visibleText) continue;
    let seekStartSeconds: number | null = null;
    let highlight: VideoOutlineLine['highlight'];
    if (m && m[1] !== undefined && m[2] !== undefined) {
      const startSec = mmssToSeconds(m[1], m[2]);
      seekStartSeconds = startSec;
      if (m[3] !== undefined && m[4] !== undefined) {
        const endSec = mmssToSeconds(m[3], m[4]);
        const lo = Math.min(startSec, endSec);
        const hi = Math.max(startSec, endSec);
        highlight = { lo, hi, inclusiveEnd: true };
      } else {
        const hi = startSec + NOTE_TIMESTAMP_POINT_DURATION_SEC;
        highlight = { lo: startSec, hi, inclusiveEnd: false };
      }
    }
    out.push({ visibleText, seekStartSeconds, highlight });
  }
  return out;
}

/** True when `playbackSec` falls in this line’s timestamp range (point spans use the same duration as note highlights). */
export function isPlaybackInVideoOutlineLine(
  playbackSec: number | null | undefined,
  line: VideoOutlineLine
): boolean {
  const h = line.highlight;
  if (!h) return false;
  if (!Number.isFinite(playbackSec) || playbackSec < 0) return false;
  return h.inclusiveEnd
    ? playbackSec >= h.lo && playbackSec <= h.hi
    : playbackSec >= h.lo && playbackSec < h.hi;
}

export function formatSecondsAsMmSs(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
