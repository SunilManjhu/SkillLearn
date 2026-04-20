import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  CATALOG_SKILL_PRESETS_CHANGED,
  DEFAULT_CATALOG_SKILL_PRESETS,
  normalizeCatalogSkillPresets,
  type CatalogSkillPresetsState,
} from '../../utils/catalogSkillPresetsState';
import { loadCatalogSkillPresets, saveCatalogSkillPresets } from '../../utils/catalogSkillPresetsFirestore';
import type { AdminActionToastVariant } from './useAdminActionToast';

export type AdminCatalogSkillPresetsPanelProps = {
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

      <div className="flex min-w-0 items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={addPlaceholder}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg bg-[#616161] text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40"
          aria-label={`Add ${title} item`}
        >
          <Plus size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export const AdminCatalogSkillPresetsPanel: React.FC<AdminCatalogSkillPresetsPanelProps> = ({
  showActionToast,
  onCatalogChanged,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<CatalogSkillPresetsState>(() => DEFAULT_CATALOG_SKILL_PRESETS);

  const reload = useCallback(async () => {
    setLoading(true);
    const p = await loadCatalogSkillPresets();
    setDraft(p);
    setDirty(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const h = () => void loadCatalogSkillPresets().then((p) => setDraft(p));
    window.addEventListener(CATALOG_SKILL_PRESETS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_SKILL_PRESETS_CHANGED, h);
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await saveCatalogSkillPresets(normalizeCatalogSkillPresets(draft));
    setSaving(false);
    if (ok) {
      setDirty(false);
      showActionToast('Skill presets saved.');
      await onCatalogChanged();
    } else {
      showActionToast('Save failed.', 'danger');
    }
  };

  const resetDefaults = () => {
    setDraft(DEFAULT_CATALOG_SKILL_PRESETS);
    setDirty(true);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Skill presets</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            Controls what appears under “Popular skills” and seeds “More skills” in the course filter.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={resetDefaults}
            disabled={loading || saving}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
          >
            <RotateCcw size={16} aria-hidden />
            Defaults
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !dirty}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#616161] px-4 py-2 text-xs font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
            Save
          </button>
        </div>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          Loading…
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PresetColumn
            title="Popular skills"
            description="Pinned, ordered skills shown first."
            items={draft.mainPills}
            minItems={0}
            addPlaceholder="Add a popular skill…"
            onChange={(next) => {
              setDraft((d) => ({ ...d, mainPills: next }));
              setDirty(true);
            }}
          />
          <PresetColumn
            title="More skills"
            description="Optional ordered list (the filter also shows discovered skills and extras)."
            items={draft.moreSkills}
            minItems={0}
            addPlaceholder="Add a more skill…"
            onChange={(next) => {
              setDraft((d) => ({ ...d, moreSkills: next }));
              setDirty(true);
            }}
          />
        </div>
      )}
    </div>
  );
};

