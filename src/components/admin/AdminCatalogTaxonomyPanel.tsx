import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Check, Cog, Search, Tag, Trash2, X } from 'lucide-react';
import { auth } from '../../firebase';
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
import {
  mergeUniverseWithAdminOrder,
  orderWithoutLabel,
  readCatalogTaxonomyAdminOrder,
  writeCatalogTaxonomyAdminOrder,
} from '../../utils/catalogTaxonomyAdminOrder';
import {
  buildCategorySkillUsageMaps,
  courseCountForCategoryLabel,
  courseCountForSkillLabel,
  formatTaxonomyUsageCountDisplay,
} from '../../utils/catalogPopularUsage';
import type { CatalogTaxonomyProposal } from '../../utils/catalogTaxonomyProposalsFirestore';
import {
  approveTaxonomyProposalAndMerge,
  createTaxonomyProposal,
  deleteTaxonomyProposal,
  setTaxonomyProposalRejected,
  subscribeMyPendingTaxonomyProposals,
  subscribePendingTaxonomyProposals,
} from '../../utils/catalogTaxonomyProposalsFirestore';

type TaxonomyKind = 'category' | 'skill';

/**
 * Chip list viewport height (~4 rows: size-11 row + gap-1.5 between items).
 * Keeps Categories & Skills compact on mobile; additional labels scroll inside the section.
 */
const TAXONOMY_CHIP_LIST_MAX_H =
  'max-h-[min(15.25rem,calc(50dvh-6rem))] sm:max-h-[min(14.875rem,calc(45dvh-5rem))]';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

function displayCourseLabelWithId(c: Course): string {
  const t = (c.title ?? '').trim();
  const base = t ? t : c.id;
  return `${base} (${c.id})`;
}

/** Courses that reference this category (case-insensitive). */
function coursesUsingLabelInCategories(courses: readonly Course[], label: string): Course[] {
  const k = lower(label);
  return courses.filter((c) => (c.categories ?? []).some((x) => lower(x) === k));
}

/** Courses that reference this skill (case-insensitive). */
function coursesUsingLabelInSkills(courses: readonly Course[], label: string): Course[] {
  const k = lower(label);
  return courses.filter((c) => (c.skills ?? []).some((x) => lower(x) === k));
}

/**
 * Removing this label would leave `categories: []`, which Firestore rules reject for both
 * `publishedCourses` and `creatorCourses` (`categories.size() > 0`).
 */
function coursesWithOnlyThisCategory(courses: readonly Course[], label: string): Course[] {
  const k = lower(label);
  return courses.filter((c) => {
    const arr = c.categories ?? [];
    if (arr.length !== 1) return false;
    return lower(arr[0]!) === k;
  });
}

function formatBlockedCategoryRemovalMessage(blocked: readonly Course[], label: string): string {
  const max = 6;
  const shown = blocked.slice(0, max);
  const lines = shown.map((c, i) => `${i + 1}. ${displayCourseLabelWithId(c)}`);
  const tail = blocked.length > max ? ` …and ${blocked.length - max} more.` : '';
  return (
    `Can’t remove “${label}”: every course needs at least one category (same rule for published courses and creator drafts). ` +
    `These only have that label—open each in Catalog, add or change categories, then remove the label here.\n\n` +
    `${lines.join('\n')}${tail}`
  );
}

function formatCourseSaveFailedMessage(kind: TaxonomyKind, failed: Course): string {
  const who = displayCourseLabelWithId(failed);
  if (kind === 'category') {
    return (
      `Could not update ${who}. Firestore often shows “missing permissions” when the write is invalid—for example ` +
      `if a course would end up with zero categories (published and creator drafts must each keep at least one). ` +
      `Fix the course in Catalog, then retry.`
    );
  }
  return `Could not update ${who}. Check your connection and permissions, then try again.`;
}

function removingWouldDeleteLastMainPill(mainPills: readonly string[], label: string): boolean {
  const k = lower(label);
  const remaining = mainPills.filter((x) => lower(x) !== k);
  return remaining.length === 0 && mainPills.some((x) => lower(x) === k);
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

/** Dedupe case-insensitively; keep first-seen casing and source order (no alphabetical sort). */
function uniqueCaseInsensitivePreserveOrder(list: readonly string[]): string[] {
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
  return out;
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
  /** Dense taxonomy row: no outer chip border (parent supplies the shell). */
  frameless?: boolean;
  /** Softer remove control (dense taxonomy lists). */
  mutedActions?: boolean;
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
  frameless,
  mutedActions,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className={
        frameless
          ? 'inline-flex max-w-full items-center gap-2 px-1 py-1'
          : 'inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--hover-bg)]/60 px-2.5 py-1.5'
      }
    >
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
            className="min-h-8 w-auto min-w-[6ch] bg-transparent px-0 py-0 text-xs font-semibold text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] disabled:opacity-40"
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
      <button
        type="button"
        disabled={disabled || editing}
        onClick={onRemove}
        className={
          mutedActions
            ? 'inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-[var(--text-muted)]/50 transition-colors hover:bg-[#757676]/12 hover:text-[#a1a2a2] disabled:opacity-40'
            : 'inline-flex min-h-8 min-w-8 items-center justify-center rounded-full text-[#a1a2a2] hover:bg-[#757676]/12 disabled:opacity-40'
        }
        aria-label={`Remove ${label} everywhere`}
        title="Remove everywhere"
      >
        <X size={mutedActions ? 15 : 16} aria-hidden />
      </button>
    </div>
  );
};

