import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Course } from '../../data/courses';
import { dedupeLabelsPreserveOrder } from '../../utils/courseTaxonomy';
import type { CatalogCategoryPresetsState } from '../../utils/catalogCategoryPresets';
import type { CatalogSkillPresetsState } from '../../utils/catalogSkillPresetsState';
import { buildCatalogTaxonomy } from '../../utils/catalogTaxonomy';
import {
  readCatalogCategoryExtras,
  removeCatalogCategoryExtra,
  replaceCatalogCategoryExtra,
} from '../../utils/catalogCategoryExtras';
import { readCatalogSkillExtras, removeCatalogSkillExtra, replaceCatalogSkillExtra } from '../../utils/catalogSkillExtras';
import { saveCatalogCategoryPresets } from '../../utils/catalogCategoryPresetsFirestore';
import { saveCatalogSkillPresets } from '../../utils/catalogSkillPresetsFirestore';
import { normalizeCatalogCategoryPresets } from '../../utils/catalogCategoryPresets';
import { normalizeCatalogSkillPresets } from '../../utils/catalogSkillPresetsState';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { AdminLabelInfoTip } from './adminLabelInfoTip';

type TaxonomyKind = 'category' | 'skill';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

function displayCourseLabelWithId(c: Course): string {
  const t = (c.title ?? '').trim();
  const base = t ? t : c.id;
  return `${base} (${c.id})`;
}

function formatUpdatedCoursesToastSuffix(updated: readonly Course[]): string {
  if (updated.length === 0) return '';
  const maxList = 5;
  const shown = updated.slice(0, maxList);
  const rest = updated.length - shown.length;
  const tail = rest > 0 ? `(+${rest} more)` : '';
  const lines = shown.map((c, i) => `${i + 1}- ${displayCourseLabelWithId(c)}`);
  const header = `Updated ${updated.length} course${updated.length === 1 ? '' : 's'}:`;
  return `\n\n${header}\n${lines.join('\n')}${tail ? `\n${tail}` : ''}`;
}

function includesCI(haystack: string, needle: string): boolean {
  return lower(haystack).includes(lower(needle));
}

function uniqueCiSorted(list: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = raw.trim();
    if (!t) continue;
    const k = lower(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const Chip: React.FC<{
  label: string;
  editing: boolean;
  editValue: string;
  onEditStart: () => void;
  onEditChange: (next: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onRemove: () => void;
  disabled?: boolean;
}> = ({
  label,
  editing,
  editValue,
  onEditStart,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onRemove,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--hover-bg)]/60 px-2.5 py-1.5">
      {editing ? (
        <div className="flex min-h-8 items-center">
          <label className="sr-only" htmlFor={`admin-taxonomy-chip-edit-${label}`}>
            Edit {label}
          </label>
          <input
            ref={inputRef}
            id={`admin-taxonomy-chip-edit-${label}`}
            value={editValue}
            disabled={disabled}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={() => onEditCommit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEditCommit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onEditCancel();
              }
            }}
            // `size` lets the chip grow/shrink with the typed text while keeping it readable.
            size={Math.max(1, editValue.length)}
            className="min-h-8 w-auto min-w-[6ch] bg-transparent px-0 py-0 text-xs font-semibold text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-orange-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] disabled:opacity-40"
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || editing}
          onClick={onEditStart}
          className="inline-flex min-h-8 min-w-0 max-w-full items-center text-left text-xs font-semibold text-[var(--text-primary)] disabled:opacity-40"
          aria-label={`Edit ${label}`}
        >
          <span className="min-w-0 truncate">{label}</span>
        </button>
      )}
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--border-color)]" aria-hidden />
      <button
        type="button"
        disabled={disabled || editing}
        onClick={onRemove}
        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full text-red-400 hover:bg-red-500/10 disabled:opacity-40"
        aria-label={`Remove ${label} everywhere`}
        title="Remove everywhere"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
};

