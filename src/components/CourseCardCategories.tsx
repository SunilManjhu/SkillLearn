import React from 'react';

const CHIP_CLASS =
  'inline-block min-w-0 max-w-full break-words rounded border border-[#cfcfcf] bg-[#e7e7e7] px-1.5 py-0.5 text-left text-[9px] font-bold uppercase tracking-wide text-[#272828]';

type CourseCardCategoriesProps = {
  categories: readonly string[];
};

/**
 * Category chips for a course card: wrap within the card width so long names stay readable (no fixed max-width ellipsis).
 */
export function CourseCardCategories({ categories }: CourseCardCategoriesProps) {
  if (categories.length === 0) {
    return (
      <span className="line-clamp-1 rounded border border-[#cfcfcf] bg-[#e7e7e7] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#272828]">
        Uncategorized
      </span>
    );
  }

  const fullLabel = categories.join(', ');

  return (
    <div className="flex min-w-0 flex-wrap gap-1" title={fullLabel}>
      {categories.map((cat) => (
        <span key={cat} className={CHIP_CLASS} title={cat}>
          {cat}
        </span>
      ))}
    </div>
  );
}
