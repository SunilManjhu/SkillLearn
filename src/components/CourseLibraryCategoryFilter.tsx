import React, { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { Course } from '../data/courses';
import type { LibraryFilterState } from '../utils/courseTaxonomy';
import { COURSE_LEVELS } from '../utils/courseTaxonomy';

export type CourseLibraryCategoryFilterProps = {
  mainTopics: readonly string[];
  moreTopics: readonly string[];
  mainSkills: readonly string[];
  moreSkills: readonly string[];
  filters: LibraryFilterState;
  onFiltersChange: (next: LibraryFilterState) => void;
};

function canonicalLabel(tag: string, pool: readonly string[]): string {
  const k = tag.trim().toLowerCase();
  return pool.find((p) => p.toLowerCase() === k) ?? tag.trim();
}

function toggleInList(selected: string[], tag: string, pool: readonly string[]): string[] {
  const k = tag.trim().toLowerCase();
  const has = selected.some((s) => s.toLowerCase() === k);
  if (has) {
    return selected.filter((s) => s.toLowerCase() !== k);
  }
  const c = canonicalLabel(tag, pool);
  if (selected.some((s) => s.toLowerCase() === c.toLowerCase())) return selected;
  return [...selected, c];
}

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
 * Search-style control opening a dropdown card: categories (multi), skills (multi), level (single).
 */
export const CourseLibraryCategoryFilter = forwardRef<HTMLButtonElement, CourseLibraryCategoryFilterProps>(
  function CourseLibraryCategoryFilter(
    { mainTopics, moreTopics, mainSkills, moreSkills, filters, onFiltersChange },
    ref
  ) {
    const panelId = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

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
          className="inline-flex max-w-[min(100%,12rem)] shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1 text-left text-xs font-medium text-[var(--text-primary)] outline-none transition-colors hover:bg-[var(--border-color)]/40 focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-secondary)]"
        >
          {dot}
          <span className="min-w-0 truncate">{label}</span>
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

    useEffect(() => {
      if (!open) setQuery('');
    }, [open]);

    const toggleCategory = (label: string) => {
      onFiltersChange({
        ...filters,
        categoryTags: toggleInList(filters.categoryTags, label, categoryPool),
      });
    };

    const toggleSkill = (label: string) => {
      onFiltersChange({
        ...filters,
        skillTags: toggleInList(filters.skillTags, label, skillPool),
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

    return (
      <div ref={rootRef} className="relative min-w-0">
        <div
          className="flex w-full min-w-0 items-stretch gap-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 pl-2 pr-0.5 shadow-sm transition-colors focus-within:border-orange-500/40 focus-within:ring-1 focus-within:ring-orange-500/25"
          role="group"
          aria-label="Course filters"
        >
          <Search size={16} className="ml-1 hidden shrink-0 self-center text-[var(--text-muted)] sm:block" aria-hidden />
          <div className="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
            <button
              ref={ref}
              type="button"
              id="course-library-category-filter-trigger"
              aria-expanded={open}
              aria-controls={panelId}
              aria-haspopup="dialog"
              onClick={() => setOpen((o) => !o)}
              className="min-h-9 min-w-0 flex-1 shrink-0 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--text-muted)] outline-none transition-colors hover:text-[var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] sm:min-w-[7rem]"
            >
              {activeCount === 0 ? 'Filter courses…' : 'Add tag'}
            </button>
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
              className="inline-flex h-full min-h-10 min-w-10 items-center justify-center rounded-full text-[var(--text-muted)] outline-none transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
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
            className="filterWindow dropdown card absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(75vh,32rem)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:left-0 sm:right-auto sm:w-[min(100%,26rem)]"
          >
            <div className="border-b border-[var(--border-color)] p-3">
              <label htmlFor={`${panelId}-q`} className="sr-only">
                Find a tag in the lists below
              </label>
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                  aria-hidden
                />
                <input
                  id={`${panelId}-q`}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a tag in the lists below…"
                  autoFocus
                  className="min-h-10 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="max-h-[min(58vh,24rem)] overflow-y-auto overscroll-contain px-3 py-3">
              {visibleMainCat.length > 0 ? (
                <section className="mb-4">
                  <div className="title mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    Popular topics
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
                  <div className="title mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    More topics
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
                  <div className="title mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    Popular skills
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
                  <div className="title mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    More skills
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
                  <div className="title mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    Level
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
                <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nothing matches that search.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
);
