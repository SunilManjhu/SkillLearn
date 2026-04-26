import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import {
  ADMIN_LISTBOX_TRIGGER_BODY,
  CUSTOM_LISTBOX_LOADING,
  CUSTOM_LISTBOX_OPTION_SINGLE,
  CUSTOM_LISTBOX_PANEL,
} from '../../ui/customMenuClasses';
import { computeAdminListboxPanelStyle } from './adminListboxPanelStyle';

export type AdminListboxOption = { value: string; label: string; title?: string };

export type AdminListboxSelectProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly AdminListboxOption[];
  disabled?: boolean;
  /** Label when `value` is missing from `options`. */
  placeholder?: string;
  /** Message inside an open but empty options panel. */
  emptyMessage?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
  /** Extra classes on the trigger (e.g. secondary surface, compact table row). */
  triggerClassName?: string;
  /** Fires when focus leaves the trigger and does not move into the portaled listbox. */
  onTriggerBlur?: () => void;
  /** Hover tooltip on the trigger button. */
  triggerTitle?: string;
  /** Accessible name when there is no visible text label. */
  'aria-label'?: string;
  /** Narrow panel width (match trigger); menu rows stay same as default listboxes. */
  density?: 'default' | 'compact';
};

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref && 'current' in ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

export const AdminListboxSelect = React.forwardRef<HTMLButtonElement, AdminListboxSelectProps>(
  function AdminListboxSelect(
    {
      id,
      value,
      onChange,
      options,
      disabled = false,
      placeholder = 'Select…',
      emptyMessage = 'No options',
      'aria-invalid': ariaInvalid,
      'aria-describedby': ariaDescribedBy,
      triggerClassName = '',
      onTriggerBlur,
      triggerTitle,
      'aria-label': ariaLabel,
      density = 'default',
    },
    ref
  ) {
    const [open, setOpen] = useState(false);
    const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const selected = options.find((o) => o.value === value);
    const displayLabel = selected?.label ?? placeholder;

    const reposition = useCallback(() => {
      const t = triggerRef.current;
      if (!t || !open) return;
      setPanelStyle(
        computeAdminListboxPanelStyle(t.getBoundingClientRect(), {
          minPanelWidth: density === 'compact' ? 0 : undefined,
        })
      );
    }, [open, density]);

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
      if (disabled) return;
      setOpen(true);
    }, [disabled]);

    const pick = useCallback(
      (next: string) => {
        onChange(next);
        setOpen(false);
        triggerRef.current?.focus();
      },
      [onChange]
    );

    const invalid = ariaInvalid === true || ariaInvalid === 'true';
    const borderCls = invalid ? 'border-[#616161]' : 'border-[var(--border-color)]';
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
              {options.length === 0 ? (
                <p className={CUSTOM_LISTBOX_LOADING}>{emptyMessage}</p>
              ) : (
                options.map((row) => (
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
                ))
              )}
            </div>,
            document.body
          )
        : null;

    return (
      <>
        <button
          ref={mergeRefs(ref, triggerRef)}
          id={id}
          type="button"
          disabled={disabled}
          className={`${ADMIN_LISTBOX_TRIGGER_BODY} ${borderCls} disabled:pointer-events-none disabled:opacity-50 ${triggerClassName}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-listbox` : undefined}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          title={triggerTitle}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onBlur={(e) => {
            const related = e.relatedTarget as Node | null;
            if (panelRef.current?.contains(related)) return;
            onTriggerBlur?.();
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!open) openMenu();
            }
          }}
        >
          <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
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
);
