import React from 'react';
import type { PathOutlineAudienceRole } from '../../data/pathMindmap';
import { AdminAudienceRolesDropdown } from './AdminAudienceRolesDropdown';

/** Path builder: catalog path outline column. */
export const PATH_OUTLINE_ROW_VISIBILITY_SHOW_TIP =
  'When off, the row is hidden from the path outline for everyone (including admins). When on, open Audience and select roles: Learner means everyone; without Learner, choose admin and/or creator. For course or lesson rows, learners only see them if that course is also published in the Catalog tab.';

/** Course catalog: course / module / lesson hierarchy in the learner app. */
export const COURSE_HIERARCHY_VISIBILITY_SHOW_TIP =
  'When off, this unit is hidden from the course overview and player for everyone (including admins). When on, open Audience and select roles: Learner means everyone; without Learner, choose admin and/or creator. Draft platform courses stay out of the library regardless of these settings.';

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
  /** Stable `id` for the audience dropdown trigger (unique per course/module/lesson/path row). */
  audienceListboxId: string;
}) {
  const hiddenFromAll = Array.isArray(visibleToRoles) && visibleToRoles.length === 0;
  const showInOutline = !hiddenFromAll;

  const audienceTriggerTone = showInOutline
    ? 'border-[var(--border-color)] !bg-[var(--bg-primary)]'
    : '!cursor-not-allowed !border-[var(--border-color)]/50 !bg-[var(--bg-secondary)] !text-[var(--text-muted)] !opacity-60';

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
            onChange(['learner']);
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

  const roleCell = (
    <AdminAudienceRolesDropdown
      id={audienceListboxId}
      visibleToRoles={visibleToRoles}
      onChange={onChange}
      showInOutline={showInOutline}
      triggerTitle={showInOutline ? audienceTitle : undefined}
      aria-label={audienceAriaLabel}
      density="compact"
      triggerClassName={`sm:h-7 sm:min-h-0 !rounded-md px-2 py-0 text-xs leading-none sm:text-sm ${audienceTriggerTone}`}
    />
  );

  if ((nested && nestedGridSecondRow) || topLevelGridSecondRow) {
    return (
      <div
        data-path-branch-outline-visibility
        className="max-md:col-span-full max-md:col-start-1 max-md:row-auto max-md:flex max-md:min-w-0 max-md:flex-col max-md:gap-2 max-md:overflow-x-auto md:contents"
      >
        <div className="col-start-3 row-start-1 flex min-w-0 shrink-0 items-center justify-center justify-self-center max-md:justify-start md:justify-self-center">
          {showCell}
        </div>
        <div className="col-start-4 row-start-1 flex w-full min-w-0 max-w-[22rem] items-start justify-self-stretch max-md:max-w-none md:min-w-[12rem]">
          {roleCell}
        </div>
      </div>
    );
  }

  if (nested) {
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
              onChange(['learner']);
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
        data-path-branch-outline-visibility
        className={`flex max-w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-start sm:gap-2 ${
          rowEnd ? 'ml-auto items-end sm:ml-auto sm:justify-end' : ''
        }`}
      >
        {showCellInline}
        <div className="min-w-0 w-full max-w-[min(100vw-2rem,22rem)] shrink-0 sm:w-auto">{roleCell}</div>
      </div>
    );
  }

  return (
    <div data-path-branch-outline-visibility className="contents">
      <div className="flex min-w-0 justify-center md:px-0">{showCell}</div>
      <div className="min-w-0 md:min-w-0">{roleCell}</div>
    </div>
  );
}
