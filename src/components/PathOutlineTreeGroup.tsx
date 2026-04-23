import React from 'react';

function outerPadClass(parentDepth: number): string {
  if (parentDepth <= 1) {
    return 'mt-0.5 pl-2.5 sm:pl-3 md:mt-1 md:pl-12';
  }
  if (parentDepth === 2) {
    return 'mt-0.5 pl-2 sm:pl-2.5 md:mt-1 md:pl-10';
  }
  return 'mt-0.5 pl-2 sm:pl-2.5 md:mt-1 md:pl-8';
}

/**
 * Vertical rail + horizontal elbows for nested path rows (section divider children, nested outline branches).
 * Mobile-first: connector lines show at all breakpoints (narrow path sidebar).
 */
export function PathOutlineTreeGroup({
  parentDepth,
  children,
}: {
  parentDepth: number;
  children: React.ReactNode;
}) {
  const marginTop = parentDepth === 1 ? 'mt-0.5 sm:mt-1' : 'mt-0.5 sm:mt-1';
  return (
    <div className={`min-w-0 ${marginTop} ${outerPadClass(parentDepth)}`}>
      <ul
        role="list"
        className="relative list-none space-y-1.5 border-l-2 border-[var(--border-color)]/60 bg-[var(--bg-primary)]/20 py-1.5 pl-3 sm:space-y-1 sm:pl-4 md:rounded-bl-lg md:rounded-tl-md md:border-[var(--border-color)]/70 md:py-1"
      >
        {children}
      </ul>
    </div>
  );
}

export function PathOutlineTreeItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative min-w-0 before:pointer-events-none before:absolute before:left-0 before:top-[0.92rem] before:z-0 before:h-px before:w-3 before:-translate-x-full before:bg-[var(--border-color)]/65 sm:before:top-4 sm:before:w-4 md:before:w-5">
      {children}
    </li>
  );
}
