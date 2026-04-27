import { Link2 } from 'lucide-react';
import React from 'react';

const ROW_INNER = 'flex min-w-0 flex-1 flex-row items-center gap-2 md:min-w-0 md:flex-1';
const ICON_BOX = 'flex w-7 shrink-0 items-center justify-center sm:w-8';

/** Shared underline / hover (outline + course-row external links). */
export const PATH_OUTLINE_EXTERNAL_LINK_UNDERLINE =
  'underline decoration-[var(--border-light)] decoration-1 underline-offset-[3px] transition-colors hover:bg-[var(--hover-bg)]/60 hover:decoration-[var(--text-secondary)] [overflow-wrap:anywhere]';

const DIVIDER_STACK_TYPO =
  'min-w-0 flex-1 text-sm leading-relaxed text-[var(--text-secondary)] [overflow-wrap:anywhere] sm:text-[15px] text-[var(--text-primary)]';

const DIVIDER_STACK_ANCHOR = `${DIVIDER_STACK_TYPO} ${PATH_OUTLINE_EXTERNAL_LINK_UNDERLINE}`;

export function PathOutlineDividerExternalLinkAnchor({
  href,
  label,
  className,
  onClick,
}: {
  href: string;
  label: string;
  className: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>
      {label}
    </a>
  );
}

/**
 * External link with icon in-row (flat course-row divider children; anywhere there is no separate lead slot).
 */
export function PathOutlineDividerExternalLinkRow({
  href,
  label,
  className = 'min-w-0',
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className={ROW_INNER}>
        <div className={ICON_BOX} role="img" aria-label="External web link">
          <Link2 className="text-[var(--text-secondary)]" size={20} strokeWidth={2.25} aria-hidden />
        </div>
        <PathOutlineDividerExternalLinkAnchor href={href} label={label} className={DIVIDER_STACK_ANCHOR} />
      </div>
    </div>
  );
}
