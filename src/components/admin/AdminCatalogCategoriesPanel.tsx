import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Pencil, Tags, Trash2, X } from 'lucide-react';
import type { Course } from '../../data/courses';
import { savePublishedCourse } from '../../utils/publishedCoursesFirestore';
import {
  addCatalogCategoryExtra,
  CATALOG_CATEGORY_EXTRAS_CHANGED,
  readCatalogCategoryExtras,
  removeCatalogCategoryExtra,
  replaceCatalogCategoryExtra,
} from '../../utils/catalogCategoryExtras';
import { dedupeLabelsPreserveOrder } from '../../utils/courseTaxonomy';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import type { AdminActionToastVariant } from './useAdminActionToast';

function replaceLabelInCategories(categories: string[], fromLower: string, newExact: string): string[] {
  const next = categories.map((cat) =>
    cat.trim().toLowerCase() === fromLower ? newExact : cat
  );
  return dedupeLabelsPreserveOrder(next);
}

export type AdminCatalogCategoriesPanelProps = {
  publishedList: Course[];
  onRefreshList: () => Promise<Course[]>;
  onCatalogChanged: () => void | Promise<void>;
  showActionToast: (msg: string, variant?: AdminActionToastVariant) => void;
  /** Keeps an open course draft in sync when its category string was renamed everywhere. */
  onCategoryRenamedGlobally: (fromLower: string, newExact: string) => void;
  /** Firestore-backed preset list (popular + more topics). */
  presetCategoriesList: string[];
  /** First popular topic — fallback when reassigning. */
  defaultPresetCategory: string;
};

type CustomRow = {
  keyLower: string;
  display: string;
  courseCount: number;
  inExtras: boolean;
};

