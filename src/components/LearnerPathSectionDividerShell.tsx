import React from 'react';
import { PathSectionDividerCard } from './PathSectionDividerCard';

export type LearnerPathSectionDividerShellProps = {
  title: string;
  dividerEyebrow?: string;
  panelId: string;
  /** When true, header is a disclosure control and `panel` respects `panelOpen`. */
  expandable: boolean;
  panelOpen: boolean;
  onToggle?: () => void;
  /** Nested outline body; omit when there is nothing to show under the divider. */
  panel?: React.ReactNode;
};

/**
 * Learner path: shared section-divider chrome (card header + optional collapsible panel).
 * Used by flat course-row layout and mindmap outline so styling stays in sync.
 */
export function LearnerPathSectionDividerShell({
  title,
  dividerEyebrow,
  panelId,
  expandable,
  panelOpen,
  onToggle,
  panel,
}: LearnerPathSectionDividerShellProps) {
  const onHeaderKeyDown =
    expandable && onToggle
      ? (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }
      : undefined;

  const eyebrow = dividerEyebrow?.trim() ? dividerEyebrow.trim() : 'Section divider';

  return (
    <div className="flex min-w-0 flex-col gap-3" role="presentation">
      <div
        className={
          expandable
            ? 'min-w-0 max-w-full cursor-pointer rounded-lg py-0.5 transition-colors hover:bg-[var(--hover-bg)]/40 sm:py-0.5'
            : 'min-w-0 max-w-full py-0.5'
        }
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? panelOpen : undefined}
        aria-controls={expandable ? panelId : undefined}
        aria-label={
          expandable ? `${panelOpen ? 'Collapse' : 'Expand'} links and topics under ${title}` : undefined
        }
        onClick={expandable && onToggle ? () => onToggle() : undefined}
        onKeyDown={onHeaderKeyDown}
      >
        <div className="min-w-0">
          <PathSectionDividerCard title={title} eyebrow={eyebrow} />
        </div>
      </div>
      {panel != null ? (
        <div id={panelId} hidden={expandable && !panelOpen} className="min-w-0">
          {panel}
        </div>
      ) : null}
    </div>
  );
}
