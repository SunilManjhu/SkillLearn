import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { CUSTOM_LISTBOX_LOADING, CUSTOM_LISTBOX_OPTION_SINGLE, CUSTOM_LISTBOX_PANEL } from '../../ui/customMenuClasses';
import { computeAdminListboxPanelStyle } from './adminListboxPanelStyle';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

function includesCI(haystack: string, needle: string): boolean {
  return lower(haystack).includes(lower(needle));
}

export type AdminSmartMultiselectProps = {
  /** Used to connect input + listbox ids for a11y. */
  id: string;
  /** All available options (the dropdown will filter as you type). */
  options: readonly string[];
  /** Current selections, shown as inline pills. */
  value: readonly string[];
  /** Add a label (existing or custom). */
  onAdd: (label: string) => void;
  /** Remove a selected label. */
  onRemove: (label: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** When open but no matches. */
  emptyMessage?: string;
  /** When false, disallow creating new labels (picker-only). */
  allowCustom?: boolean;
  /** Close the dropdown after selecting an option. Defaults to false for multi-add workflows. */
  closeOnSelect?: boolean;
  /** Fires when focus leaves the trigger and does not move into the portaled listbox. */
  onTriggerBlur?: () => void;
  /** Accessible name when there is no visible text label. */
  'aria-label'?: string;
};

type Row =
  | { kind: 'add'; label: string }
  | { kind: 'existing'; label: string };

export function AdminSmartMultiselect({
  id,
  options,
  value,
  onAdd,
  onRemove,
  disabled = false,
  placeholder = 'Search or add custom…',
  emptyMessage = 'No matches.',
  allowCustom = true,
  closeOnSelect = false,
  onTriggerBlur,
  'aria-label': ariaLabel,
}: AdminSmartMultiselectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Keyboard highlight in the list (`null` = typing mode). */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedLower = useMemo(() => new Set(value.map((x) => lower(x))), [value]);
  const queryTrimmed = query.trim();
  const queryLower = lower(queryTrimmed);

  const filtered = useMemo(() => {
    const base = options.filter((x) => !selectedLower.has(lower(x)));
    if (!queryTrimmed) return base;
    return base.filter((x) => includesCI(x, queryTrimmed));
  }, [options, selectedLower, queryTrimmed]);

  const queryMatchesExistingExact = useMemo(() => {
    if (!queryTrimmed) return false;
    return options.some((x) => lower(x) === queryLower);
  }, [options, queryTrimmed, queryLower]);

  const canAddCustom =
    allowCustom && queryTrimmed.length > 0 && !queryMatchesExistingExact && !selectedLower.has(queryLower);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (canAddCustom) out.push({ kind: 'add', label: queryTrimmed });
    for (const x of filtered) out.push({ kind: 'existing', label: x });
    return out;
  }, [canAddCustom, queryTrimmed, filtered]);

  useLayoutEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const uniqueInlineSuffix = useMemo(() => {
    if (!open || !queryTrimmed || filtered.length !== 1) return null;
    const only = filtered[0]!;
    // If query is a case-insensitive prefix, show the remaining suffix.
    let i = 0;
    while (i < queryTrimmed.length && i < only.length && queryTrimmed[i]!.toLowerCase() === only[i]!.toLowerCase()) i++;
    if (i === queryTrimmed.length) {
      const rest = only.slice(queryTrimmed.length);
      return rest.length > 0 ? rest : null;
    }
    // Otherwise show a hint of the unique match.
    return ` → ${only}`;
  }, [open, queryTrimmed, filtered]);

  useEffect(() => {
    if (activeIndex === null) return;
    if (rows.length === 0) {
      setActiveIndex(null);
      return;
    }
    setActiveIndex((i) => (i === null ? null : Math.min(i, rows.length - 1)));
  }, [rows.length, activeIndex]);

  const reposition = useCallback(() => {
    const t = triggerRef.current;
    if (!t || !open) return;
    setPanelStyle(computeAdminListboxPanelStyle(t.getBoundingClientRect(), { minPanelWidth: 0 }));
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = triggerRef.current;
      const p = panelRef.current;
      const node = e.target as Node;
      if (t?.contains(node) || p?.contains(node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const commitAdd = useCallback(
    (label: string) => {
      const t = label.trim();
      if (!t) return;
      if (!allowCustom) {
        const exists = options.some((x) => lower(x) === lower(t));
        if (!exists) return;
      }
      const scrollTopBefore = panelRef.current?.scrollTop ?? null;
      onAdd(t);
      if (closeOnSelect) setOpen(false);
      else setOpen(true);
      // Multi-select UX: keep the query so the list doesn’t jump to top/reset.
      if (closeOnSelect) setQuery('');
      setActiveIndex((i) => i);
      // Keep focus on the control so repeated additions are quick on mobile.
      requestAnimationFrame(() => {
        // Preserve scroll position across rerenders (selected row removed).
        if (scrollTopBefore != null && panelRef.current) {
          panelRef.current.scrollTop = scrollTopBefore;
        }
        inputRef.current?.focus();
      });
    },
    [allowCustom, closeOnSelect, onAdd, options]
  );

  const pickHighlightedOrUnique = useCallback(() => {
    if (!open) return false;
    const hi = activeIndexRef.current;
    if (hi !== null && hi >= 0 && hi < rows.length) {
      const r = rows[hi]!;
      if (r.kind === 'existing') {
        commitAdd(r.label);
        return true;
      }
    }
    if (filtered.length === 1) {
      commitAdd(filtered[0]!);
      return true;
    }
    return false;
  }, [open, rows, filtered, canAddCustom, commitAdd]);

  const commitPrimary = useCallback(() => {
    if (disabled) return;
    if (pickHighlightedOrUnique()) return;
    const first = filtered[0];
    if (first) commitAdd(first);
  }, [disabled, pickHighlightedOrUnique, commitAdd, filtered]);

  const panel =
    open && panelStyle
      ? createPortal(
          <div
            ref={panelRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className={CUSTOM_LISTBOX_PANEL}
            style={panelStyle}
          >
            {rows.length === 0 ? (
              <p className={CUSTOM_LISTBOX_LOADING}>{emptyMessage}</p>
            ) : (
              rows.map((row, idx) => (
                <button
                  key={`${row.kind}:${lower(row.label)}`}
                  type="button"
                  role="option"
                  id={`${id}-opt-${idx}`}
                  aria-selected={activeIndex === idx}
                  className={`${CUSTOM_LISTBOX_OPTION_SINGLE} ${
                    row.kind === 'add' ? 'font-medium' : ''
                  } ${activeIndex === idx ? 'bg-[var(--hover-bg)] ring-2 ring-inset ring-[#a1a2a2]/45' : ''}`}
                  onClick={() => commitAdd(row.label)}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  {row.kind === 'add' ? (
                    <span className="min-w-0 flex-1 truncate">
                      Add “{row.label}” as new
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  )}
                  {row.kind === 'add' ? <Plus size={16} className="shrink-0 opacity-80" aria-hidden /> : null}
                </button>
              ))
            )}
          </div>,
          document.body
        )
      : null;

  useEffect(() => {
    if (!open || activeIndex === null) return;
    const el = document.getElementById(`${id}-opt-${activeIndex}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, id]);

  return (
    <>
      <div
        ref={triggerRef}
        className={`box-border w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 transition-[border-color,box-shadow] ${
          open ? 'ring-2 ring-[#a1a2a2]/20' : ''
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        onMouseDown={(e) => {
          // Allow clicking anywhere in the chrome to focus the input.
          if (disabled) return;
          const target = e.target as HTMLElement;
          if (target.closest('button')) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
        onBlur={(e) => {
          const related = e.relatedTarget as Node | null;
          if (panelRef.current?.contains(related)) return;
          onTriggerBlur?.();
        }}
      >
        <span id={`${id}-label`} className="sr-only">
          {ariaLabel ?? 'Multi-select'}
        </span>

        {value.length > 0 ? (
          <div className="mb-2 flex min-h-0 min-w-0 flex-nowrap gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] pr-0.5 [scrollbar-width:thin]">
            {value.map((v) => (
              <span
                key={v}
                className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-1.5 py-0 text-[11px] font-medium leading-tight text-[var(--text-primary)]"
              >
                <span className="whitespace-nowrap">{v}</span>
                <button
                  type="button"
                  onClick={() => onRemove(v)}
                  className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                  aria-label={`Remove ${v}`}
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="relative flex min-h-11 min-w-0 items-center">
          <label className="sr-only" htmlFor={id}>
            {ariaLabel ?? 'Search or add'}
          </label>
          <input
            ref={inputRef}
            id={id}
            value={query}
            disabled={disabled}
            placeholder={open ? '' : placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? `${id}-listbox` : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && activeIndex != null ? `${id}-opt-${activeIndex}` : undefined}
            className={
              open
                ? 'absolute inset-y-0 left-0 right-0 min-h-11 w-full min-w-0 bg-transparent px-1 text-sm text-transparent caret-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]/65'
                : 'min-h-11 w-full min-w-0 bg-transparent px-1 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]/65'
            }
            onFocus={() => {
              if (disabled) return;
              setOpen(true);
              setActiveIndex(null);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIndex(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPrimary();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                setActiveIndex(null);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                if (rows.length === 0) return;
                setActiveIndex((i) => (i === null ? 0 : Math.min(i + 1, rows.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setOpen(true);
                if (rows.length === 0) return;
                setActiveIndex((i) => (i === null ? rows.length - 1 : Math.max(i - 1, 0)));
              } else if (e.key === 'Tab' && !e.shiftKey) {
                // Per request: Tab selects from the list (same as Enter).
                if (!open || filtered.length === 0) return;
                e.preventDefault();
                commitPrimary();
              }
            }}
          />
          {open ? (
            <div className="pointer-events-none flex min-h-11 w-full min-w-0 items-center px-1 text-sm" aria-hidden>
              {query.length > 0 || uniqueInlineSuffix ? (
                <>
                  <span className="shrink-0 text-[var(--text-primary)]">{query}</span>
                  {uniqueInlineSuffix ? (
                    <span className="min-w-0 truncate text-[var(--text-muted)]">{uniqueInlineSuffix}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-[var(--text-muted)]">{placeholder}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {panel}
    </>
  );
}

