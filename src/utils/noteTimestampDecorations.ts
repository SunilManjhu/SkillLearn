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
  });

  return DecorationSet.create(doc, decorations);
}
