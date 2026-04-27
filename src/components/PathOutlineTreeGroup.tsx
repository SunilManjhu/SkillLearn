import React from 'react';

/** `tree`: left rail, elbows, responsive indent. `flat`: simple stack (e.g. links under a section divider card). */
export type PathOutlineTreeLayout = 'tree' | 'flat';

const PathOutlineTreeLayoutContext = React.createContext<PathOutlineTreeLayout>('tree');

export function usePathOutlineTreeLayout(): PathOutlineTreeLayout {
  return React.useContext(PathOutlineTreeLayoutContext);
}

function outerPadClass(parentDepth: number): string {
  if (parentDepth <= 1) {
    return 'pl-2.5 sm:pl-3 md:pl-12';
  }
  if (parentDepth === 2) {
    return 'pl-2 sm:pl-2.5 md:pl-10';
  }
  return 'pl-2 sm:pl-2.5 md:pl-8';
}

const TREE_ITEM_CLASS =
  'relative min-w-0 before:pointer-events-none before:absolute before:left-0 before:top-[0.92rem] before:z-0 before:h-px before:w-3 before:-translate-x-full before:bg-[var(--border-color)]/65 sm:before:top-4 sm:before:w-4 md:before:w-5';

const TREE_LIST_CLASS =
  'relative list-none space-y-3 border-l-2 border-[var(--border-color)]/60 bg-[var(--bg-primary)]/20 py-1 pl-3 sm:pl-4 md:rounded-bl-lg md:rounded-tl-md md:border-[var(--border-color)]/70 md:py-1.5';

/**
 * Vertical rail + horizontal elbows for nested path rows (section divider children, nested outline branches).
 * Use `variant="flat"` under section divider cards so links stack without growing left gutter on `md+`.
 */
export function PathOutlineTreeGroup({
  parentDepth,
  variant = 'tree',
  children,
}: {
  parentDepth: number;
  variant?: PathOutlineTreeLayout;
  children: React.ReactNode;
}) {
  const outerClass = variant === 'flat' ? 'min-w-0' : `min-w-0 ${outerPadClass(parentDepth)}`;
  const listClass =
    variant === 'flat' ? 'relative min-w-0 list-none space-y-3 py-0' : TREE_LIST_CLASS;

  return (
    <PathOutlineTreeLayoutContext.Provider value={variant}>
      <div className={outerClass}>
        <ul role="list" className={listClass}>
          {children}
        </ul>
      </div>
    </PathOutlineTreeLayoutContext.Provider>
  );
}

export function PathOutlineTreeItem({ children }: { children: React.ReactNode }) {
  const layout = usePathOutlineTreeLayout();
  return <li className={layout === 'tree' ? TREE_ITEM_CLASS : 'min-w-0'}>{children}</li>;
}
