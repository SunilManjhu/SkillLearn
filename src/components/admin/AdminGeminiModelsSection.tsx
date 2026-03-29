import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

export const AdminGeminiModelsSection: React.FC<AdminGeminiModelsSectionProps> = ({ onDirtyChange }) => {
  const [rows, setRows] = useState<GeminiModelAdminRow[]>([]);
  const [baselineJson, setBaselineJson] = useState<string>('');
  const [fromFirestore, setFromFirestore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const { showActionToast, actionToast } = useAdminActionToast();

  const envDefaultChain = useMemo(() => getGeminiModelChain(), []);

  const reload = useCallback(async () => {
    setLoading(true);
    const { fromFirestore: fs, rows: loaded } = await loadGeminiAiModelsForAdmin();
    setFromFirestore(fs);
    setRows(loaded);
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
      showActionToast(`At most ${MAX_GEMINI_MODEL_IDS} models.`, 'danger');
      return;
    }
    if (!isValidGeminiModelIdInput(q)) {
      showActionToast('Use letters, numbers, dots, underscores, or hyphens only.', 'danger');
      return;
    }
    const normalized = q.trim();
    if (rows.some((r) => r.id.trim() === normalized)) {
      showActionToast('That model is already in the list.', 'danger');
      return;
    }
    setRows((prev) => [...prev, { id: normalized, enabled: true }]);
    setAddSearch('');
  }, [addSearch, rows, showActionToast]);

  const removeRow = (i: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  };

  const moveRow = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    setRows((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const applyEnvDefaults = () => {
    setRows(envDefaultChain.map((id) => ({ id, enabled: true })));
  };

  const handleSave = async () => {
    const normalized = normalizeGeminiModelRows(rows);
    if (normalized.modelIds.length < 1) {
      showActionToast('Add at least one model id.', 'danger');
      return;
    }
    setSaving(true);
    const ok = await saveGeminiAiModels(rows);
    setSaving(false);
    if (ok) {
      showActionToast('Models saved. In-app AI updates on the next request.');
      setBaselineJson(JSON.stringify(normalized));
      setFromFirestore(true);
    } else {
      showActionToast('Save failed (check console / rules).', 'danger');
    }
  };

  return (
    <div className="space-y-5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      {actionToast}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Models</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            Gemini models for everyone. Order is the fallback chain; off skips a model.{' '}
            <strong className="font-semibold text-[var(--text-secondary)]">Add a model:</strong> type a model id in the
            field below and press <kbd className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 font-mono text-[10px]">Enter</kbd>
            —then use <strong className="font-semibold text-[var(--text-secondary)]">Save</strong>. Empty Firestore uses{' '}
            <code className="rounded bg-[var(--bg-primary)] px-1 font-mono text-[11px] text-orange-500/90">GEMINI_MODEL</code>
            .
          </p>
        </div>
        <button
          type="button"
          disabled={saving || !isDirty}
          onClick={() => void handleSave()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40 sm:self-auto"
        >
          {saving ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Save size={18} aria-hidden />}
          Save
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span>
          Env defaults:{' '}
          <span className="font-mono text-[var(--text-secondary)]">{envDefaultChain.join(' → ')}</span>
        </span>
        {fromFirestore ? (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">Using Firestore</span>
        ) : (
          <span>Not saved yet—overrides env after first save</span>
        )}
      </div>

      {!loading && enabledCount === 0 && normalizedSnapshot.modelIds.length > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          All models are off—no server-side Gemini until you enable at least one.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-color)] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <input
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  tryAddModelFromSearch();
                }
              }}
              placeholder="Add or search model"
              className="min-h-11 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-0"
              aria-label="Add or search model"
              aria-describedby="admin-models-add-hint"
            />
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] disabled:opacity-50"
              aria-label="Reload from server"
              title="Reload"
            >
              {loading ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <RotateCcw size={20} aria-hidden />}
            </button>
          </div>
          <p id="admin-models-add-hint" className="mt-1.5 text-[11px] leading-snug text-[var(--text-muted)]">
            Type a Gemini model id (e.g. <span className="font-mono text-[var(--text-secondary)]">gemini-2.5-flash</span>)
            and press Enter to add a row. While you type, the list filters to matching ids. Then adjust order, toggles, and
            click Save.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
            Loading models…
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            {rows.length === 0
              ? 'No models yet. Type a model id above and press Enter.'
              : 'No models match your search.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-color)] p-0">
            {filteredRows.map(({ row, index: i }) => (
              <li
                key={`model-row-${i}`}
                className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:py-2.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <BrainCircuit
                    size={18}
                    className="shrink-0 text-[var(--text-muted)] opacity-80"
                    aria-hidden
                  />
                  <input
                    value={row.id}
                    onChange={(e) => setRowId(i, e.target.value)}
                    className="min-h-11 min-w-0 flex-1 border-0 bg-transparent font-mono text-sm text-[var(--text-primary)] focus:outline-none focus:ring-0"
                    aria-label={`Model id, priority ${i + 1}`}
                    spellCheck={false}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 sm:shrink-0 sm:justify-end">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveRow(i, -1)}
                      disabled={i === 0}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-25"
                      aria-label="Move up in chain"
                    >
                      <ArrowUp size={17} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(i, 1)}
                      disabled={i >= rows.length - 1}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-25"
                      aria-label="Move down in chain"
                    >
                      <ArrowDown size={17} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-red-400/90 hover:bg-red-500/10 disabled:opacity-25"
                      aria-label="Remove model"
                    >
                      <Trash2 size={17} aria-hidden />
                    </button>
                  </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.id || 'model'}`}
                  onClick={() => setRowEnabled(i, !row.enabled)}
                  className={`relative h-9 w-14 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                    row.enabled ? 'bg-emerald-500' : 'bg-[var(--border-color)]'
                  }`}
                >
                  <span
                    className={`pointer-events-none absolute top-1 left-1 h-7 w-7 rounded-full bg-white shadow transition-transform ${
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

      <p className="text-center text-[11px] text-[var(--text-muted)] sm:text-left">
        <button
          type="button"
          onClick={applyEnvDefaults}
          className="font-medium text-orange-500 underline-offset-2 hover:underline"
        >
          Replace list with environment defaults
        </button>
        {' · '}
        <a
          href="https://ai.google.dev/gemini-api/docs/models"
          target="_blank"
          rel="noreferrer"
          className="text-orange-500 underline-offset-2 hover:underline"
        >
          Google model ids
        </a>
        {' · '}max {MAX_GEMINI_MODEL_IDS}
      </p>
    </div>
  );
};
