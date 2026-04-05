import {
  NOTE_TIMESTAMP_MULTI_RANGE_REGEX,
  NOTE_TIMESTAMP_REGEX,
  parseMultiRangeTimestampSpan,
} from './noteTimestampDecorations';
import { leftmostVideoOutlineTimestamp } from './videoOutlineNotes';

const NOTE_TIMESTAMP_REGEX_ONE = new RegExp(
  NOTE_TIMESTAMP_REGEX.source,
  NOTE_TIMESTAMP_REGEX.flags.replace(/g/g, '')
);
const NOTE_TIMESTAMP_MULTI_RANGE_ONE = new RegExp(
  NOTE_TIMESTAMP_MULTI_RANGE_REGEX.source,
  NOTE_TIMESTAMP_MULTI_RANGE_REGEX.flags.replace(/g/g, '')
);

/**
 * True when `(` is followed by something that looks like a time code (not plain words in parens, e.g. "(Redox)").
 */
function lineLooksLikeBrokenTimestamp(line: string): boolean {
  return /\(\s*\d{1,2}:\d{2}/.test(line);
}

const TIMESTAMP_NOT_RECOGNIZED_MESSAGE =
  'Timestamp not recognized. Use parentheses and colons exactly like (0:30 - 2:15). Hyphen, en dash (–), or em dash (—) are allowed between times. For two segments on one line, use a comma inside one pair of parentheses, e.g. (2:55 - 3:05, 4:44 - 5:05).';

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
 * Lines with only normal parentheses (e.g. "(Redox)") are not errors. A line is flagged only if it looks like a
 * broken time stamp: `(` followed by `M:SS`.
 */
export function diagnoseVideoOutlineNotes(raw: string): VideoOutlineNotesDiagnostic[] {
  if (!raw) return [];
  const lines = raw.split('\n');
  const out: VideoOutlineNotesDiagnostic[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    const loc = leftmostVideoOutlineTimestamp(line);

    if (!loc) {
      if (lineLooksLikeBrokenTimestamp(line)) {
        out.push({
          line: i + 1,
          severity: 'error',
          message: TIMESTAMP_NOT_RECOGNIZED_MESSAGE,
        });
      }
      continue;
    }

    if (loc.kind === 'single') {
      const m = line.slice(loc.index).match(NOTE_TIMESTAMP_REGEX_ONE);
      if (!m || m[1] === undefined || m[2] === undefined) {
        if (lineLooksLikeBrokenTimestamp(line)) {
          out.push({
            line: i + 1,
            severity: 'error',
            message: TIMESTAMP_NOT_RECOGNIZED_MESSAGE,
          });
        }
        continue;
      }

      const errA = mmPartError(m[1], m[2]);
      if (errA) {
        out.push({ line: i + 1, severity: 'error', message: `Start time: ${errA}` });
      }

      const hasEnd = m[3] !== undefined && m[4] !== undefined;
      if (hasEnd) {
        const errB = mmPartError(m[3], m[4]);
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
      continue;
    }

    const mm = line.slice(loc.index).match(NOTE_TIMESTAMP_MULTI_RANGE_ONE);
    if (!mm) {
      if (lineLooksLikeBrokenTimestamp(line)) {
        out.push({
          line: i + 1,
          severity: 'error',
          message: TIMESTAMP_NOT_RECOGNIZED_MESSAGE,
        });
      }
      continue;
    }

    const pairs = parseMultiRangeTimestampSpan(mm[0]!);
    if (!pairs?.length) {
      if (lineLooksLikeBrokenTimestamp(line)) {
        out.push({
          line: i + 1,
          severity: 'error',
          message: TIMESTAMP_NOT_RECOGNIZED_MESSAGE,
        });
      }
      continue;
    }

    for (let r = 0; r < pairs.length; r += 1) {
      const [a, b, c, d] = pairs[r]!;
      const errA = mmPartError(a, b);
      if (errA) {
        out.push({
          line: i + 1,
          severity: 'error',
          message: `Range ${r + 1} start: ${errA}`,
        });
      }
      const errB = mmPartError(c, d);
      if (errB) {
        out.push({
          line: i + 1,
          severity: 'error',
          message: `Range ${r + 1} end: ${errB}`,
        });
      }
    }
  }

  return out;
}

/** Canonical snippet authors should paste — spaces around dash match the parser. */
export const VIDEO_OUTLINE_TIMESTAMP_RANGE_TEMPLATE = '(0:00 - 0:00)';

const TIMESTAMP_GLOBAL = new RegExp(NOTE_TIMESTAMP_REGEX.source, 'g');
const MULTI_TIMESTAMP_GLOBAL = new RegExp(NOTE_TIMESTAMP_MULTI_RANGE_REGEX.source, 'g');

/**
 * Split physical lines so each timestamp segment is on its own row:
 * - Multiple `(M:SS …)` on one line → newline before each extra timestamp.
 * - Text after a closing `)` (next sentence / next beat) → newline after that timestamp.
 * Idempotent. Preserves leading indentation on the first fragment of each original line.
 */
export function normalizeVideoOutlineNotesLineBreaks(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const lead = line.match(/^(\s*)/)?.[1] ?? '';
    const body = line.slice(lead.length);
    if (!body.trim()) {
      out.push(line);
      continue;
    }
    const parts = splitOnePhysicalLineForTimestamps(body);
    if (parts.length <= 1) {
      out.push(line);
      continue;
    }
    parts.forEach((p, i) => {
      out.push(i === 0 ? lead + p : p);
    });
  }

  return out.join('\n');
}

function splitOnePhysicalLineForTimestamps(content: string): string[] {
  const line = content.trimEnd();
  if (!line) return [];

  const matchPositions: { index: number; length: number }[] = [];

  MULTI_TIMESTAMP_GLOBAL.lastIndex = 0;
  for (const m of line.matchAll(MULTI_TIMESTAMP_GLOBAL)) {
    if (m.index !== undefined) matchPositions.push({ index: m.index, length: m[0].length });
  }

  TIMESTAMP_GLOBAL.lastIndex = 0;
  for (const m of line.matchAll(TIMESTAMP_GLOBAL)) {
    if (m.index === undefined) continue;
    const insideMulti = matchPositions.some(
      (mp) => m.index! >= mp.index && m.index! + m[0].length <= mp.index + mp.length
    );
    if (!insideMulti) {
      matchPositions.push({ index: m.index, length: m[0].length });
    }
  }

  matchPositions.sort((a, b) => a.index - b.index);

  if (matchPositions.length === 0) return [line];

  if (matchPositions.length >= 2) {
    const splitAt = matchPositions[1]!.index;
    const left = line.slice(0, splitAt).trimEnd();
    const right = line.slice(splitAt).trimStart();
    const a = left ? splitOnePhysicalLineForTimestamps(left) : [];
    const b = right ? splitOnePhysicalLineForTimestamps(right) : [];
    return [...a, ...b];
  }

  const m0 = matchPositions[0]!;
  const end = m0.index + m0.length;
  const after = line.slice(end);
  if (!after.trim()) return [line];

  const left = line.slice(0, end).trimEnd();
  const right = after.trimStart();
  return [...splitOnePhysicalLineForTimestamps(left), ...splitOnePhysicalLineForTimestamps(right)];
}