function TaxonomySection({
  title,
  tip,
  tipId,
  kind,
  items,
  busy,
  onAddEverywhere,
  onRenameEverywhere,
  onRemoveEverywhere,
}: {
  title: string;
  tipId: string;
  tip: React.ReactNode;
  kind: TaxonomyKind;
  items: readonly string[];
  busy: boolean;
  onAddEverywhere: (name: string) => Promise<void>;
  onRenameEverywhere: (fromExact: string, toExact: string) => Promise<void>;
  onRemoveEverywhere: (name: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    if (!trimmed) return items;
    return items.filter((x) => includesCI(x, trimmed));
  }, [items, trimmed]);

  const exactMatch = useMemo(() => {
    if (!trimmed) return null;
    const k = lower(trimmed);
    return items.find((x) => lower(x) === k) ?? null;
  }, [items, trimmed]);

  const showAdd = trimmed.length > 0 && exactMatch == null && editingLabel == null;

  const commitAdd = async () => {
    const next = trimmed;
    if (!next) return;
    await onAddEverywhere(next);
    setQuery('');
  };

  const startInlineEdit = (src: string) => {
    setEditingLabel(src);
    setEditingValue(src);
  };

  const cancelInlineEdit = () => {
    setEditingLabel(null);
    setEditingValue('');
  };

  const commitInlineEdit = async () => {
    if (!editingLabel) return;
    const from = editingLabel;
    const to = editingValue.trim();
    if (!to || lower(to) === lower(from)) {
      cancelInlineEdit();
      return;
    }
    await onRenameEverywhere(from, to);
    setQuery('');
    cancelInlineEdit();
  };

  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 sm:p-6">
      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <h3 className="text-base font-bold leading-none text-[var(--text-primary)]">{title}</h3>
        <AdminLabelInfoTip
          controlOnly
          tipId={tipId}
          tipRegionAriaLabel={`${title} tips`}
          tipSubject={title}
        >
          {tip}
        </AdminLabelInfoTip>
      </div>

      <div className="mt-4 flex min-w-0 items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setQuery('');
                return;
              }
              if (e.key === 'Enter') {
                if (!showAdd) return;
                e.preventDefault();
                void commitAdd();
              }
            }}
            placeholder={kind === 'category' ? 'Search categories…' : 'Search skills…'}
            className="min-h-11 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-orange-500/40 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50"
            disabled={busy}
          />
        </div>

        {/* No explicit add button: Enter adds, Escape clears. */}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {filtered.map((label) => (
          <Chip
            key={label.toLowerCase()}
            label={label}
            editing={editingLabel != null && lower(editingLabel) === lower(label)}
            editValue={editingLabel != null && lower(editingLabel) === lower(label) ? editingValue : label}
            onEditStart={() => startInlineEdit(label)}
            onEditChange={setEditingValue}
            onEditCommit={() => void commitInlineEdit()}
            onEditCancel={cancelInlineEdit}
            disabled={busy}
            onRemove={() => void onRemoveEverywhere(label)}
          />
        ))}
      </div>

      {trimmed && filtered.length === 0 ? (
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          No matches. {showAdd ? 'Press Enter to add, or Esc to clear.' : null}
        </p>
      ) : null}
    </section>
  );
}

