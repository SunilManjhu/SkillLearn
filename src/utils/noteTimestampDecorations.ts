import type { Node } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * For a single timestamp like `(1:20)` with no end time, highlight this many seconds from that point.
 */
export const NOTE_TIMESTAMP_POINT_DURATION_SEC = 12;

/**
 * Matches `(M:SS)` or `(M:SS - M:SS)` with hyphen, en dash, or em dash. Whitespace tolerant.
 * Does not match hour forms (`1:02:03`) in v1.
 */
export const NOTE_TIMESTAMP_REGEX =
  /\(\s*(\d{1,2}):(\d{2})\s*(?:[-–—]\s*(\d{1,2}):(\d{2}))?\s*\)/g;

/**
 * Comma-separated ranges inside one pair of parentheses, e.g. `(2:55 - 3:05, 4:44 - 5:05)`.
 * Requires at least two `M:SS - M:SS` segments (one comma). Single-range timestamps use {@link NOTE_TIMESTAMP_REGEX}.
 *
 * Structure: `\(\s*((?:pair)(?:\s*,\s*(?:pair))+)\s*\)` — note the `+` repeats (comma + pair), not `pair` alone.
 */
export const NOTE_TIMESTAMP_MULTI_RANGE_REGEX =
  /\(\s*((?:\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2})(?:\s*,\s*(?:\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}))+)\s*\)/g;

/** Parse inner content of a {@link NOTE_TIMESTAMP_MULTI_RANGE_REGEX} match (full string including parens). */
export function parseMultiRangeTimestampSpan(full: string): [string, string, string, string][] | null {
  if (!full.startsWith('(') || !full.endsWith(')')) return null;
  const inner = full.slice(1, -1).trim();
  const parts = inner.split(',').map((p) => p.trim());
  if (parts.length < 2) return null;
  const pairRe = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/;
  const out: [string, string, string, string][] = [];
  for (const p of parts) {
    const m = pairRe.exec(p);
    if (!m) return null;
    out.push([m[1]!, m[2]!, m[3]!, m[4]!]);
  }
  return out;
}

function mmssToSeconds(min: string, sec: string): number {
  return parseInt(min, 10) * 60 + parseInt(sec, 10);
}

/** Start of the innermost textblock (paragraph, heading, etc.) containing `pos`, for line-level highlights. */
function startOfEnclosingTextblock(doc: Node, pos: number): number {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.isTextblock) {
      return $pos.start(d);
    }
  }
  return pos;
}

/**
 * ProseMirror inline decorations for lines whose timestamp range contains `playbackSec`.
 * Highlights from the start of the enclosing paragraph/list line through the closing `)` of the timestamp
 * (e.g. `1. Real vs. Imaginary Numbers (0:43 - 1:45)`).
 * Ranges are inclusive on both ends for explicit `(start - end)` pairs.
 */
export function buildTimestampDecorations(doc: Node, playbackSec: number): DecorationSet {
  if (!Number.isFinite(playbackSec) || playbackSec < 0) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const text = node.text;
    NOTE_TIMESTAMP_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NOTE_TIMESTAMP_REGEX.exec(text)) !== null) {
      const from = pos + m.index;
      let to = from + m[0].length;
      const afterParen = text.slice(m.index + m[0].length);
      const trail = /^:\s*/.exec(afterParen);
      if (trail && !/\n/.test(trail[0])) {
        to += trail[0].length;
      }
      const startSec = mmssToSeconds(m[1], m[2]);
      let endSec: number;
      if (m[3] !== undefined && m[4] !== undefined) {
        endSec = mmssToSeconds(m[3], m[4]);
      } else {
        endSec = startSec + NOTE_TIMESTAMP_POINT_DURATION_SEC;
      }
      const lo = Math.min(startSec, endSec);
      const hi = Math.max(startSec, endSec);
      const inclusiveEnd = m[3] !== undefined && m[4] !== undefined;
      const active = inclusiveEnd
        ? playbackSec >= lo && playbackSec <= hi
        : playbackSec >= lo && playbackSec < hi;
      if (active) {
        const lineFrom = startOfEnclosingTextblock(doc, from);
        decorations.push(
          Decoration.inline(lineFrom, to, {
            class: 'lesson-note-ts-active',
          })
        );
      }
    }

    NOTE_TIMESTAMP_MULTI_RANGE_REGEX.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = NOTE_TIMESTAMP_MULTI_RANGE_REGEX.exec(text)) !== null) {
      const pairs = parseMultiRangeTimestampSpan(mm[0]);
      if (!pairs) continue;
      let active = false;
      for (const [a, b, c, d] of pairs) {
        const s0 = mmssToSeconds(a, b);
        const s1 = mmssToSeconds(c, d);
        const lo = Math.min(s0, s1);
        const hi = Math.max(s0, s1);
        if (playbackSec >= lo && playbackSec <= hi) {
          active = true;
          break;
        }
      }
      if (!active) continue;
      const from = pos + mm.index;
      let to = from + mm[0].length;
      const afterParen = text.slice(mm.index + mm[0].length);
      const trail = /^:\s*/.exec(afterParen);
      if (trail && !/\n/.test(trail[0])) {
        to += trail[0].length;
      }
      const lineFrom = startOfEnclosingTextblock(doc, from);
      decorations.push(
        Decoration.inline(lineFrom, to, {
          class: 'lesson-note-ts-active',
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}
