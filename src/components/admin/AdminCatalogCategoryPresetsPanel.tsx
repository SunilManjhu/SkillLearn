import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  CATALOG_CATEGORY_PRESETS_CHANGED,
  DEFAULT_CATALOG_CATEGORY_PRESETS,
  normalizeCatalogCategoryPresets,
  type CatalogCategoryPresetsState,
} from '../../utils/catalogCategoryPresets';
import { loadCatalogCategoryPresets, saveCatalogCategoryPresets } from '../../utils/catalogCategoryPresetsFirestore';
import type { AdminActionToastVariant } from './useAdminActionToast';

export type AdminCatalogCategoryPresetsPanelProps = {
  showActionToast: (msg: string, variant?: AdminActionToastVariant) => void;
  onCatalogChanged: () => void | Promise<void>;
};

function PresetColumn({
  title,
  description,
  items,
  onChange,
  addPlaceholder,
  minItems,
}: {
  title: string;
  description: string;
  items: string[];
  onChange: (next: string[]) => void;
  addPlaceholder: string;
  minItems: number;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (items.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...items, t]);
    setDraft('');
  };

  const removeAt = (i: number) => {
    if (items.length <= minItems && minItems > 0) return;
    onChange(items.filter((_, j) => j !== i));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/30 p-4">
      <div>
        <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
      </div>
      <ul className="space-y-2">
        {items.map((label, i) => (
          <li
            key={`${label}-${i}`}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{label}</span>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
                aria-label={`Move ${label} up`}
              >
                <ChevronUp size={18} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
                aria-label={`Move ${label} down`}
              >
                <ChevronDown size={18} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={items.length <= minItems && minItems > 0}
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-[#a1a2a2] hover:bg-[#757676]/12 disabled:opacity-30"
                aria-label={`Remove ${label}`}
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={addPlaceholder}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#616161] px-4 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676]"
        >
          <Plus size={16} aria-hidden />
          Add
        </button>
      </div>
    </div>
  );
}

export const AdminCatalogCategoryPresetsPanel: React.FC<AdminCatalogCategoryPresetsPanelProps> = ({
  showActionToast,
  onCatalogChanged,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mainPills, setMainPills] = useState<string[]>(DEFAULT_CATALOG_CATEGORY_PRESETS.mainPills);
  const [moreTopics, setMoreTopics] = useState<string[]>(DEFAULT_CATALOG_CATEGORY_PRESETS.moreTopics);

  const refresh = useCallback(async () => {
    const next = await loadCatalogCategoryPresets();
    setMainPills(next.mainPills);
    setMoreTopics(next.moreTopics);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadCatalogCategoryPresets().then((p) => {
      if (cancelled) return;
      setMainPills(p.mainPills);
      setMoreTopics(p.moreTopics);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const h = () => void refresh();
    window.addEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, h);
  }, [refresh]);

  const handleSave = async () => {
    const normalized = normalizeCatalogCategoryPresets({ mainPills, moreTopics });
    setSaving(true);
    const ok = await saveCatalogCategoryPresets(normalized);
    setSaving(false);
    if (ok) {
      showActionToast('Topic presets saved. Learners will see updates after refresh.');
      await onCatalogChanged();
    } else {
      showActionToast('Save failed (check console / rules).', 'danger');
    }
  };

  const handleResetDefaults = () => {
    const d = normalizeCatalogCategoryPresets(DEFAULT_CATALOG_CATEGORY_PRESETS);
    setMainPills(d.mainPills);
    setMoreTopics(d.moreTopics);
    showActionToast('Restored default lists locally — click Save to publish.', 'neutral');
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-[var(--text-muted)]">
        <Loader2 size={18} className="animate-spin" aria-hidden />
        Loading presets…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        These lists drive the <strong className="text-[var(--text-secondary)]">Course Library</strong> filter (
        <strong className="text-[var(--text-secondary)]">Popular topics</strong> vs{' '}
        <strong className="text-[var(--text-secondary)]">More topics</strong>), the{' '}
        <strong className="text-[var(--text-secondary)]">Browse</strong> menu, and default picks in the catalog
        editor. Changing a name here does <strong className="text-[var(--text-secondary)]">not</strong> rename tags
        on existing courses — use the <strong className="text-[var(--text-secondary)]">Categories</strong> tab for
        that. Deploy Firestore rules if saves are denied.
      </p>

      <PresetColumn
        title="Popular topics"
        description="Shown as the first row of topic chips in the library filter and at the front of Browse → categories."
        items={mainPills}
        onChange={setMainPills}
        addPlaceholder="e.g. DevOps"
        minItems={0}
      />

      <PresetColumn
        title="More topics"
        description="Extra preset names grouped under “More topics” in the filter. Also used as quick picks in admin."
        items={moreTopics}
        onChange={setMoreTopics}
        addPlaceholder="e.g. Photography"
        minItems={0}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#616161] px-5 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40"
        >
          {saving ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Save size={18} aria-hidden />}
          Save presets
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleResetDefaults}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] px-5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
        >
          <RotateCcw size={18} aria-hidden />
          Reset to bundled defaults
        </button>
      </div>
    </div>
  );
};
