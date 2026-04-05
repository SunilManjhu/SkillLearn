import { NOTE_TIMESTAMP_REGEX } from './noteTimestampDecorations';

/** First timestamp on a line (same pattern as player / outline parser). */
function firstTimestampOnLine(line: string): RegExpExecArray | null {
  const r = new RegExp(NOTE_TIMESTAMP_REGEX.source, NOTE_TIMESTAMP_REGEX.flags.replace(/g/g, ''));
  return r.exec(line);
}

function countTimestampsOnLine(line: string): number {
  const r = new RegExp(NOTE_TIMESTAMP_REGEX.source, 'g');
  let n = 0;
  while (r.exec(line) !== null) n += 1;
  return n;
}

function mmPartError(minStr: string, secStr: string): string | null {
  const min = parseInt(minStr, 10);
  const sec = parseInt(secStr, 10);
  if (!Number.isFinite(min) || min < 0) return 'Minutes must be a non-negative number.';
  if (!Number.isFinite(sec) || sec < 0 || sec > 59) return 'Seconds must be between 00 and 59.';
  return null;
}

export type VideoOutlineNotesDiagnostic = {
  /** 1-based line number in the textarea (for display). */
  line: number;
  severity: 'error' | 'warn';
  message: string;
};

/**
 * Live checks for author-entered outline text: valid ranges, recognizable format, one timestamp per line.
 * Lines with no parentheses are treated as intro/static copy (no issues).
 */
export function diagnoseVideoOutlineNotes(raw: string): VideoOutlineNotesDiagnostic[] {
  if (!raw) return [];
  const lines = raw.split('\n');
  const out: VideoOutlineNotesDiagnostic[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    const hasParen = line.includes('(');
    const m = firstTimestampOnLine(line);

    if (!m) {
      if (hasParen) {
        out.push({
          line: i + 1,
          severity: 'error',
          message:
            'Timestamp not recognized. Use parentheses and colons exactly like (0:30 - 2:15). Hyphen, en dash (–), or em dash (—) are allowed between times.',
        });
      }
      continue;
    }

    const errA = mmPartError(m[1]!, m[2]!);
    if (errA) {
      out.push({ line: i + 1, severity: 'error', message: `Start time: ${errA}` });
    }

    const hasEnd = m[3] !== undefined && m[4] !== undefined;
    if (hasEnd) {
      const errB = mmPartError(m[3]!, m[4]!);
      if (errB) {
        out.push({ line: i + 1, severity: 'error', message: `End time: ${errB}` });
      }
    } else {
      out.push({
        line: i + 1,
        severity: 'warn',
        message:
          'Use a start and end time (e.g. (1:20 - 2:05)) so the segment matches the video and highlighting is predictable. A single time only gets a short default window.',
      });
    }

    const n = countTimestampsOnLine(line);
    if (n > 1) {
      out.push({
        line: i + 1,
        severity: 'warn',
        message: 'Only the first timestamp on this line is used for seeking. Put other times on separate lines.',
      });
    }
  }

  return out;
}

/** Canonical snippet authors should paste — spaces around dash match the parser. */
export const VIDEO_OUTLINE_TIMESTAMP_RANGE_TEMPLATE = '(0:00 - 0:00)';
