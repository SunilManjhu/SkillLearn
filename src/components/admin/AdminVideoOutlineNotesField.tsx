import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Brackets, Clock } from 'lucide-react';
import {
  VIDEO_OUTLINE_TIMESTAMP_RANGE_TEMPLATE,
  diagnoseVideoOutlineNotes,
} from '../../utils/videoOutlineNotesValidation';

type AdminVideoOutlineNotesFieldProps = {
  value: string;
  onChange: (next: string) => void;
  textareaId: string;
};

/**
 * Catalog editor: live timestamp diagnostics + safe insert templates for video outline notes.
 */
export function AdminVideoOutlineNotesField({ value, onChange, textareaId }: AdminVideoOutlineNotesFieldProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);

  const diagnostics = useMemo(() => diagnoseVideoOutlineNotes(value), [value]);

  useLayoutEffect(() => {
    const el = taRef.current;
    const p = pendingSelectionRef.current;
    if (!el || !p) return;
    pendingSelectionRef.current = null;
    el.focus();
    const len = el.value.length;
    const a = Math.min(Math.max(0, p.start), len);
    const b = Math.min(Math.max(0, p.end), len);
    el.setSelectionRange(a, b);
  }, [value]);

  const insertRangeTemplate = () => {
    const el = taRef.current;
    const v = value;
    const start = el ? el.selectionStart : v.length;
    const end = el ? el.selectionEnd : v.length;
    const insert = VIDEO_OUTLINE_TIMESTAMP_RANGE_TEMPLATE;
    const next = v.slice(0, start) + insert + v.slice(end);
    onChange(next || '');
    // Select first "0:00" inside "(0:00 - 0:00)" for quick overwrite
    const innerStart = start + 1;
    const innerEnd = start + 6;
    pendingSelectionRef.current = { start: innerStart, end: innerEnd };
  };

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warn').length;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--text-secondary)]">Video outline for notes (optional)</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={insertRangeTemplate}
            className="inline-flex min-h-9 touch-manipulation items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] sm:min-h-8 sm:text-xs"
            title={`Insert ${VIDEO_OUTLINE_TIMESTAMP_RANGE_TEMPLATE} at the cursor (first time is selected)`}
          >
            <Clock className="h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden />
            Insert time range
          </button>
          <span className="hidden text-[10px] text-[var(--text-muted)] sm:inline" title="Recommended format">
            <Brackets className="mr-0.5 inline h-3 w-3 align-text-bottom opacity-70" aria-hidden />
            (M:SS - M:SS)
          </span>
        </div>
      </div>
      <textarea
        ref={taRef}
        id={textareaId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        spellCheck={false}
        className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-xs sm:px-3 sm:py-2 sm:text-sm"
        placeholder={
          'Intro line with no timestamp is OK.\n' +
          'For seekable beats, one range per line:\n' +
          'Intro and goals (0:00 - 0:45)\n' +
          'Key formula (1:20 - 2:05)'
        }
        aria-describedby={`${textareaId}-outline-help`}
      />
      <p id={`${textareaId}-outline-help`} className="text-[11px] leading-snug text-[var(--text-muted)]">
        Use parentheses and colons: <code className="rounded bg-[var(--hover-bg)] px-1">(M:SS - M:SS)</code> (hyphen
        or en dash). Learners see text without timestamps; tapping seeks. Single{' '}
        <code className="rounded bg-[var(--hover-bg)] px-1">(M:SS)</code> works but a range is clearer.
      </p>
      {diagnostics.length > 0 ? (
        <ul
          className="max-h-40 space-y-1 overflow-y-auto overscroll-y-contain rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/50 px-2 py-1.5 text-[11px] leading-snug"
          aria-label="Outline timestamp checks"
        >
          {errorCount || warnCount ? (
            <li className="list-none font-semibold text-[var(--text-secondary)]">
              {errorCount > 0 ? (
                <span className="text-red-400">{errorCount} error{errorCount === 1 ? '' : 's'}</span>
              ) : null}
              {errorCount > 0 && warnCount > 0 ? ' · ' : null}
              {warnCount > 0 ? (
                <span className="text-amber-500/90">{warnCount} warning{warnCount === 1 ? '' : 's'}</span>
              ) : null}
            </li>
          ) : null}
          {diagnostics.map((d, idx) => (
            <li
              key={`${d.line}-${idx}`}
              className={`list-none border-l-2 pl-2 ${
                d.severity === 'error' ? 'border-red-500 text-red-300' : 'border-amber-500/80 text-amber-200/90'
              }`}
            >
              <span className="font-mono text-[var(--text-muted)]">L{d.line}:</span> {d.message}
            </li>
          ))}
        </ul>
      ) : value.trim() ? (
        <p className="text-[11px] font-medium text-emerald-500/90">Outline timestamps look consistent.</p>
      ) : null}
    </div>
  );
}