function TaxonomySection({
  title,
  kind,
  items,
  busy,
  globalFilterText,
  readOnlyTaxonomy,
  pendingProposals,
  showAdminProposalActions,
  showCreatorWithdrawActions,
  listLayout = 'wrap',
  headerCount,
  onRenameEverywhere,
  onRemoveEverywhere,
  courseUsageCount,
  onApproveProposal,
  onRejectProposal,
  onWithdrawProposal,
}: {
  title: string;
  kind: TaxonomyKind;
  items: readonly string[];
  busy: boolean;
  globalFilterText: string;
  readOnlyTaxonomy: boolean;
  pendingProposals: readonly CatalogTaxonomyProposal[];
  showAdminProposalActions: boolean;
  showCreatorWithdrawActions: boolean;
  /** `grid`: two columns of chips from `sm` up (course catalog taxonomy mock). */
  listLayout?: 'wrap' | 'grid';
  /** Optional count pill in the section header (e.g. total labels). */
  headerCount?: number;
  onRenameEverywhere: (fromExact: string, toExact: string) => Promise<void>;
  onRemoveEverywhere: (name: string) => Promise<void>;
  /** Number of catalog courses using this label (categories vs skills per `kind`). */
  courseUsageCount: (label: string) => number;
  onApproveProposal: (p: CatalogTaxonomyProposal) => void;
  onRejectProposal: (p: CatalogTaxonomyProposal) => void;
  onWithdrawProposal: (p: CatalogTaxonomyProposal) => void;
}) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const globalTrimmed = globalFilterText.trim();

  const filtered = useMemo(() => {
    let base = items;
    if (globalTrimmed) base = base.filter((x) => includesCI(x, globalTrimmed));
    return base;
  }, [items, globalTrimmed]);

  /** Always show pending rows (do not hide behind global search — admins must always see Approve/Reject). */
  const pendingVisible = pendingProposals;

  const startInlineEdit = (src: string) => {
    if (readOnlyTaxonomy) return;
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
    cancelInlineEdit();
  };

  const chipDisabled = busy || readOnlyTaxonomy;

  const chipListClassName =
    listLayout === 'grid'
      ? `grid min-h-0 ${TAXONOMY_CHIP_LIST_MAX_H} min-w-0 flex-1 grid-cols-1 content-start gap-1.5 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] sm:grid-cols-2`
      : `flex min-h-0 ${TAXONOMY_CHIP_LIST_MAX_H} min-w-0 flex-1 flex-col content-start gap-1.5 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]`;

  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-[var(--border-color)]/70 bg-[var(--bg-primary)]/25 p-3 sm:p-4">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{title}</h3>
        {headerCount != null ? (
          <span className="shrink-0 rounded-full border border-[var(--border-color)]/80 bg-[var(--bg-secondary)]/50 px-2 py-0.5 text-[11px] font-normal normal-case tracking-normal text-[var(--text-muted)] tabular-nums">
            {headerCount}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {pendingVisible.length > 0 ? (
          <div className="shrink-0 space-y-1.5">
            {pendingVisible.map((p) => (
              <div
                key={p.id}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-[#8b8c8c]/70 bg-[#757676]/10 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{p.label}</p>
                  <p className="text-[10px] font-medium text-[#616161] app-dark:text-[#cfcfcf]">Pending</p>
                </div>
                {showAdminProposalActions ? (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onApproveProposal(p)}
                      className="inline-flex min-h-9 min-w-[5rem] items-center justify-center gap-1 rounded-md bg-[#616161] px-2 text-xs font-semibold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40"
                    >
                      <Check size={14} aria-hidden />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRejectProposal(p)}
                      className="inline-flex min-h-9 min-w-[5rem] items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                ) : showCreatorWithdrawActions ? (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onWithdrawProposal(p)}
                      className="inline-flex min-h-9 min-w-[6rem] items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
                    >
                      Withdraw
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className={chipListClassName}>
          {filtered.map((label) => {
            const n = courseUsageCount(label);
            return (
              <div
                key={label.toLowerCase()}
                className="group/chip flex w-full max-w-full min-w-0 items-center gap-2 rounded-lg border border-[var(--border-color)]/55 bg-[var(--bg-secondary)]/35 py-1 pl-2 pr-2"
              >
                <span
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-[var(--text-muted)]"
                  aria-hidden
                >
                  {kind === 'category' ? <Tag size={17} strokeWidth={1.75} /> : <Cog size={17} strokeWidth={1.75} />}
                </span>
                <div className="min-w-0 flex-1 self-center border-0 bg-transparent">
                  <Chip
                    label={label}
                    editing={editingLabel != null && lower(editingLabel) === lower(label)}
                    editValue={editingLabel != null && lower(editingLabel) === lower(label) ? editingValue : label}
                    onEditStart={() => startInlineEdit(label)}
                    onEditChange={setEditingValue}
                    onEditCommit={() => void commitInlineEdit()}
                    onEditCancel={cancelInlineEdit}
                    disabled={chipDisabled}
                    onRemove={() => void onRemoveEverywhere(label)}
                    frameless
                    mutedActions
                  />
                </div>
                <span
                  className="shrink-0 tabular-nums text-xs font-semibold tracking-tight text-[var(--text-primary)]"
                  title={`${n} course${n === 1 ? '' : 's'}`}
                >
                  {formatTaxonomyUsageCountDisplay(n)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
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
  isCreatorCatalog = false,
}: {
  publishedList: Course[];
  categoryPresets: CatalogCategoryPresetsState;
  skillPresets: CatalogSkillPresetsState;
  onPresetsChanged: (next: { categories: CatalogCategoryPresetsState; skills: CatalogSkillPresetsState }) => void;
  onSaveCourse: (course: Course) => Promise<boolean>;
  onRefreshList: () => Promise<Course[]>;
  onCatalogChanged: () => void | Promise<void>;
  showActionToast: (msg: string, variant?: 'neutral' | 'danger') => void;
  /** When true, global presets are read-only; creators submit proposals instead of mutating presets. */
  isCreatorCatalog?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: TaxonomyKind;
    label: string;
    linkedCourses: Course[];
    /** Category only: courses that only have this category—removal is blocked until they get another. */
    blockedCourses: Course[];
  } | null>(null);
  const confirmOpen = confirm != null;
  const [pendingRenames, setPendingRenames] = useState<{ category: Record<string, string>; skill: Record<string, string> }>(
    () => ({ category: {}, skill: {} })
  );
  const [pendingRemovals, setPendingRemovals] = useState<{ category: Set<string>; skill: Set<string> }>(() => ({
    category: new Set(),
    skill: new Set(),
  }));
  /** Bumps when admin display order (localStorage) changes so merged lists recompute. */
  const [orderRevision, setOrderRevision] = useState(0);
  const [globalQuery, setGlobalQuery] = useState('');
  const [debouncedGlobal, setDebouncedGlobal] = useState('');
  const [authUid, setAuthUid] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  const [taxonomyProposals, setTaxonomyProposals] = useState<CatalogTaxonomyProposal[]>([]);
  const [suggestTargetKind, setSuggestTargetKind] = useState<TaxonomyKind | null>(null);
  const [headerSuggestBusy, setHeaderSuggestBusy] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setAuthUid(u?.uid ?? null));
  }, []);

  useEffect(() => {
    const trimmed = globalQuery.trim();
    if (!trimmed) {
      setDebouncedGlobal('');
      return;
    }
    const id = window.setTimeout(() => setDebouncedGlobal(trimmed), 200);
    return () => window.clearTimeout(id);
  }, [globalQuery]);

  useEffect(() => {
    if (isCreatorCatalog) {
      if (!authUid) {
        setTaxonomyProposals([]);
        return undefined;
      }
      return subscribeMyPendingTaxonomyProposals(authUid, setTaxonomyProposals, () =>
        showActionToast('Could not load your taxonomy proposals. Check the connection or Firestore rules.', 'danger')
      );
    }
    return subscribePendingTaxonomyProposals(setTaxonomyProposals, () =>
      showActionToast('Could not load pending taxonomy proposals (index or permissions).', 'danger')
    );
  }, [isCreatorCatalog, authUid, showActionToast]);

  const pendingCategoryProposals = useMemo(
    () => taxonomyProposals.filter((p) => p.kind === 'category'),
    [taxonomyProposals]
  );
  const pendingSkillProposals = useMemo(
    () => taxonomyProposals.filter((p) => p.kind === 'skill'),
    [taxonomyProposals]
  );

  const clearAllSearches = useCallback(() => {
    setGlobalQuery('');
    setDebouncedGlobal('');
  }, []);

  const showClearAllSearches = globalQuery.trim().length > 0;

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
    const universe = uniqueCaseInsensitivePreserveOrder(
      applyPending('category', [...preset, ...extras, ...discovered])
    );
    return mergeUniverseWithAdminOrder(universe, readCatalogTaxonomyAdminOrder('category'));
  }, [
    categoryPresets.mainPills,
    categoryPresets.moreTopics,
    taxonomy.topics.more,
    applyPending,
    orderRevision,
  ]);

  const skillItems = useMemo(() => {
    const preset = [...skillPresets.mainPills, ...skillPresets.moreSkills];
    const extras = readCatalogSkillExtras();
    const discovered = taxonomy.skills.more;
    const universe = uniqueCaseInsensitivePreserveOrder(
      applyPending('skill', [...preset, ...extras, ...discovered])
    );
    return mergeUniverseWithAdminOrder(universe, readCatalogTaxonomyAdminOrder('skill'));
  }, [skillPresets.mainPills, skillPresets.moreSkills, taxonomy.skills.more, applyPending, orderRevision]);

  const catalogUsageMaps = useMemo(() => buildCategorySkillUsageMaps(publishedList), [publishedList]);

  const suggestProposal = useCallback(
    async (kind: TaxonomyKind, label: string): Promise<boolean> => {
      if (!authUid) {
        showActionToast('Sign in to suggest a label.', 'danger');
        return false;
      }
      const t = label.trim();
      const k = lower(t);
      const universe = kind === 'category' ? categoryItems : skillItems;
      if (universe.some((x) => lower(x) === k)) {
        showActionToast('That label is already in the catalog.', 'neutral');
        return false;
      }
      if (taxonomyProposals.some((p) => p.kind === kind && lower(p.label) === k)) {
        showActionToast('A pending proposal already exists for this label.', 'neutral');
        return false;
      }
      const r = await createTaxonomyProposal(kind, t, authUid);
      if (r.ok === false) {
        showActionToast(r.error, 'danger');
        return false;
      }
      showActionToast(`Submitted “${t}” for admin review.`, 'neutral');
      return true;
    },
    [authUid, categoryItems, skillItems, taxonomyProposals, showActionToast]
  );

  const suggestDraftTrimmed = globalQuery.trim();
  const headerSearchTrimmed = debouncedGlobal.trim();

  /** Row visibility: wait for debounced search so the block does not flash while typing. */
  const canSuggestAsCategoryDebounced =
    isCreatorCatalog &&
    headerSearchTrimmed.length > 0 &&
    !headerSuggestBusy &&
    !categoryItems.some((x) => lower(x) === lower(headerSearchTrimmed)) &&
    !pendingCategoryProposals.some((p) => lower(p.label) === lower(headerSearchTrimmed));
  const canSuggestAsSkillDebounced =
    isCreatorCatalog &&
    headerSearchTrimmed.length > 0 &&
    !headerSuggestBusy &&
    !skillItems.some((x) => lower(x) === lower(headerSearchTrimmed)) &&
    !pendingSkillProposals.some((p) => lower(p.label) === lower(headerSearchTrimmed));
  const showSuggestHeaderRow = canSuggestAsCategoryDebounced || canSuggestAsSkillDebounced;

  /** Submit button: use live input so Enter works without waiting for debounce. */
  const canSuggestAsCategoryNow =
    isCreatorCatalog &&
    suggestDraftTrimmed.length > 0 &&
    !headerSuggestBusy &&
    !categoryItems.some((x) => lower(x) === lower(suggestDraftTrimmed)) &&
    !pendingCategoryProposals.some((p) => lower(p.label) === lower(suggestDraftTrimmed));
  const canSuggestAsSkillNow =
    isCreatorCatalog &&
    suggestDraftTrimmed.length > 0 &&
    !headerSuggestBusy &&
    !skillItems.some((x) => lower(x) === lower(suggestDraftTrimmed)) &&
    !pendingSkillProposals.some((p) => lower(p.label) === lower(suggestDraftTrimmed));

  const showHeaderSuggest =
    suggestTargetKind === 'category'
      ? canSuggestAsCategoryNow
      : suggestTargetKind === 'skill'
        ? canSuggestAsSkillNow
        : false;

  const headerSuggestBlockedHint =
    showSuggestHeaderRow &&
    suggestDraftTrimmed.length > 0 &&
    !showHeaderSuggest &&
    !headerSuggestBusy &&
    suggestTargetKind != null
      ? suggestTargetKind === 'category'
        ? pendingCategoryProposals.some((p) => lower(p.label) === lower(suggestDraftTrimmed))
          ? 'Already pending for this label.'
          : categoryItems.some((x) => lower(x) === lower(suggestDraftTrimmed))
            ? 'Already listed as a category.'
            : null
        : pendingSkillProposals.some((p) => lower(p.label) === lower(suggestDraftTrimmed))
          ? 'Already pending for this label.'
          : skillItems.some((x) => lower(x) === lower(suggestDraftTrimmed))
            ? 'Already listed as a skill.'
            : null
      : null;

  useEffect(() => {
    if (!showSuggestHeaderRow) {
      setSuggestTargetKind(null);
      return;
    }
    setSuggestTargetKind((prev) => {
      if (prev === 'category' && canSuggestAsCategoryDebounced) return 'category';
      if (prev === 'skill' && canSuggestAsSkillDebounced) return 'skill';
      if (canSuggestAsCategoryDebounced) return 'category';
      if (canSuggestAsSkillDebounced) return 'skill';
      return 'category';
    });
  }, [showSuggestHeaderRow, canSuggestAsCategoryDebounced, canSuggestAsSkillDebounced]);

  const submitHeaderSuggest = useCallback(async () => {
    const t = globalQuery.trim();
    if (!isCreatorCatalog || !t || headerSuggestBusy) return;
    if (suggestTargetKind !== 'category' && suggestTargetKind !== 'skill') return;
    const k = lower(t);
    const canSubmit =
      suggestTargetKind === 'category'
        ? !categoryItems.some((x) => lower(x) === k) && !pendingCategoryProposals.some((p) => lower(p.label) === k)
        : !skillItems.some((x) => lower(x) === k) && !pendingSkillProposals.some((p) => lower(p.label) === k);
    if (!canSubmit) return;
    setHeaderSuggestBusy(true);
    try {
      const ok = await suggestProposal(suggestTargetKind, t);
      if (ok) {
        setGlobalQuery('');
        setDebouncedGlobal('');
      }
    } finally {
      setHeaderSuggestBusy(false);
    }
  }, [
    isCreatorCatalog,
    globalQuery,
    headerSuggestBusy,
    suggestTargetKind,
    categoryItems,
    skillItems,
    pendingCategoryProposals,
    pendingSkillProposals,
    suggestProposal,
  ]);

  const handleApproveProposal = useCallback(
    async (p: CatalogTaxonomyProposal) => {
      if (!authUid) return;
      setBusy(true);
      try {
        const r = await approveTaxonomyProposalAndMerge(p, categoryPresets, skillPresets, authUid);
        if (r.ok === false) {
          showActionToast(r.error, 'danger');
          return;
        }
        const k = lower(p.label.trim());
        if (p.kind === 'category') {
          const already = categoryPresets.moreTopics.some((x) => lower(x) === k);
          if (!already) {
            const nextCats = normalizeCatalogCategoryPresets({
              mainPills: categoryPresets.mainPills,
              moreTopics: [...categoryPresets.moreTopics, p.label.trim()],
            });
            onPresetsChanged({ categories: nextCats, skills: skillPresets });
          }
        } else {
          const already = skillPresets.moreSkills.some((x) => lower(x) === k);
          if (!already) {
            const nextSkills = normalizeCatalogSkillPresets({
              mainPills: skillPresets.mainPills,
              moreSkills: [...skillPresets.moreSkills, p.label.trim()],
            });
            onPresetsChanged({ categories: categoryPresets, skills: nextSkills });
          }
        }
        await onCatalogChanged();
        showActionToast(`Approved “${p.label.trim()}”.`, 'neutral');
      } finally {
        setBusy(false);
      }
    },
    [authUid, categoryPresets, skillPresets, onPresetsChanged, onCatalogChanged, showActionToast]
  );

  const handleRejectProposal = useCallback(
    async (p: CatalogTaxonomyProposal) => {
      if (!authUid) return;
      if (!window.confirm(`Reject proposal “${p.label}”?`)) return;
      setBusy(true);
      try {
        const ok = await setTaxonomyProposalRejected(p.id, authUid);
        if (!ok) showActionToast('Could not reject proposal.', 'danger');
        else showActionToast(`Rejected “${p.label.trim()}”.`, 'neutral');
      } finally {
        setBusy(false);
      }
    },
    [authUid, showActionToast]
  );

  const handleWithdrawProposal = useCallback(
    async (p: CatalogTaxonomyProposal) => {
      if (!authUid) return;
      if (!isCreatorCatalog) return;
      setBusy(true);
      try {
        const ok = await deleteTaxonomyProposal(p.id);
        if (!ok) showActionToast('Could not withdraw proposal.', 'danger');
        else showActionToast(`Withdrew “${p.label.trim()}”.`, 'neutral');
      } finally {
        setBusy(false);
      }
    },
    [authUid, isCreatorCatalog, showActionToast]
  );

  const updateCoursesEverywhere = async (kind: TaxonomyKind, from: string, to?: string) => {
    const fromK = lower(from);
    if (kind === 'category' && !to) {
      const blocked = coursesWithOnlyThisCategory(publishedList, from);
      if (blocked.length > 0) {
        showActionToast(formatBlockedCategoryRemovalMessage(blocked, from), 'danger');
        return { updated: [] as Course[], failed: null as Course | null };
      }
    }

    const nextCourses = publishedList
      .map((c) => {
        const arr = kind === 'category' ? c.categories ?? [] : c.skills ?? [];
        const has = arr.some((x) => lower(x) === fromK);
        if (!has) return null;
        const nextArr = to
          ? dedupeLabelsPreserveOrder(arr.map((x) => (lower(x) === fromK ? to : x)))
          : arr.filter((x) => lower(x) !== fromK);
        if (kind === 'category' && !to && nextArr.length === 0) return null;
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

    return { updated, failed };
  };

  const closeConfirm = useCallback(() => setConfirm(null), []);

  const performRemovalWork = async (kind: TaxonomyKind, label: string) => {
    if (isCreatorCatalog) return;
    if (busy) return;

    if (kind === 'category') {
      const blocked = coursesWithOnlyThisCategory(publishedList, label);
      if (blocked.length > 0) {
        showActionToast(formatBlockedCategoryRemovalMessage(blocked, label), 'danger');
        return;
      }
      if (removingWouldDeleteLastMainPill(categoryPresets.mainPills, label)) {
        showActionToast(
          'Can’t remove the last “Popular topic” (main pill). Add another main topic under Topic presets first.',
          'danger'
        );
        return;
      }
    } else {
      if (removingWouldDeleteLastMainPill(skillPresets.mainPills, label)) {
        showActionToast(
          'Can’t remove the last main skill pill. Add another main skill under Skill presets first.',
          'danger'
        );
        return;
      }
    }

    showActionToast('Updating…', 'neutral');
    setBusy(true);
    setPendingRemovals((prev) => {
      const next = { category: new Set(prev.category), skill: new Set(prev.skill) };
      next[kind].add(lower(label));
      return next;
    });
    try {
      // 1) Courses first so we never strip presets then fail on invalid course writes (empty categories, etc.).
      const courseUpdate = await updateCoursesEverywhere(kind, label, undefined);
      if (courseUpdate.failed) {
        showActionToast(formatCourseSaveFailedMessage(kind, courseUpdate.failed), 'danger');
        return;
      }

      // 2) Presets + extras
      if (kind === 'category') {
        const k = lower(label);
        const nextCats = normalizeCatalogCategoryPresets({
          mainPills: categoryPresets.mainPills.filter((x) => lower(x) !== k),
          moreTopics: categoryPresets.moreTopics.filter((x) => lower(x) !== k),
        });
        await saveCatalogCategoryPresets(nextCats);
        removeCatalogCategoryExtra(label);
        onPresetsChanged({ categories: nextCats, skills: skillPresets });
        const co = readCatalogTaxonomyAdminOrder('category');
        if (co) writeCatalogTaxonomyAdminOrder('category', orderWithoutLabel(co, label));
      } else {
        const k = lower(label);
        const nextSkills = normalizeCatalogSkillPresets({
          mainPills: skillPresets.mainPills.filter((x) => lower(x) !== k),
          moreSkills: skillPresets.moreSkills.filter((x) => lower(x) !== k),
        });
        await saveCatalogSkillPresets(nextSkills);
        removeCatalogSkillExtra(label);
        onPresetsChanged({ categories: categoryPresets, skills: nextSkills });
        const so = readCatalogTaxonomyAdminOrder('skill');
        if (so) writeCatalogTaxonomyAdminOrder('skill', orderWithoutLabel(so, label));
      }

      setOrderRevision((r) => r + 1);
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

  const removeEverywhere = (kind: TaxonomyKind, label: string) => {
    if (isCreatorCatalog) return;
    if (busy) return;
    const linked =
      kind === 'category'
        ? coursesUsingLabelInCategories(publishedList, label)
        : coursesUsingLabelInSkills(publishedList, label);
    if (linked.length === 0) {
      void performRemovalWork(kind, label);
      return;
    }
    const blockedCourses =
      kind === 'category' ? coursesWithOnlyThisCategory(publishedList, label) : [];
    setConfirm({ kind, label, linkedCourses: linked, blockedCourses });
  };

  const confirmRemove = () => {
    if (!confirm) return;
    const { kind, label, blockedCourses } = confirm;
    if (blockedCourses.length > 0) return;
    setConfirm(null);
    void performRemovalWork(kind, label);
  };

  useBodyScrollLock(confirmOpen);
  useDialogKeyboard({
    open: confirmOpen,
    onClose: closeConfirm,
    onPrimaryAction: () => void confirmRemove(),
  });

  const renameEverywhere = async (kind: TaxonomyKind, fromExact: string, toExact: string) => {
    if (isCreatorCatalog) return;
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
      // 1) Courses first so preset renames aren’t left inconsistent if a save fails.
      const courseUpdate = await updateCoursesEverywhere(kind, from, to);
      if (courseUpdate.failed) {
        showActionToast(formatCourseSaveFailedMessage(kind, courseUpdate.failed), 'danger');
        return;
      }

      // 2) Presets + extras.
      if (kind === 'category') {
        const fk = lower(from);
        const nextCats = normalizeCatalogCategoryPresets({
          mainPills: categoryPresets.mainPills.map((x) => (lower(x) === fk ? to : x)),
          moreTopics: categoryPresets.moreTopics.map((x) => (lower(x) === fk ? to : x)),
        });
        await saveCatalogCategoryPresets(nextCats);
        replaceCatalogCategoryExtra(from, to);
        onPresetsChanged({ categories: nextCats, skills: skillPresets });
        const co = readCatalogTaxonomyAdminOrder('category');
        if (co) {
          writeCatalogTaxonomyAdminOrder(
            'category',
            co.map((x) => (lower(x) === lower(from) ? to : x))
          );
        }
      } else {
        const fk = lower(from);
        const nextSkills = normalizeCatalogSkillPresets({
          mainPills: skillPresets.mainPills.map((x) => (lower(x) === fk ? to : x)),
          moreSkills: skillPresets.moreSkills.map((x) => (lower(x) === fk ? to : x)),
        });
        await saveCatalogSkillPresets(nextSkills);
        replaceCatalogSkillExtra(from, to);
        onPresetsChanged({ categories: categoryPresets, skills: nextSkills });
        const so = readCatalogTaxonomyAdminOrder('skill');
        if (so) {
          writeCatalogTaxonomyAdminOrder(
            'skill',
            so.map((x) => (lower(x) === lower(from) ? to : x))
          );
        }
      }

      setOrderRevision((r) => r + 1);
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
    <div className="flex min-h-0 min-w-0 flex-col gap-3" aria-labelledby="admin-catalog-taxonomy-heading">
      <header className="rounded-xl border border-[var(--border-color)]/80 bg-[var(--bg-primary)]/50 p-3 sm:p-3.5">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 id="admin-catalog-taxonomy-heading" className="sr-only">
            Categories and skills
          </h2>
          <div className="flex min-w-0 w-full flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
            <div className="relative min-h-10 min-w-0 flex-1">
              <label className="sr-only" htmlFor="admin-taxonomy-global-search">
                Filter categories or skills
              </label>
              <Search
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                aria-hidden
              />
              <input
                id="admin-taxonomy-global-search"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    clearAllSearches();
                    return;
                  }
                  if (e.key === 'Enter' && showHeaderSuggest) {
                    e.preventDefault();
                    void submitHeaderSuggest();
                  }
                }}
                placeholder="Filter categories or skills…"
                className="h-10 w-full rounded-lg border border-[var(--border-color)]/90 bg-[var(--bg-secondary)]/55 py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--text-muted)]/65 focus:border-[#8b8c8c]/80 focus:ring-2 focus:ring-[#a1a2a2]/20 app-dark:bg-[#1c1c1c]/55"
              />
            </div>
            {showClearAllSearches ? (
              <button
                type="button"
                onClick={clearAllSearches}
                className="inline-flex h-10 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-admin-icon opacity-95 hover:bg-[#616161]/10 app-dark:hover:bg-[var(--tone-800)]"
              >
                Clear
              </button>
            ) : null}
          </div>

          {showSuggestHeaderRow ? (
            <div className="flex w-full min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--border-color)]/60 pt-3">
              <div className="flex min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Suggest as
                </span>
                <div
                  className="inline-flex rounded-full border border-[var(--border-color)]/70 bg-[var(--bg-secondary)]/25 p-0.5"
                  role="group"
                  aria-label="Suggest label kind"
                >
                  <button
                    type="button"
                    onClick={() => setSuggestTargetKind('category')}
                    className={`inline-flex min-h-9 min-w-0 items-center justify-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors ${
                      suggestTargetKind === 'category'
                        ? 'bg-[#214371] text-white shadow-sm app-dark:bg-[#214371] app-dark:text-white'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]/50 hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Tag size={14} strokeWidth={2} className="shrink-0 opacity-90" aria-hidden />
                    Category
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestTargetKind('skill')}
                    className={`inline-flex min-h-9 min-w-0 items-center justify-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors ${
                      suggestTargetKind === 'skill'
                        ? 'bg-[#214371] text-white shadow-sm app-dark:bg-[#214371] app-dark:text-white'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]/50 hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Cog size={14} strokeWidth={2} className="shrink-0 opacity-90" aria-hidden />
                    Skill
                  </button>
                </div>
                {showHeaderSuggest ? (
                  <button
                    type="button"
                    disabled={headerSuggestBusy}
                    onClick={() => void submitHeaderSuggest()}
                    className="inline-flex min-h-9 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg border border-[#8b8c8c]/75 bg-[#757676]/12 px-3 text-sm font-medium text-[#393a3a] hover:bg-[#757676]/18 disabled:opacity-40 app-dark:text-[#e7e7e7] sm:min-w-[10rem] sm:flex-none"
                  >
                    {headerSuggestBusy ? 'Submitting…' : `Suggest “${suggestDraftTrimmed}”`}
                  </button>
                ) : null}
              </div>
              {headerSuggestBlockedHint ? (
                <span
                  className="ml-auto w-full min-w-0 max-w-full shrink-0 text-end text-[11px] leading-snug text-[#393a3a] sm:w-auto sm:max-w-[min(100%,20rem)] app-dark:text-[#cfcfcf]"
                  role="status"
                >
                  {headerSuggestBlockedHint}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch lg:gap-4">
        <div className="min-h-0 min-w-0">
          <TaxonomySection
            title="Categories"
            kind="category"
            items={categoryItems}
            busy={busy}
            globalFilterText={debouncedGlobal}
            readOnlyTaxonomy={isCreatorCatalog}
            pendingProposals={pendingCategoryProposals}
            showAdminProposalActions={!isCreatorCatalog}
            showCreatorWithdrawActions={isCreatorCatalog}
            headerCount={categoryItems.length}
            onRenameEverywhere={(from, to) => renameEverywhere('category', from, to)}
            onRemoveEverywhere={async (name) => {
              removeEverywhere('category', name);
            }}
            courseUsageCount={(label) => courseCountForCategoryLabel(catalogUsageMaps, label)}
            onApproveProposal={(p) => void handleApproveProposal(p)}
            onRejectProposal={(p) => void handleRejectProposal(p)}
            onWithdrawProposal={(p) => void handleWithdrawProposal(p)}
          />
        </div>

        <div className="min-h-0 min-w-0">
          <TaxonomySection
            title="Skills"
            kind="skill"
            items={skillItems}
            busy={busy}
            globalFilterText={debouncedGlobal}
            readOnlyTaxonomy={isCreatorCatalog}
            pendingProposals={pendingSkillProposals}
            showAdminProposalActions={!isCreatorCatalog}
            showCreatorWithdrawActions={isCreatorCatalog}
            headerCount={skillItems.length}
            onRenameEverywhere={(from, to) => renameEverywhere('skill', from, to)}
            onRemoveEverywhere={async (name) => {
              removeEverywhere('skill', name);
            }}
            courseUsageCount={(label) => courseCountForSkillLabel(catalogUsageMaps, label)}
            onApproveProposal={(p) => void handleApproveProposal(p)}
            onRejectProposal={(p) => void handleRejectProposal(p)}
            onWithdrawProposal={(p) => void handleWithdrawProposal(p)}
          />
        </div>
      </div>

      <AnimatePresence>
        {confirm ? (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-[#272828]/75 p-4 backdrop-blur-sm"
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
                  Remove “{confirm.label}”?
                </h2>
                <button
                  type="button"
                  onClick={closeConfirm}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} aria-hidden />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {confirm.kind === 'category' ? (
                    <>
                      This category is on <strong className="text-[var(--text-primary)]">{confirm.linkedCourses.length}</strong>{' '}
                      course{confirm.linkedCourses.length === 1 ? '' : 's'}. Removing it will strip it from each of
                      those courses, plus topic presets and quick-picks.
                    </>
                  ) : (
                    <>
                      This skill is on <strong className="text-[var(--text-primary)]">{confirm.linkedCourses.length}</strong>{' '}
                      course{confirm.linkedCourses.length === 1 ? '' : 's'}. Removing it will strip it from each course,
                      plus skill presets and quick-picks.
                    </>
                  )}
                </p>
                {confirm.blockedCourses.length > 0 ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#8b8c8c]/80 bg-[#757676]/12 px-3 py-2.5 text-sm text-[var(--text-primary)]"
                  >
                    <strong className="font-semibold">Can’t remove yet:</strong> some courses below only have this
                    category. Add at least one other category in Catalog for each marked course, then try again.
                  </div>
                ) : null}
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    Linked courses
                  </p>
                  <ul
                    className="max-h-[min(50vh,20rem)] space-y-0 overflow-y-auto overscroll-y-contain rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-2 py-0 text-sm [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]"
                  >
                    {[...confirm.linkedCourses]
                      .sort((a, b) => {
                        const t = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
                        return t !== 0 ? t : a.id.localeCompare(b.id);
                      })
                      .map((c) => {
                        const blocked = confirm.blockedCourses.some((x) => x.id === c.id);
                        return (
                          <li
                            key={c.id}
                            className={
                              blocked
                                ? 'rounded-lg border border-[#8b8c8c]/75 bg-[#757676]/10 px-2.5 py-1.5 leading-snug'
                                : 'rounded-lg px-2.5 py-1 leading-snug'
                            }
                          >
                            <span className="font-medium text-[var(--text-primary)]">{displayCourseLabelWithId(c)}</span>
                            {blocked ? (
                              <span className="mt-1 block text-xs text-[#4c4d4d] app-dark:text-[#b8b8b8]">
                                Only category — add another in Catalog first
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                  </ul>
                </div>
                <p className="text-xs text-[var(--text-muted)]">Use the close control above to keep everything as-is.</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    autoFocus={confirm.blockedCourses.length === 0}
                    disabled={busy || confirm.blockedCourses.length > 0}
                    onClick={() => confirmRemove()}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#616161] disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
                  >
                    <Trash2 size={18} className="mr-2" aria-hidden />
                    Remove from courses &amp; presets
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

