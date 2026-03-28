import React, { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { Course } from '../data/courses';
import type { LibraryFilterState } from '../utils/courseTaxonomy';
import { COURSE_LEVELS, toggleFilterTag } from '../utils/courseTaxonomy';

export type CourseLibraryCategoryFilterProps = {
  mainTopics: readonly string[];
  moreTopics: readonly string[];
  mainSkills: readonly string[];
  moreSkills: readonly string[];
  filters: LibraryFilterState;
  onFiltersChange: (next: LibraryFilterState) => void;
};

function removeFromList(selected: string[], tag: string): string[] {
  const k = tag.toLowerCase();
  return selected.filter((s) => s.toLowerCase() !== k);
}

type TagRowProps = {
  label: string;
  selected: string[];
  onToggle: (label: string) => void;
};

function FilterTagButton({ label, selected, onToggle }: TagRowProps) {
  const isOn = selected.some((s) => s.toLowerCase() === label.toLowerCase());
  return (
    <button
      type="button"
      onClick={() => onToggle(label)}
      className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-3 py-2 text-left text-xs font-medium transition-colors sm:text-sm ${
        isOn
          ? 'border-orange-500 bg-orange-500/15 text-orange-500'
          : 'border-[var(--border-light)] bg-[var(--hover-bg)]/60 text-[var(--text-secondary)] hover:border-orange-500/40 hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      {isOn ? (
        <span className="shrink-0 text-[0.7rem] leading-none opacity-80" aria-hidden>
          ✕
        </span>
      ) : null}
    </button>
  );
}

/**
 * Single search field + chips open a dropdown: categories (multi), skills (multi), level (single).
 * The same query filters visible tags in the panel (no second search inside the dropdown).
 */