export const AdminCatalogCategoriesPanel: React.FC<AdminCatalogCategoriesPanelProps> = ({
  publishedList,
  onRefreshList,
  onCatalogChanged,
  showActionToast,
  onCategoryRenamedGlobally,
  presetCategoriesList,
  defaultPresetCategory,
}) => {
  const [extrasTick, setExtrasTick] = useState(0);
  const [renameModal, setRenameModal] = useState<CustomRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [reassignModal, setReassignModal] = useState<CustomRow | null>(null);
  const [reassignTarget, setReassignTarget] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = () => setExtrasTick((t) => t + 1);
    window.addEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, h);
  }, []);

  const presetLower = useMemo(
    () => new Set(presetCategoriesList.map((x) => x.toLowerCase())),
    [presetCategoriesList]
  );
  const presetList = presetCategoriesList;

  const customRows: CustomRow[] = useMemo(() => {
    const extras = readCatalogCategoryExtras();
    const map = new Map<string, string>();
    for (const e of extras) {
      const t = e.trim();
      if (!t || presetLower.has(t.toLowerCase())) continue;
      const k = t.toLowerCase();
      if (!map.has(k)) map.set(k, t);
    }
    for (const co of publishedList) {
      for (const raw of co.categories ?? []) {
        const t = raw?.trim();
        if (!t || presetLower.has(t.toLowerCase())) continue;
        const k = t.toLowerCase();
        if (!map.has(k)) map.set(k, t);
      }
    }
    return [...map.entries()]
      .map(([keyLower, display]) => ({
        keyLower,
        display,
        courseCount: publishedList.filter((c) =>
          (c.categories ?? []).some((cat) => cat.trim().toLowerCase() === keyLower)
        ).length,
        inExtras: extras.some((e) => e.trim().toLowerCase() === keyLower),
      }))
      .sort((a, b) => a.keyLower.localeCompare(b.keyLower));
  }, [publishedList, presetLower, extrasTick]);

  const reassignOptions = useMemo(() => {
    const s = new Set<string>(presetCategoriesList);
    for (const c of readCatalogCategoryExtras()) {
      const t = c.trim();
      if (t) s.add(t);
    }
    for (const co of publishedList) {
      for (const raw of co.categories ?? []) {
        const t = raw?.trim();
        if (t) s.add(t);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [publishedList, extrasTick, presetCategoriesList]);

  const openRename = (row: CustomRow) => {
    setRenameValue(row.display);
    setRenameModal(row);
  };

  const closeRename = useCallback(() => setRenameModal(null), []);

  const applyRename = useCallback(async () => {
    if (!renameModal || busy) return;
    const next = renameValue.trim();
    if (!next) {
      showActionToast('Enter a category name.', 'danger');
      return;
    }
    if (next.toLowerCase() === renameModal.keyLower) {
      closeRename();
      return;
    }
    setBusy(true);
    try {
      const affected = publishedList.filter((c) =>
        (c.categories ?? []).some((cat) => cat.trim().toLowerCase() === renameModal.keyLower)
      );
      let fail = 0;
      for (const c of affected) {
        const ok = await savePublishedCourse({
          ...c,
          categories: replaceLabelInCategories(c.categories ?? [], renameModal.keyLower, next),
        });
        if (!ok) fail += 1;
      }
      replaceCatalogCategoryExtra(renameModal.display, next);
      onCategoryRenamedGlobally(renameModal.keyLower, next);
      await onRefreshList();
      await onCatalogChanged();
      if (fail > 0) {
        showActionToast(`Renamed with ${fail} save error(s). Check console / permissions.`, 'danger');
      } else {
        showActionToast(
          affected.length > 0 ? `Updated category on ${affected.length} course(s).` : 'Saved category name.',
          'success'
        );
      }
      closeRename();
    } finally {
      setBusy(false);
    }
  }, [
    renameModal,
    renameValue,
    busy,
    publishedList,
    onRefreshList,
    onCatalogChanged,
    onCategoryRenamedGlobally,
    showActionToast,
    closeRename,
  ]);

  const closeReassign = useCallback(() => setReassignModal(null), []);

  const applyReassign = useCallback(async () => {
    if (!reassignModal || busy) return;
    const target = reassignTarget.trim();
    if (!target) {
      showActionToast('Choose a target category.', 'danger');
      return;
    }
    if (target.toLowerCase() === reassignModal.keyLower) {
      showActionToast('Pick a different category than the current one.', 'neutral');
      return;
    }
    setBusy(true);
    try {
      const affected = publishedList.filter((c) =>
        (c.categories ?? []).some((cat) => cat.trim().toLowerCase() === reassignModal.keyLower)
      );
      let fail = 0;
      for (const c of affected) {
        const ok = await savePublishedCourse({
          ...c,
          categories: replaceLabelInCategories(c.categories ?? [], reassignModal.keyLower, target),
        });
        if (!ok) fail += 1;
      }
      removeCatalogCategoryExtra(reassignModal.display);
      addCatalogCategoryExtra(target);
      onCategoryRenamedGlobally(reassignModal.keyLower, target);
      await onRefreshList();
      await onCatalogChanged();
      if (fail > 0) {
        showActionToast(`Reassigned with ${fail} save error(s).`, 'danger');
      } else {
        showActionToast(`Moved ${affected.length} course(s) to “${target}”.`, 'success');
      }
      closeReassign();
    } finally {
      setBusy(false);
    }
  }, [
    reassignModal,
    reassignTarget,
    busy,
    publishedList,
    onRefreshList,
    onCatalogChanged,
    onCategoryRenamedGlobally,
    showActionToast,
    closeReassign,
  ]);

  const removeQuickPick = (row: CustomRow) => {
    removeCatalogCategoryExtra(row.display);
    showActionToast('Removed from saved category list.', 'neutral');
  };

  const modalOpen = renameModal !== null || reassignModal !== null;
  useBodyScrollLock(modalOpen);

  useDialogKeyboard({
    open: renameModal !== null,
    onClose: closeRename,
    onPrimaryAction: () => void applyRename(),
  });

  useDialogKeyboard({
    open: reassignModal !== null,
    onClose: closeReassign,
    onPrimaryAction: () => void applyReassign(),
  });

  useEffect(() => {
    if (!reassignModal) return;
    const pick =
      reassignOptions.find((o) => o.toLowerCase() !== reassignModal.keyLower) ?? defaultPresetCategory;
    setReassignTarget(pick);
  }, [reassignModal, reassignOptions, defaultPresetCategory]);

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        <strong className="text-[var(--text-secondary)]">Preset</strong> categories are edited under the{' '}
        <strong className="text-[var(--text-secondary)]">Topic presets</strong> tab and power the library filter.{' '}
        <strong className="text-[var(--text-secondary)]">Custom</strong> names are anything else
        (saved when you publish a course or add one in Catalog). <strong className="text-[var(--text-secondary)]">
          Rename
        </strong>{' '}
        updates every published course that uses that label and your saved quick-picks.{' '}
        <strong className="text-[var(--text-secondary)]">Remove from saved list</strong> only unpins the name from this
        browser; courses keep their label until you reassign or edit them in{' '}
        <strong className="text-[var(--text-secondary)]">Catalog</strong>.
      </p>

      <section className="space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
          <Tags size={16} className="shrink-0 text-admin-icon" aria-hidden />
          Preset categories
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Change these lists in <strong className="text-[var(--text-secondary)]">Topic presets</strong>. In the Catalog
          editor, pick one of these or add a custom name.
        </p>
        <ul className="flex flex-wrap gap-2 pt-1">
          {presetList.map((p) => (
            <li
              key={p}
              className="rounded-full border border-[var(--border-light)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]"
            >
              {p}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Custom categories</h3>
        {customRows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            None yet. Publish a course with a new category or type one under Catalog → Category → Other.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-color)] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40">
            {customRows.map((row) => (
              <li
                key={row.keyLower}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{row.display}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {row.courseCount} course{row.courseCount === 1 ? '' : 's'}
                    {row.inExtras ? ' · In saved list' : ' · Not pinned (only on courses)'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openRename(row)}
                    disabled={busy}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] disabled:opacity-50"
                  >
                    <Pencil size={14} aria-hidden />
                    Rename…
                  </button>
                  {row.courseCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReassignModal(row);
                      }}
                      disabled={busy}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#8b8c8c]/90 px-3 py-2 text-xs font-semibold text-[#616161] hover:bg-[#616161]/10 app-dark:border-[var(--tone-400)] app-dark:text-[var(--tone-100)] app-dark:hover:bg-[var(--tone-800)] disabled:opacity-50"
                    >
                      Reassign courses…
                    </button>
                  ) : null}
                  {row.inExtras ? (
                    <button
                      type="button"
                      onClick={() => removeQuickPick(row)}
                      disabled={busy}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-50"
                    >
                      <Trash2 size={14} aria-hidden />
                      Remove from saved list
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AnimatePresence>
        {renameModal && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#272828]/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-cat-rename-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] p-4">
                <h2 id="admin-cat-rename-title" className="text-lg font-bold text-[var(--text-primary)]">
                  Rename category
                </h2>
                <button
                  type="button"
                  onClick={closeRename}
                  className="rounded-full p-2 hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3 p-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  Updates the category on every published course that currently uses “{renameModal.display}”.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">New name</span>
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    autoFocus
                  />
                </label>
                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeRename}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border-color)] px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyRename()}
                    disabled={busy}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#616161] px-4 py-2.5 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reassignModal && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#272828]/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-cat-reassign-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] p-4">
                <h2 id="admin-cat-reassign-title" className="text-lg font-bold text-[var(--text-primary)]">
                  Reassign courses
                </h2>
                <button
                  type="button"
                  onClick={closeReassign}
                  className="rounded-full p-2 hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3 p-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  Move all {reassignModal.courseCount} course{reassignModal.courseCount === 1 ? '' : 's'} from “
                  {reassignModal.display}” to another category. The old label is removed from your saved list.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">Target category</span>
                  <select
                    value={reassignTarget}
                    onChange={(e) => setReassignTarget(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  >
                    {reassignOptions
                      .filter((o) => o.toLowerCase() !== reassignModal.keyLower)
                      .map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeReassign}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border-color)] px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyReassign()}
                    disabled={busy}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#616161] px-4 py-2.5 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
                    Reassign
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
