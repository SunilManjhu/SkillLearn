import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import {
  ADMIN_LISTBOX_TRIGGER,
  CUSTOM_LISTBOX_LOADING,
  CUSTOM_LISTBOX_OPTION_SINGLE,
  CUSTOM_LISTBOX_PANEL,
} from '../../ui/customMenuClasses';
import { computeAdminListboxPanelStyle } from './adminListboxPanelStyle';

export type AdminCatalogCoursePickerRow = {
  value: string;
  label: string;
  title?: string;
};

export function AdminCatalogCoursePicker({
  id,
  value,
  onRequestOptions,
  onTriggerPrime,
  onPick,
  rows,
  catalogRequested,
  listLoading,
  triggerClassName,
}: {
  id: string;
  value: string;
  onRequestOptions: () => void;
  /** Load course list when the control is focused (matches native select first-touch). */
  onTriggerPrime?: () => void;
  onPick: (courseId: string) => void;
  rows: readonly AdminCatalogCoursePickerRow[];
  catalogRequested: boolean;
  listLoading: boolean;
  triggerClassName: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedLabel = (() => {
    if (!catalogRequested || listLoading) {
      return catalogRequested ? 'Loading courses…' : 'Select a course…';
    }
    if (value === '__new__') return 'New Course';
    if (!value) return 'Select a course…';
    const hit = rows.find((r) => r.value === value);
    return hit?.label ?? 'Select a course…';
  })();

  const reposition = useCallback(() => {
    const t = triggerRef.current;
    if (!t || !open) return;
    const rect = t.getBoundingClientRect();
    setPanelStyle(computeAdminListboxPanelStyle(rect));
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
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const openMenu = useCallback(() => {
    onRequestOptions();
    setOpen(true);
  }, [onRequestOptions]);

  const pick = useCallback(
    (id: string) => {
      onPick(id);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onPick]
  );

  const panel =
    open && panelStyle
      ? createPortal(
          <div
            ref={panelRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-labelledby={id}
            className={CUSTOM_LISTBOX_PANEL}
            style={panelStyle}
          >
            {!catalogRequested || listLoading ? (
              <p className={CUSTOM_LISTBOX_LOADING}>Loading courses…</p>
            ) : (
              <>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === '__new__'}
                  className={`${CUSTOM_LISTBOX_OPTION_SINGLE} ${
                    value === '__new__' ? 'bg-[var(--hover-bg)] font-medium' : ''
                  }`}
                  onClick={() => pick('__new__')}
                >
                  New Course
                </button>
                {rows.map((row) => (
                  <button
                    key={row.value}
                    type="button"
                    role="option"
                    aria-selected={value === row.value}
                    title={row.title}
                    className={`${CUSTOM_LISTBOX_OPTION_SINGLE} ${
                      value === row.value ? 'bg-[var(--hover-bg)] font-medium' : ''
                    }`}
                    onClick={() => pick(row.value)}
                  >
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${ADMIN_LISTBOX_TRIGGER} ${triggerClassName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onFocus={() => onTriggerPrime?.()}
        onMouseDown={() => {
          if (!open) onTriggerPrime?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!open) openMenu();
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {panel}
    </>
  );
}