export function AdminCatalogTaxonomyPanel({
  publishedList,
  categoryPresets,
  skillPresets,
  onPresetsChanged,
  onSaveCourse,
  onRefreshList,
  onCatalogChanged,
  showActionToast,
}: {
  publishedList: Course[];
  categoryPresets: CatalogCategoryPresetsState;
  skillPresets: CatalogSkillPresetsState;
  onPresetsChanged: (next: { categories: CatalogCategoryPresetsState; skills: CatalogSkillPresetsState }) => void;
  onSaveCourse: (course: Course) => Promise<boolean>;
  onRefreshList: () => Promise<Course[]>;
  onCatalogChanged: () => void | Promise<void>;
  showActionToast: (msg: string, variant?: 'neutral' | 'danger') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: TaxonomyKind; label: string } | null>(null);
  const confirmOpen = confirm != null;
  const [pendingRenames, setPendingRenames] = useState<{ category: Record<string, string>; skill: Record<string, string> }>(
    () => ({ category: {}, skill: {} })
  );
  const [pendingRemovals, setPendingRemovals] = useState<{ category: Set<string>; skill: Set<string> }>(() => ({
    category: new Set(),
    skill: new Set(),
  }));

  const applyPending = useCallback(
    (kind: TaxonomyKind, list: readonly string[]): string[] => {
      const ren = pendingRenames[kind];
      const rem = pendingRemovals[kind];
      const out: string[] = [];
      for (const raw of list) {
        const t = raw.trim();
        if (!t) continue;
        const k = lower(t);
        if (rem.has(k)) continue;
        const mapped = ren[k] ?? t;
        const mappedK = lower(mapped);
        if (rem.has(mappedK)) continue;
        out.push(mapped);
      }
      return out;
    },
    [pendingRenames, pendingRemovals]
  );

  const taxonomy = useMemo(
    () => buildCatalogTaxonomy({ courses: publishedList, topicPresets: categoryPresets, skillPresets }),
    [publishedList, categoryPresets, skillPresets]
  );

  const categoryItems = useMemo(() => {
    const preset = [...categoryPresets.mainPills, ...categoryPresets.moreTopics];
    const extras = readCatalogCategoryExtras();
    const discovered = taxonomy.topics.more;
    return uniqueCiSorted(applyPending('category', [...preset, ...extras, ...discovered]));
  }, [categoryPresets.mainPills, categoryPresets.moreTopics, taxonomy.topics.more, applyPending]);

  const skillItems = useMemo(() => {
    const preset = [...skillPresets.mainPills, ...skillPresets.moreSkills];
    const extras = readCatalogSkillExtras();
    const discovered = taxonomy.skills.more;
    return uniqueCiSorted(applyPending('skill', [...preset, ...extras, ...discovered]));
  }, [skillPresets.mainPills, skillPresets.moreSkills, taxonomy.skills.more, applyPending]);

  const updateCoursesEverywhere = async (kind: TaxonomyKind, from: string, to?: string) => {
    const fromK = lower(from);
    const nextCourses = publishedList
      .map((c) => {
        const arr = kind === 'category' ? c.categories ?? [] : c.skills ?? [];
        const has = arr.some((x) => lower(x) === fromK);
        if (!has) return null;
        const nextArr = to
          ? dedupeLabelsPreserveOrder(arr.map((x) => (lower(x) === fromK ? to : x)))
          : arr.filter((x) => lower(x) !== fromK);
        return kind === 'category' ? ({ ...c, categories: nextArr } as Course) : ({ ...c, skills: nextArr } as Course);
      })
      .filter((x): x is Course => x != null);

    if (nextCourses.length === 0) return { updated: [] as Course[], failed: null as Course | null };

    // Concurrency-limited saves: keeps semantics (wait for all) but reduces wall-clock time.
    const CONCURRENCY = 6;
    let failed: Course | null = null;
    let i = 0;
    const updated: Course[] = [];

    const worker = async () => {
      while (true) {
        if (failed) return;
        const idx = i;
        i += 1;
        const c = nextCourses[idx];
        if (!c) return;
        const ok = await onSaveCourse(c);
        if (!ok) {
          failed = c;
          return;
        }
        updated.push(c);
      }
    };

    const n = Math.min(CONCURRENCY, nextCourses.length);
    await Promise.all(Array.from({ length: n }, () => worker()));

    if (failed) {
      showActionToast(`Save failed while updating "${failed.title || failed.id}".`, 'danger');
    }
    return { updated, failed };
  };

  const removeEverywhere = async (kind: TaxonomyKind, label: string) => setConfirm({ kind, label });

  const closeConfirm = useCallback(() => setConfirm(null), []);

  const confirmRemove = async () => {
    if (!confirm) return;
    const { kind, label } = confirm;
    setConfirm(null);
    if (busy) return;
    showActionToast('Updating…', 'neutral');
    setBusy(true);
    setPendingRemovals((prev) => {
      const next = { category: new Set(prev.category), skill: new Set(prev.skill) };
      next[kind].add(lower(label));
      return next;
    });
    try {
      // 1) Remove from presets (both buckets) and write to Firestore.
      if (kind === 'category') {
        const k = lower(label);
        const nextCats = normalizeCatalogCategoryPresets({
          mainPills: categoryPresets.mainPills.filter((x) => lower(x) !== k),
          moreTopics: categoryPresets.moreTopics.filter((x) => lower(x) !== k),
        });
        await saveCatalogCategoryPresets(nextCats);
        removeCatalogCategoryExtra(label);
        onPresetsChanged({ categories: nextCats, skills: skillPresets });
      } else {
        const k = lower(label);
        const nextSkills = normalizeCatalogSkillPresets({
          mainPills: skillPresets.mainPills.filter((x) => lower(x) !== k),
          moreSkills: skillPresets.moreSkills.filter((x) => lower(x) !== k),
        });
        await saveCatalogSkillPresets(nextSkills);
        removeCatalogSkillExtra(label);
        onPresetsChanged({ categories: categoryPresets, skills: nextSkills });
      }

      // 2) Remove from all courses.
      const courseUpdate = await updateCoursesEverywhere(kind, label, undefined);
      await onRefreshList();
      await onCatalogChanged();
      showActionToast(`Removed ${label} everywhere.${formatUpdatedCoursesToastSuffix(courseUpdate.updated)}`);
    } finally {
      setBusy(false);
      setPendingRemovals((prev) => {
        const next = { category: new Set(prev.category), skill: new Set(prev.skill) };
        next[kind].delete(lower(label));
        return next;
      });
    }
  };

  useBodyScrollLock(confirmOpen);
  useDialogKeyboard({
    open: confirmOpen,
    onClose: closeConfirm,
    onPrimaryAction: () => void confirmRemove(),
  });

  const addEverywhere = async (kind: TaxonomyKind, name: string) => {
    if (busy) return;
    const t = name.trim();
    if (!t) return;
    showActionToast('Updating…', 'neutral');
    setBusy(true);
    try {
      // Adds go into the "more" bucket to avoid changing curated ordering.
      if (kind === 'category') {
        const nextCats = normalizeCatalogCategoryPresets({
          mainPills: categoryPresets.mainPills,
          moreTopics: [...categoryPresets.moreTopics, t],
        });
        await saveCatalogCategoryPresets(nextCats);
        onPresetsChanged({ categories: nextCats, skills: skillPresets });
      } else {
        const nextSkills = normalizeCatalogSkillPresets({
          mainPills: skillPresets.mainPills,
          moreSkills: [...skillPresets.moreSkills, t],
        });
        await saveCatalogSkillPresets(nextSkills);
        onPresetsChanged({ categories: categoryPresets, skills: nextSkills });
      }
      await onCatalogChanged();
      showActionToast(`Added ${t}.`);
    } finally {
      setBusy(false);
    }
  };

  const renameEverywhere = async (kind: TaxonomyKind, fromExact: string, toExact: string) => {
    if (busy) return;
    const from = fromExact.trim();
    const to = toExact.trim();
    if (!from || !to) return;
    showActionToast('Updating…', 'neutral');
    setBusy(true);
    setPendingRenames((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], [lower(from)]: to },
    }));
    try {
      // 1) Presets + extras.
      if (kind === 'category') {
        const fk = lower(from);
        const nextCats = normalizeCatalogCategoryPresets({
          mainPills: categoryPresets.mainPills.map((x) => (lower(x) === fk ? to : x)),
          moreTopics: categoryPresets.moreTopics.map((x) => (lower(x) === fk ? to : x)),
        });
        await saveCatalogCategoryPresets(nextCats);
        replaceCatalogCategoryExtra(from, to);
        onPresetsChanged({ categories: nextCats, skills: skillPresets });
      } else {
        const fk = lower(from);
        const nextSkills = normalizeCatalogSkillPresets({
          mainPills: skillPresets.mainPills.map((x) => (lower(x) === fk ? to : x)),
          moreSkills: skillPresets.moreSkills.map((x) => (lower(x) === fk ? to : x)),
        });
        await saveCatalogSkillPresets(nextSkills);
        replaceCatalogSkillExtra(from, to);
        onPresetsChanged({ categories: categoryPresets, skills: nextSkills });
      }

      // 2) Courses.
      const courseUpdate = await updateCoursesEverywhere(kind, from, to);
      await onRefreshList();
      await onCatalogChanged();
      showActionToast(`Renamed ${from} → ${to}.${formatUpdatedCoursesToastSuffix(courseUpdate.updated)}`);
    } finally {
      setBusy(false);
      setPendingRenames((prev) => {
        const nextKind = { ...prev[kind] };
        delete nextKind[lower(from)];
        return { ...prev, [kind]: nextKind };
      });
    }
  };

  return (
    <div className="space-y-4">
      <TaxonomySection
        title="Categories"
        tipId="admin-taxonomy-categories-tip"
        tip={
          <>
            <li>Search to add, rename, or remove everywhere.</li>
            <li>Click a chip to edit it in place.</li>
            <li>Click × to remove from all courses, presets, and extras.</li>
          </>
        }
        kind="category"
        items={categoryItems}
        busy={busy}
        onAddEverywhere={(name) => addEverywhere('category', name)}
        onRenameEverywhere={(from, to) => renameEverywhere('category', from, to)}
        onRemoveEverywhere={(name) => removeEverywhere('category', name)}
      />

      <TaxonomySection
        title="Skills"
        tipId="admin-taxonomy-skills-tip"
        tip={
          <>
            <li>Same UX as categories.</li>
            <li>Removing deletes the skill from all courses, presets, and extras.</li>
          </>
        }
        kind="skill"
        items={skillItems}
        busy={busy}
        onAddEverywhere={(name) => addEverywhere('skill', name)}
        onRenameEverywhere={(from, to) => renameEverywhere('skill', from, to)}
        onRemoveEverywhere={(name) => removeEverywhere('skill', name)}
      />

      <AnimatePresence>
        {confirm ? (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-taxonomy-remove-title"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                <h2 id="admin-taxonomy-remove-title" className="text-xl font-bold text-[var(--text-primary)]">
                  Remove everywhere?
                </h2>
                <button
                  type="button"
                  onClick={closeConfirm}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  This will remove <strong className="text-[var(--text-primary)]">{confirm.label}</strong> from all courses,
                  presets, and quick-pick extras.
                </p>
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeConfirm}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] disabled:opacity-40 sm:w-auto"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    autoFocus
                    disabled={busy}
                    onClick={() => void confirmRemove()}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-red-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:opacity-40 sm:w-auto"
                  >
                    <Trash2 size={18} className="mr-2" aria-hidden />
                    Remove
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

