import {
  NOTE_TIMESTAMP_POINT_DURATION_SEC,
  NOTE_TIMESTAMP_MULTI_RANGE_REGEX,
  NOTE_TIMESTAMP_REGEX,
  parseMultiRangeTimestampSpan,
} from './noteTimestampDecorations';

function mmssToSeconds(min: string, sec: string): number {
  return parseInt(min, 10) * 60 + parseInt(sec, 10);
}

const NOTE_TIMESTAMP_REGEX_ONE = new RegExp(
  NOTE_TIMESTAMP_REGEX.source,
  NOTE_TIMESTAMP_REGEX.flags.replace(/g/g, '')
);
const NOTE_TIMESTAMP_MULTI_RANGE_ONE = new RegExp(
  NOTE_TIMESTAMP_MULTI_RANGE_REGEX.source,
  NOTE_TIMESTAMP_MULTI_RANGE_REGEX.flags.replace(/g/g, '')
);

/** Leftmost timestamp on the line: single `(…)` or comma-separated ranges in one `(…)`. */
export function leftmostVideoOutlineTimestamp(line: string): { index: number; kind: 'single' | 'multi' } | null {
  const sm = NOTE_TIMESTAMP_REGEX_ONE.exec(line);
  const mm = NOTE_TIMESTAMP_MULTI_RANGE_ONE.exec(line);
  if (!sm && !mm) return null;
  if (!sm) return { index: mm!.index, kind: 'multi' };
  if (!mm) return { index: sm.index, kind: 'single' };
  return sm.index <= mm.index ? { index: sm.index, kind: 'single' } : { index: mm.index, kind: 'multi' };
}

function stripTimestampSpans(line: string): string {
  return line
    .replace(new RegExp(NOTE_TIMESTAMP_MULTI_RANGE_REGEX.source, 'g'), '')
    .replace(new RegExp(NOTE_TIMESTAMP_REGEX.source, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export type VideoOutlineLine = {
  visibleText: string;
  /** Start of the first `(M:SS)` / range on the line; `null` if none. */
  seekStartSeconds: number | null;
  /**
   * Playback windows for highlighting. Multiple segments = OR (e.g. comma-separated ranges in one parenthesis).
   */
  highlight?: Array<{ lo: number; hi: number; inclusiveEnd: boolean }>;
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
    const visibleText = stripTimestampSpans(line);
    if (!visibleText) continue;

    const loc = leftmostVideoOutlineTimestamp(line);
    let seekStartSeconds: number | null = null;
    let highlight: VideoOutlineLine['highlight'];

    if (loc?.kind === 'single') {
      const m = line.slice(loc.index).match(NOTE_TIMESTAMP_REGEX_ONE);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        const startSec = mmssToSeconds(m[1], m[2]);
        seekStartSeconds = startSec;
        if (m[3] !== undefined && m[4] !== undefined) {
          const endSec = mmssToSeconds(m[3], m[4]);
          const lo = Math.min(startSec, endSec);
          const hi = Math.max(startSec, endSec);
          highlight = [{ lo, hi, inclusiveEnd: true }];
        } else {
          const hi = startSec + NOTE_TIMESTAMP_POINT_DURATION_SEC;
          highlight = [{ lo: startSec, hi, inclusiveEnd: false }];
        }
      }
    } else if (loc?.kind === 'multi') {
      const mm = line.slice(loc.index).match(NOTE_TIMESTAMP_MULTI_RANGE_ONE);
      if (mm) {
        const pairs = parseMultiRangeTimestampSpan(mm[0]!);
        if (pairs?.length) {
          const segments: NonNullable<VideoOutlineLine['highlight']> = [];
          for (const [a, b, c, d] of pairs) {
            const s0 = mmssToSeconds(a, b);
            const s1 = mmssToSeconds(c, d);
            const lo = Math.min(s0, s1);
            const hi = Math.max(s0, s1);
            segments.push({ lo, hi, inclusiveEnd: true });
          }
          seekStartSeconds = mmssToSeconds(pairs[0]![0], pairs[0]![1]);
          highlight = segments;
        }
      }
    }

    out.push({ visibleText, seekStartSeconds, highlight });
  }
  return out;
}

/** True when `playbackSec` falls in any of this line’s highlight segments. */
export function isPlaybackInVideoOutlineLine(
  playbackSec: number | null | undefined,
  line: VideoOutlineLine
): boolean {
  const segments = line.highlight;
  if (!segments?.length) return false;
  if (!Number.isFinite(playbackSec) || playbackSec < 0) return false;
  for (const h of segments) {
    const ok = h.inclusiveEnd
      ? playbackSec >= h.lo && playbackSec <= h.hi
      : playbackSec >= h.lo && playbackSec < h.hi;
    if (ok) return true;
  }
  return false;
}

export function formatSecondsAsMmSs(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
