import React from 'react';
import type { PathOutlineAudienceRole } from '../../data/pathMindmap';
import { AdminListboxSelect } from './AdminListboxSelect';
import { COURSE_HIERARCHY_AUDIENCE_LISTBOX_OPTIONS } from './adminListboxSharedOptions';

/** Derived UI state for `visibleToRoles` (path outline + course hierarchy). */
export function outlineRowVisibilityDerivedState(visibleToRoles: PathOutlineAudienceRole[] | undefined): {
  showInOutline: boolean;
  audienceSelectValue: 'admin' | 'everyone';
} {
  const hiddenFromAll = Array.isArray(visibleToRoles) && visibleToRoles.length === 0;
  const showInOutline = !hiddenFromAll;
  const adminOnly =
    showInOutline &&
    Array.isArray(visibleToRoles) &&
    visibleToRoles.length === 1 &&
    visibleToRoles[0] === 'admin';
  const audienceSelectValue = adminOnly ? 'admin' : 'everyone';
  return { showInOutline, audienceSelectValue };
}

/** Path builder: catalog path outline column. */
export const PATH_OUTLINE_ROW_VISIBILITY_SHOW_TIP =
  'When off, the row is hidden from the path outline for everyone (including admins). When on, use the audience menu for User vs Admin-only. For course or lesson rows, learners only see them if that course is also published in the Catalog tab—draft courses stay hidden from learners even when Show is on. Admins viewing a path in the app see all rows that are shown to User or Admin.';

/** Course catalog: course / module / lesson hierarchy in the learner app. */
export const COURSE_HIERARCHY_VISIBILITY_SHOW_TIP =
  'When off, this unit is hidden from the course overview and player for everyone (including admins). When on, use the audience menu for User vs Admin-only. Administrators signed in with the admin role still see units set to Administrators only. Draft platform courses stay out of the library regardless of these settings.';

export function CourseHierarchyVisibilityCells({
  visibleToRoles,
  onChange,
  nested,
  nestedGridSecondRow,
  topLevelGridSecondRow,
  catalogRowAlign = 'start',
  showColumnTip,
  audienceTitle,
  showAriaLabel,
  audienceAriaLabel,
  audienceListboxId,
}: {
  visibleToRoles: PathOutlineAudienceRole[] | undefined;
  onChange: (next: PathOutlineAudienceRole[]) => void;
  nested: boolean;
  /** When nested, place checkbox/select on grid row 2 with the title input (not vertically centered on the whole cell). */
  nestedGridSecondRow?: boolean;
  /** Same as nested, for top-level `li` outline grid (row 2 with inputs). */
  topLevelGridSecondRow?: boolean;
  /** Catalog only (`nested` without grid): align the Show + audience row (module header matches path-style right columns). */
  catalogRowAlign?: 'start' | 'end';
  showColumnTip: string;
  audienceTitle: string;
  showAriaLabel: string;
  audienceAriaLabel: string;
  /** Stable `id` for the audience listbox trigger (unique per course/module/lesson/path row). */
  audienceListboxId: string;
}) {
  const { showInOutline, audienceSelectValue } = outlineRowVisibilityDerivedState(visibleToRoles);

  const showCell = (
    <label
      className="flex min-h-11 cursor-pointer items-center gap-2 touch-manipulation text-xs text-[var(--text-secondary)] sm:h-7 sm:min-h-0 md:justify-center md:gap-0"
      title={showColumnTip}
    >
      <input
        type="checkbox"
        checked={showInOutline}
        onChange={(e) => {
          if (e.target.checked) {
            onChange(['user', 'admin']);
          } else {
            onChange([]);
          }
        }}
        className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
        aria-label={showAriaLabel}
      />
      <span className="min-w-0 select-none font-semibold leading-snug md:sr-only">Show</span>
    </label>
  );

  const audienceTriggerTone = showInOutline
    ? 'border-[var(--border-color)] !bg-[var(--bg-primary)]'
    : '!cursor-not-allowed !border-[var(--border-color)]/50 !bg-[var(--bg-secondary)] !text-[var(--text-muted)] !opacity-60';

  const roleCell = (
    <AdminListboxSelect
      id={audienceListboxId}
      value={audienceSelectValue}
      disabled={!showInOutline}
      onChange={(v) => {
        if (v === 'admin') onChange(['admin']);
        else onChange(['user', 'admin']);
      }}
      options={COURSE_HIERARCHY_AUDIENCE_LISTBOX_OPTIONS}
      placeholder="Audience"
      aria-label={audienceAriaLabel}
      triggerTitle={
        showInOutline
          ? audienceTitle
          : 'Hidden for the selected scope. Turn on Show to choose who can see this unit.'
      }
      triggerClassName={`min-h-11 sm:h-7 sm:min-h-0 !rounded-md px-2 py-0 text-xs leading-none sm:text-sm ${audienceTriggerTone}`}
    />
  );

  if ((nested && nestedGridSecondRow) || topLevelGridSecondRow) {
    return (
      <div className="max-md:col-span-full max-md:col-start-1 max-md:row-auto max-md:flex max-md:min-w-0 max-md:flex-row max-md:flex-nowrap max-md:items-center max-md:gap-x-2 max-md:overflow-x-auto md:contents">
        <div className="col-start-3 row-start-1 flex min-w-0 shrink-0 items-center justify-center justify-self-center max-md:justify-start md:justify-self-center">
          {showCell}
        </div>
        <div className="col-start-4 row-start-1 flex w-full min-w-[10rem] max-w-[16rem] items-center justify-self-stretch max-md:max-w-none max-md:shrink sm:min-w-[12rem]">
          {roleCell}
        </div>
      </div>
    );
  }

  /**
   * Catalog course/module/lesson: same single row as path nested outline on narrow viewports
   * (Show checkbox + audience select), without grid column placement.
   */
  if (nested) {
    /** One line: checkbox + audience (label “Show” is screen-reader only here to save width). */
    const showCellInline = (
      <label
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center touch-manipulation sm:size-7"
        title={showColumnTip}
      >
        <input
          type="checkbox"
          checked={showInOutline}
          onChange={(e) => {
            if (e.target.checked) {
              onChange(['user', 'admin']);
            } else {
              onChange([]);
            }
          }}
          className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
          aria-label={showAriaLabel}
        />
        <span className="sr-only">Show</span>
      </label>
    );
    const rowEnd = catalogRowAlign === 'end';
    return (
      <div
        className={`inline-flex max-w-full min-w-0 flex-nowrap items-center gap-2 ${
          rowEnd ? 'ml-auto justify-end' : ''
        }`}
      >
        {showCellInline}
        <div className="min-w-0 w-[min(100vw-4.5rem,16rem)] shrink-0 sm:w-[14rem]">
          {roleCell}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-w-0 justify-center md:px-0">{showCell}</div>
      <div className="min-w-0 md:min-w-0">{roleCell}</div>
    </>
  );
}