export const CourseLibraryCategoryFilter = forwardRef<HTMLInputElement, CourseLibraryCategoryFilterProps>(
  function CourseLibraryCategoryFilter(
    { mainTopics, moreTopics, mainSkills, moreSkills, filters, onFiltersChange },
    ref
  ) {
    const panelId = useId();
    /** Stable id for tests / focus targets (navbar filter). */
    const inputId = 'course-library-category-filter-trigger';
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    /** True while focus is inside the bar or dropdown — hides placeholders (no stacked hints). */
    const [filterFocusedWithin, setFilterFocusedWithin] = useState(false);

    const categoryPool = useMemo(() => [...mainTopics, ...moreTopics], [mainTopics, moreTopics]);
    const skillPool = useMemo(() => [...mainSkills, ...moreSkills], [mainSkills, moreSkills]);

    const q = query.trim().toLowerCase();
    const filterLabels = (labels: readonly string[]) =>
      q ? labels.filter((l) => l.toLowerCase().includes(q)) : [...labels];

    const visibleMainCat = useMemo(() => filterLabels(mainTopics), [mainTopics, q]);
    const visibleMoreCat = useMemo(() => filterLabels(moreTopics), [moreTopics, q]);
    const visibleMainSkill = useMemo(() => filterLabels(mainSkills), [mainSkills, q]);
    const visibleMoreSkill = useMemo(() => filterLabels(moreSkills), [moreSkills, q]);
    const visibleLevels = useMemo(() => {
      const labels = [...COURSE_LEVELS];
      return q ? labels.filter((l) => l.toLowerCase().includes(q)) : labels;
    }, [q]);

    const activeCount =
      filters.categoryTags.length + filters.skillTags.length + (filters.level != null ? 1 : 0);

    const clearAllFilters = (e: React.MouseEvent) => {
      e.stopPropagation();
      onFiltersChange({ categoryTags: [], skillTags: [], level: null });
    };

    const renderActiveChip = (
      reactKey: string,
      kind: 'category' | 'skill' | 'level',
      label: string,
      onRemove: () => void
    ) => {
      const dot =
        kind === 'category' ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-hidden />
        ) : kind === 'skill' ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--text-muted)]" aria-hidden />
        );
      return (
        <button
          key={reactKey}
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="inline-flex max-w-[min(100%,18rem)] shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1 text-left text-xs font-medium text-[var(--text-primary)] outline-none transition-colors hover:bg-[var(--border-color)]/40 focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-secondary)]"
        >
          {dot}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="mx-0.5 h-3 w-px shrink-0 bg-[var(--border-color)]" aria-hidden />
          <X size={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
        </button>
      );
    };

    useEffect(() => {
      if (!open) return;
      const onDoc = (e: MouseEvent) => {
        const el = rootRef.current;
        if (!el || el.contains(e.target as Node)) return;
        setOpen(false);
      };
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    useEffect(() => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        const el = rootRef.current;
        if (!el || !el.contains(e.target as Node)) return;
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);

    const toggleCategory = (label: string) => {
      onFiltersChange({
        ...filters,
        categoryTags: toggleFilterTag(filters.categoryTags, label, categoryPool),
      });
    };

    const toggleSkill = (label: string) => {
      onFiltersChange({
        ...filters,
        skillTags: toggleFilterTag(filters.skillTags, label, skillPool),
      });
    };

    const toggleLevel = (level: Course['level']) => {
      onFiltersChange({
        ...filters,
        level: filters.level === level ? null : level,
      });
    };

    const anyVisible =
      visibleMainCat.length +
        visibleMoreCat.length +
        visibleMainSkill.length +
        visibleMoreSkill.length +
        visibleLevels.length >
      0;

    const firstMobileCloseSection =
      visibleMainCat.length > 0
        ? 'mainCat'
        : visibleMoreCat.length > 0
          ? 'moreCat'
          : visibleMainSkill.length > 0
            ? 'mainSkill'
            : visibleMoreSkill.length > 0
              ? 'moreSkill'
              : visibleLevels.length > 0
                ? 'level'
                : 'empty';

    const mobileFilterClose = (slot: typeof firstMobileCloseSection) =>
      firstMobileCloseSection === slot ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] outline-none transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] md:hidden"
          aria-label="Close filters"
        >
          <X size={18} strokeWidth={2} aria-hidden />
        </button>
      ) : null;

    const inputPlaceholder =
      filterFocusedWithin || query.trim() !== '' ? '' : 'Filter courses…';

    return (
      <div
        ref={rootRef}
        className="relative min-w-0"
        onFocusCapture={() => setFilterFocusedWithin(true)}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !rootRef.current?.contains(next)) {
            setFilterFocusedWithin(false);
          }
        }}
      >
        <div
          className="flex w-full min-w-0 items-stretch gap-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 pl-2 pr-0.5 shadow-sm transition-colors focus-within:border-orange-500/40 focus-within:ring-1 focus-within:ring-orange-500/25"
          role="group"
          aria-label="Course filters"
        >
          <Search size={16} className="ml-1 shrink-0 self-center text-[var(--text-muted)]" aria-hidden />
          <div className="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Below md, active tags live in the nav drawer (Categories / Skills); bar stays search-only. */}
            <div className="hidden md:contents">
              {filters.categoryTags.map((tag) =>
                renderActiveChip(
                  `c-${tag}`,
                  'category',
                  tag,
                  () =>
                    onFiltersChange({ ...filters, categoryTags: removeFromList(filters.categoryTags, tag) })
                )
              )}
              {filters.skillTags.map((tag) =>
                renderActiveChip(
                  `s-${tag}`,
                  'skill',
                  tag,
                  () => onFiltersChange({ ...filters, skillTags: removeFromList(filters.skillTags, tag) })
                )
              )}
              {filters.level != null
                ? renderActiveChip('level', 'level', filters.level, () =>
                    onFiltersChange({ ...filters, level: null })
                  )
                : null}
            </div>
            <label htmlFor={inputId} className="sr-only">
              Search topics, skills, and levels to filter the catalog
            </label>
            <input
              ref={ref}
              id={inputId}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              aria-expanded={open}
              aria-controls={panelId}
              aria-haspopup="dialog"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder={inputPlaceholder}
              className="min-h-9 min-w-[6rem] flex-1 shrink-0 border-0 bg-transparent px-2 py-1.5 text-sm text-[var(--text-primary)] shadow-none outline-none ring-0 placeholder:text-[var(--text-muted)] focus:border-0 focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:min-w-[8rem] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
            />
          </div>
          <div className="flex shrink-0 items-center self-stretch">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
              aria-expanded={open}
              aria-controls={panelId}
              className="hidden h-full min-h-10 min-w-10 items-center justify-center rounded-full text-[var(--text-muted)] outline-none transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] md:inline-flex"
              aria-label={open ? 'Close filter options' : 'Open filter options'}
            >
              <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            <button
              type="button"
              tabIndex={activeCount > 0 ? 0 : -1}
              aria-hidden={activeCount === 0}
              onClick={activeCount > 0 ? clearAllFilters : undefined}
              className={`inline-flex h-full min-h-10 min-w-10 items-center justify-center rounded-full text-[var(--text-muted)] outline-none transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] ${activeCount === 0 ? 'pointer-events-none invisible' : ''}`}
              aria-label="Clear all filters"
            >
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>

        {open ? (
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Course filters"
            className="filterWindow dropdown card absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(75vh,32rem)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:left-0 sm:right-auto sm:w-[min(100%,26rem)] max-md:fixed max-md:left-[5vw] max-md:right-[5vw] max-md:top-[calc(4rem+env(safe-area-inset-top,0px)+0.375rem)] max-md:mt-0 max-md:z-[60] max-md:flex max-md:h-[calc((100dvh-4.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))*0.9)] max-md:max-h-[calc((100dvh-4.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))*0.9)] max-md:w-auto max-md:flex-col"
          >
            <div className="max-h-[min(65vh,28rem)] overflow-y-auto overscroll-contain px-3 py-3 max-md:max-h-none max-md:min-h-0 max-md:flex-1">
              {visibleMainCat.length > 0 ? (
                <section className="mb-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="title min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      Popular topics
                    </div>
                    {mobileFilterClose('mainCat')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleMainCat.map((label) => (
                      <React.Fragment key={`cm-${label}`}>
                        <FilterTagButton
                          label={label}
                          selected={filters.categoryTags}
                          onToggle={toggleCategory}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              ) : null}

              {visibleMainCat.length > 0 && visibleMoreCat.length > 0 ? (
                <div className="mb-4 border-t border-[var(--border-color)]" />
              ) : null}

              {visibleMoreCat.length > 0 ? (
                <section className="mb-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="title min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      More topics
                    </div>
                    {mobileFilterClose('moreCat')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleMoreCat.map((label) => (
                      <React.Fragment key={`cx-${label}`}>
                        <FilterTagButton
                          label={label}
                          selected={filters.categoryTags}
                          onToggle={toggleCategory}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              ) : null}

              {(visibleMainCat.length > 0 || visibleMoreCat.length > 0) &&
              (visibleMainSkill.length > 0 || visibleMoreSkill.length > 0 || visibleLevels.length > 0) ? (
                <div className="mb-4 border-t border-[var(--border-color)]" />
              ) : null}

              {visibleMainSkill.length > 0 ? (
                <section className="mb-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="title min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      Popular skills
                    </div>
                    {mobileFilterClose('mainSkill')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleMainSkill.map((label) => (
                      <React.Fragment key={`sm-${label}`}>
                        <FilterTagButton label={label} selected={filters.skillTags} onToggle={toggleSkill} />
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              ) : null}

              {visibleMainSkill.length > 0 && visibleMoreSkill.length > 0 ? (
                <div className="mb-4 border-t border-[var(--border-color)]" />
              ) : null}

              {visibleMoreSkill.length > 0 ? (
                <section className="mb-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="title min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      More skills
                    </div>
                    {mobileFilterClose('moreSkill')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleMoreSkill.map((label) => (
                      <React.Fragment key={`sx-${label}`}>
                        <FilterTagButton label={label} selected={filters.skillTags} onToggle={toggleSkill} />
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              ) : null}

              {(visibleMainSkill.length > 0 || visibleMoreSkill.length > 0) && visibleLevels.length > 0 ? (
                <div className="mb-4 border-t border-[var(--border-color)]" />
              ) : null}

              {visibleLevels.length > 0 ? (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="title min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      Level
                    </div>
                    {mobileFilterClose('level')}
                  </div>
                  <p className="mb-2 text-[11px] text-[var(--text-muted)]">Pick one level to narrow results.</p>
                  <div className="flex flex-wrap gap-2">
                    {visibleLevels.map((level) => (
                      <React.Fragment key={`lv-${level}`}>
                        <FilterTagButton
                          label={level}
                          selected={filters.level === level ? [level] : []}
                          onToggle={(lbl) => toggleLevel(lbl as Course['level'])}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              ) : null}

              {!anyVisible ? (
                <>
                  <div className="mb-2 flex items-center justify-end gap-2 md:hidden">
                    {mobileFilterClose('empty')}
                  </div>
                  <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nothing matches that search.</p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
);
