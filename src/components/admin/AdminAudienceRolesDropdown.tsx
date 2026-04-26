import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { normalizeRestrictedAudienceRoles, type PathOutlineAudienceRole } from '../../data/pathMindmap';
import {
  ADMIN_LISTBOX_TRIGGER_BODY,
  CUSTOM_LISTBOX_PANEL,
  MENU_LISTBOX_PAD_X,
} from '../../ui/customMenuClasses';
import { computeAdminListboxPanelStyle } from './adminListboxPanelStyle';

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref && 'current' in ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

function isAudienceEveryone(visibleToRoles: PathOutlineAudienceRole[] | undefined): boolean {
  if (visibleToRoles === undefined) return true;
  return visibleToRoles.includes('learner');
}

function summaryLabel(
  showInOutline: boolean,
  visibleToRoles: PathOutlineAudienceRole[] | undefined
): string {
  if (!showInOutline) return 'Audience';
  if (visibleToRoles === undefined || visibleToRoles.includes('learner')) {
    return 'Everyone (Learner)';
  }
  const a = visibleToRoles.includes('admin');
  const c = visibleToRoles.includes('creator');
  if (a && c) return 'admin + creator';
  if (a) return 'admin';
  if (c) return 'creator';
  return 'Audience';
}

const ROW = `flex min-h-11 w-full touch-manipulation cursor-pointer items-center gap-3 ${MENU_LISTBOX_PAD_X} py-2 text-left text-sm leading-snug text-[var(--text-primary)] hover:bg-[var(--hover-bg)] sm:min-h-10`;

export type AdminAudienceRolesDropdownProps = {
  id: string;
  visibleToRoles: PathOutlineAudienceRole[] | undefined;
  onChange: (next: PathOutlineAudienceRole[]) => void;
  /** When false, trigger is disabled and panel cannot open. */
  showInOutline: boolean;
  triggerTitle?: string;
  'aria-label': string;
  triggerClassName?: string;
  density?: 'default' | 'compact';
};

export const AdminAudienceRolesDropdown = React.forwardRef<HTMLButtonElement, AdminAudienceRolesDropdownProps>(
  function AdminAudienceRolesDropdown(
    {
      id,
      visibleToRoles,
      onChange,
      showInOutline,
      triggerTitle,
      'aria-label': ariaLabel,
      triggerClassName = '',
      density = 'default',
    },
    ref
  ) {
    const [open, setOpen] = useState(false);
    const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const disabled = !showInOutline;
    const everyoneMode = showInOutline && isAudienceEveryone(visibleToRoles);
    const restrictedRaw = (visibleToRoles ?? []).filter(
      (x): x is PathOutlineAudienceRole => x === 'admin' || x === 'creator'
    );
    const restricted = everyoneMode ? [] : normalizeRestrictedAudienceRoles(restrictedRaw);
    const learnerChecked = showInOutline && everyoneMode;
    const adminChecked = showInOutline && (everyoneMode ? false : restricted.includes('admin'));
    const creatorChecked = showInOutline && (everyoneMode ? false : restricted.includes('creator'));

    const displayLabel = useMemo(
      () => summaryLabel(showInOutline, visibleToRoles),
      [showInOutline, visibleToRoles]
    );

    const adminFromEveryoneTitle = 'Admins only — turns off Learner (everyone) and creator.';
    const creatorFromEveryoneTitle = 'Admins + creators — turns off Learner (everyone).';

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

    /** When stored state is `['creator']` only, sync to `['admin','creator']` once the panel opens. */
    useEffect(() => {
      if (!open || everyoneMode || disabled) return;
      const raw = (visibleToRoles ?? []).filter(
        (x): x is PathOutlineAudienceRole => x === 'admin' || x === 'creator'
      );
      const norm = normalizeRestrictedAudienceRoles(raw);
      const rawKey = [...raw].sort().join(',');
      const normKey = norm.join(',');
      if (raw.length > 0 && rawKey !== normKey) {
        onChange(norm);
      }
    }, [open, everyoneMode, disabled, visibleToRoles, onChange]);

    const onUserChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked) {
        onChange(['learner']);
      } else {
        onChange(['admin']);
      }
    };

    const onAdminChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked) {
        onChange(['admin']);
        return;
      }
      if (everyoneMode) return;
      onChange(['learner']);
    };

    const onCreatorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked) {
        onChange(['admin', 'creator']);
        return;
      }
      if (everyoneMode) return;
      onChange(['admin']);
    };

    const panelId = `${id}-audience-panel`;
    const panel =
      open && panelStyle
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="group"
              aria-label={ariaLabel}
              className={`${CUSTOM_LISTBOX_PANEL} min-w-0`}
              style={panelStyle}
            >
              <label className={ROW} title={everyoneMode ? undefined : 'All roles and guests may see this.'}>
                <input
                  type="checkbox"
                  checked={learnerChecked}
                  disabled={disabled}
                  onChange={onUserChange}
                  className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
                />
                <span className="min-w-0 font-medium">Learner</span>
                <span className="min-w-0 text-xs text-[var(--text-secondary)]">everyone</span>
              </label>
              <label
                className={ROW}
                title={everyoneMode ? adminFromEveryoneTitle : 'Admin role only (not Learners or creators).'}
              >
                <input
                  type="checkbox"
                  checked={adminChecked}
                  disabled={disabled}
                  onChange={onAdminChange}
                  className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
                />
                <span className="min-w-0 font-medium">admin</span>
              </label>
              <label
                className={ROW}
                title={everyoneMode ? creatorFromEveryoneTitle : 'Admins and creators (not Learners).'}
              >
                <input
                  type="checkbox"
                  checked={creatorChecked}
                  disabled={disabled}
                  onChange={onCreatorChange}
                  className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
                />
                <span className="min-w-0 font-medium">creator</span>
              </label>
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
          className={`${ADMIN_LISTBOX_TRIGGER_BODY} border-[var(--border-color)] disabled:pointer-events-none disabled:opacity-50 ${triggerClassName}`}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={ariaLabel}
          title={disabled ? 'Turn on Show to choose roles.' : triggerTitle}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!open) openMenu();
            }
          }}
        >
          <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
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
