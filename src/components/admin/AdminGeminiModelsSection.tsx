import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BrainCircuit, Loader2, RotateCcw, Save, Trash2 } from 'lucide-react';
import { getGeminiModelChain } from '../../utils/geminiModelEnv';
import {
  isValidGeminiModelIdInput,
  loadGeminiAiModelsForAdmin,
  MAX_GEMINI_MODEL_IDS,
  normalizeGeminiModelRows,
  saveGeminiAiModels,
  type GeminiModelAdminRow,
} from '../../utils/geminiModelSettingsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

interface AdminGeminiModelsSectionProps {
  onDirtyChange?: (dirty: boolean) => void;
}

/** Stable React key + focus target after reorder; stripped before save (normalize uses id/enabled only). */
type LocalModelRow = GeminiModelAdminRow & { _key: string };

function withKeys(rows: GeminiModelAdminRow[]): LocalModelRow[] {
  return rows.map((r) => ({ ...r, _key: crypto.randomUUID() }));
}

interface FocusReorderControl {
  rowKey: string;
  which: 'up' | 'down';
}

export const AdminGeminiModelsSection: React.FC<AdminGeminiModelsSectionProps> = ({ onDirtyChange }) => {
  const [rows, setRows] = useState<LocalModelRow[]>([]);
  const [baselineJson, setBaselineJson] = useState<string>('');
  const [fromFirestore, setFromFirestore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const { showActionToast, actionToast } = useAdminActionToast();
  const focusAfterReorderRef = useRef<FocusReorderControl | null>(null);

  const envDefaultChain = useMemo(() => getGeminiModelChain(), []);

  const reload = useCallback(async () => {
    setLoading(true);
    const { fromFirestore: fs, rows: loaded } = await loadGeminiAiModelsForAdmin();
    setFromFirestore(fs);
    setRows(withKeys(loaded));
    const normalized = normalizeGeminiModelRows(loaded);
    setBaselineJson(JSON.stringify(normalized));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const normalizedSnapshot = useMemo(() => normalizeGeminiModelRows(rows), [rows]);
  const enabledCount = useMemo(
    () => normalizedSnapshot.enabledFlags.filter(Boolean).length,
    [normalizedSnapshot.enabledFlags]
  );

  const isDirty = baselineJson !== '' && JSON.stringify(normalizedSnapshot) !== baselineJson;

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  const searchLower = addSearch.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !searchLower || row.id.toLowerCase().includes(searchLower));
  }, [rows, searchLower]);

  const setRowId = (i: number, v: string) => {
    setRows((prev) => prev.map((x, j) => (j === i ? { ...x, id: v } : x)));
  };

  const setRowEnabled = (i: number, enabled: boolean) => {
    setRows((prev) => prev.map((x, j) => (j === i ? { ...x, enabled } : x)));
  };

  const tryAddModelFromSearch = useCallback(() => {
    const q = addSearch.trim();
    if (!q) return;
    if (rows.length >= MAX_GEMINI_MODEL_IDS) {
      showActionToast(`Max ${MAX_GEMINI_MODEL_IDS} models.`, 'danger');
      return;
    }
    if (!isValidGeminiModelIdInput(q)) {
      showActionToast('Invalid id (use letters, numbers, . _ -).', 'danger');
      return;
    }
    const normalized = q.trim();
    if (rows.some((r) => r.id.trim() === normalized)) {
      showActionToast('Already in list.', 'danger');
      return;
    }
    setRows((prev) => [...prev, { id: normalized, enabled: true, _key: crypto.randomUUID() }]);
    setAddSearch('');
  }, [addSearch, rows, showActionToast]);

  const removeRow = (i: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  };

  const moveRow = (i: number, delta: -1 | 1, refocus: 'up' | 'down') => {
    const j = i + delta;
    if (j < 0 || j >= rows.length) return;
    const rowKey = rows[i]!._key;
    focusAfterReorderRef.current = { rowKey, which: refocus };
    setRows((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  useLayoutEffect(() => {
    const job = focusAfterReorderRef.current;
    if (!job) return;
    focusAfterReorderRef.current = null;
    const esc =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(job.rowKey)
        : job.rowKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const root = document.querySelector<HTMLElement>(`[data-model-row-key="${esc}"]`);
    if (!root) return;
    const upBtn = root.querySelector<HTMLButtonElement>('button[data-gemini-reorder="up"]');
    const downBtn = root.querySelector<HTMLButtonElement>('button[data-gemini-reorder="down"]');
    const primary = job.which === 'up' ? upBtn : downBtn;
    const secondary = job.which === 'up' ? downBtn : upBtn;
    const btn =
      primary && !primary.disabled
        ? primary
        : secondary && !secondary.disabled
          ? secondary
          : null;
    if (btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [rows]);

  const applyEnvDefaults = () => {
    setRows(withKeys(envDefaultChain.map((id) => ({ id, enabled: true }))));
  };

  const handleSave = async () => {
    const normalized = normalizeGeminiModelRows(rows);
    if (normalized.modelIds.length < 1) {
      showActionToast('Need at least one model id.', 'danger');
      return;
    }
    setSaving(true);
    const ok = await saveGeminiAiModels(rows.map(({ id, enabled }) => ({ id, enabled })));
    setSaving(false);
    if (ok) {
      showActionToast('Saved.');
      setBaselineJson(JSON.stringify(normalized));
      setFromFirestore(true);
    } else {
      showActionToast('Save failed.', 'danger');
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-3 sm:p-4">
      {actionToast}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Gemini model chain</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
            Order = fallback. <kbd className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 font-mono text-[10px]">Enter</kbd>{' '}
            adds id. No Firestore doc →{' '}
            <code className="font-mono text-[10px] text-orange-500/90">GEMINI_MODEL</code> env.
          </p>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            <span className="font-mono text-[var(--text-secondary)]">{envDefaultChain.join(' → ')}</span>
            {' · '}
            {fromFirestore ? (
              <span className="text-emerald-600 dark:text-emerald-400">Firestore</span>
            ) : (
              <span>env until first save</span>
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={saving || !isDirty}
          onClick={() => void handleSave()}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40 sm:self-auto"
        >
          {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
          Save
        </button>
      </div>

      {!loading && enabledCount === 0 && normalizedSnapshot.modelIds.length > 0 && (
        <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
          All models disabled — no API calls.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-color)] px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <input
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  tryAddModelFromSearch();
                }
              }}
              placeholder="Add or filter…"
              className="min-h-10 min-w-0 flex-1 rounded-md border-0 bg-transparent px-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-0"
              aria-label="Add or search model"
              aria-describedby="admin-models-add-hint"
            />
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-50"
              aria-label="Reload"
              title="Reload"
            >
              {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <RotateCcw size={18} aria-hidden />}
            </button>
          </div>
          <p id="admin-models-add-hint" className="mt-1 text-[10px] text-[var(--text-muted)]">
            Enter to add · typing filters rows · with ↑/↓ focused, Arrow keys reorder (page does not scroll)
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
            Loading…
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
            {rows.length === 0 ? 'Type an id, Enter.' : 'No matches.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-color)] p-0">
            {filteredRows.map(({ row, index: i }) => (
              <li
                key={row._key}
                data-model-row-key={row._key}
                className="flex flex-col gap-2 px-2.5 py-2.5 sm:flex-row sm:items-center sm:gap-2 sm:py-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <BrainCircuit size={16} className="shrink-0 text-[var(--text-muted)] opacity-80" aria-hidden />
                  <input
                    value={row.id}
                    onChange={(e) => setRowId(i, e.target.value)}
                    className="min-h-10 min-w-0 flex-1 border-0 bg-transparent font-mono text-sm text-[var(--text-primary)] focus:outline-none focus:ring-0"
                    aria-label={`Model ${i + 1}`}
                    spellCheck={false}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 sm:shrink-0 sm:justify-end">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      data-gemini-reorder="up"
                      onClick={() => moveRow(i, -1, 'up')}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                        if (e.altKey || e.ctrlKey || e.metaKey) return;
                        e.preventDefault();
                        if (e.key === 'ArrowUp' && i > 0) moveRow(i, -1, 'up');
                        if (e.key === 'ArrowDown' && i < rows.length - 1) moveRow(i, 1, 'down');
                      }}
                      disabled={i === 0}
                      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-25"
                      aria-label="Move up"
                    >
                      <ArrowUp size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      data-gemini-reorder="down"
                      onClick={() => moveRow(i, 1, 'down')}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                        if (e.altKey || e.ctrlKey || e.metaKey) return;
                        e.preventDefault();
                        if (e.key === 'ArrowUp' && i > 0) moveRow(i, -1, 'up');
                        if (e.key === 'ArrowDown' && i < rows.length - 1) moveRow(i, 1, 'down');
                      }}
                      disabled={i >= rows.length - 1}
                      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-25"
                      aria-label="Move down"
                    >
                      <ArrowDown size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1}
                      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-red-400/90 hover:bg-red-500/10 disabled:opacity-25"
                      aria-label="Remove"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.id || 'model'}`}
                    onClick={() => setRowEnabled(i, !row.enabled)}
                    className={`relative h-8 w-[3.25rem] shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                      row.enabled ? 'bg-emerald-500' : 'bg-[var(--border-color)]'
                    }`}
                  >
                    <span
                      className={`pointer-events-none absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                        row.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                    <span className="sr-only">{row.enabled ? 'On' : 'Off'}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[10px] text-[var(--text-muted)]">
        <button type="button" onClick={applyEnvDefaults} className="text-orange-500 hover:underline">
          Reset to env
        </button>
        {' · '}
        <a
          href="https://ai.google.dev/gemini-api/docs/models"
          target="_blank"
          rel="noreferrer"
          className="text-orange-500 hover:underline"
        >
          Docs
        </a>
        {' · max '}
        {MAX_GEMINI_MODEL_IDS}
      </p>
    </div>
  );
};
