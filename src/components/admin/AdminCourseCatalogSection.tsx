import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Plus, Save, Trash2, RefreshCw } from 'lucide-react';
import type { Course, Lesson, Module } from '../../data/courses';
import {
  loadPublishedCoursesFromFirestore,
  savePublishedCourse,
  deletePublishedCourse,
} from '../../utils/publishedCoursesFirestore';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function emptyCourse(docId: string): Course {
  const t = Date.now();
  return {
    id: docId,
    title: 'Untitled course',
    author: 'SkillStream Academy',
    thumbnail: 'https://picsum.photos/seed/course/800/450',
    description: '',
    level: 'Beginner',
    duration: '1h',
    rating: 4.5,
    category: 'Software Development',
    modules: [
      {
        id: 'm-' + String(t),
        title: 'Module 1',
        lessons: [
          {
            id: 'l-' + String(t),
            title: 'Lesson 1',
            videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
          },
        ],
      },
    ],
  };
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,118}$/i;

interface AdminCourseCatalogSectionProps {
  onCatalogChanged: () => void | Promise<void>;
}

export const AdminCourseCatalogSection: React.FC<AdminCourseCatalogSectionProps> = ({
  onCatalogChanged,
}) => {
  const [publishedList, setPublishedList] = useState<Course[]>([]);
  const [selector, setSelector] = useState<string>('');
  const [newDocId, setNewDocId] = useState('');
  const [draft, setDraft] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    const list = await loadPublishedCoursesFromFirestore();
    setPublishedList(list);
    setListLoading(false);
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const pickCourse = (id: string) => {
    setSelector(id);
    setMsg(null);
    if (!id || id === '__new__') {
      setDraft(null);
      return;
    }
    const c = publishedList.find((x) => x.id === id);
    setDraft(c ? deepClone(c) : null);
  };

  const startNewDraft = () => {
    setMsg(null);
    const id = newDocId.trim();
    if (!SLUG_RE.test(id)) {
      setMsg('Course ID: letters, numbers, hyphens only; 1–119 chars; must start with alphanumeric.');
      return;
    }
    if (publishedList.some((c) => c.id === id)) {
      setMsg('That course ID already exists. Pick it from the list to edit.');
      return;
    }
    setSelector('__new__');
    setDraft(emptyCourse(id));
  };

  const updateDraft = (patch: Partial<Course>) => {
    setDraft((d) => (d ? { ...d, ...patch } : null));
  };

  const updateModule = (mi: number, patch: Partial<Module>) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = [...d.modules];
      modules[mi] = { ...modules[mi], ...patch };
      return { ...d, modules };
    });
  };

  const updateLesson = (mi: number, li: number, patch: Partial<Lesson>) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        const lessons = m.lessons.map((lesson, j) => (j === li ? { ...lesson, ...patch } : lesson));
        return { ...m, lessons };
      });
      return { ...d, modules };
    });
  };

  const addModule = () => {
    const t = Date.now();
    setDraft((d) => {
      if (!d) return null;
      return {
        ...d,
        modules: [
          ...d.modules,
          {
            id: 'm-' + t,
            title: 'Module ' + (d.modules.length + 1),
            lessons: [
              {
                id: 'l-' + t,
                title: 'New lesson',
                videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
              },
            ],
          },
        ],
      };
    });
  };

  const removeModule = (mi: number) => {
    setDraft((d) => {
      if (!d || d.modules.length <= 1) return d;
      return { ...d, modules: d.modules.filter((_, i) => i !== mi) };
    });
  };

  const addLesson = (mi: number) => {
    const t = Date.now();
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        return {
          ...m,
          lessons: [
            ...m.lessons,
            { id: 'l-' + t, title: 'New lesson', videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
          ],
        };
      });
      return { ...d, modules };
    });
  };

  const removeLesson = (mi: number, li: number) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        if (m.lessons.length <= 1) return m;
        return { ...m, lessons: m.lessons.filter((_, j) => j !== li) };
      });
      return { ...d, modules };
    });
  };

  const validateDraft = (c: Course): string | null => {
    if (!c.title.trim()) return 'Title is required.';
    if (!c.author.trim()) return 'Author is required.';
    if (!c.thumbnail.trim()) return 'Thumbnail URL is required.';
    if (!c.modules.length) return 'At least one module is required.';
    for (const m of c.modules) {
      if (!m.lessons.length) return 'Each module needs at least one lesson.';
      for (const l of m.lessons) {
        if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) return 'Every lesson needs a valid video URL.';
      }
    }
    if (c.rating < 0 || c.rating > 5) return 'Rating must be 0–5.';
    return null;
  };

  const handleSave = async () => {
    if (!draft) return;
    const err = validateDraft(draft);
    if (err) {
      setMsg(err);
      return;
    }
    setBusy(true);
    setMsg(null);
    const ok = await savePublishedCourse(draft);
    setBusy(false);
    if (ok) {
      setMsg('Saved to Firestore.');
      await refreshList();
      await onCatalogChanged();
      setSelector(draft.id);
    } else setMsg('Save failed (check console / rules).');
  };

  const handleDelete = async () => {
    if (!draft) return;
    if (!window.confirm('Delete published course "' + draft.id + '" from Firestore?')) return;
    setBusy(true);
    setMsg(null);
    const ok = await deletePublishedCourse(draft.id);
    setBusy(false);
    if (ok) {
      setDraft(null);
      setSelector('');
      setMsg('Course deleted.');
      await refreshList();
      await onCatalogChanged();
    } else setMsg('Delete failed.');
  };

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BookOpen size={20} className="text-orange-500" />
          Published courses
        </h2>
        <button
          type="button"
          disabled={listLoading}
          onClick={() => void refreshList()}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={listLoading ? 'animate-spin' : ''} />
          Reload list
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        Edits write to <code className="text-orange-500/90">publishedCourses</code>. Seed from the Alerts tab if empty.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Edit existing</label>
          <select
            value={selector === '__new__' ? '' : selector}
            onChange={(e) => pickCourse(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— Select —</option>
            {publishedList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.id})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">New course ID</label>
            <input
              value={newDocId}
              onChange={(e) => setNewDocId(e.target.value)}
              placeholder="e.g. rust-fundamentals"
              className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <button
            type="button"
            onClick={startNewDraft}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500/15 px-4 py-2 text-sm font-bold text-orange-500 hover:bg-orange-500/25"
          >
            <Plus size={16} />
            New draft
          </button>
        </div>
      </div>

      {msg && (
        <p className="text-sm text-[var(--text-secondary)] border border-[var(--border-color)] rounded-xl px-4 py-3 bg-[var(--bg-primary)]/50">
          {msg}
        </p>
      )}

      {draft && (
        <div className="space-y-4 border-t border-[var(--border-color)] pt-6">
          <p className="text-xs font-mono text-[var(--text-muted)]">
            Document ID: <span className="text-orange-500/90">{draft.id}</span>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Title</span>
              <input
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Author</span>
              <input
                value={draft.author}
                onChange={(e) => updateDraft({ author: e.target.value })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Category</span>
              <input
                value={draft.category}
                onChange={(e) => updateDraft({ category: e.target.value })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Level</span>
              <select
                value={draft.level}
                onChange={(e) => updateDraft({ level: e.target.value as Course['level'] })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              >
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Duration label</span>
              <input
                value={draft.duration}
                onChange={(e) => updateDraft({ duration: e.target.value })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Rating (0–5)</span>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={draft.rating}
                onChange={(e) => updateDraft({ rating: Number(e.target.value) })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Thumbnail URL</span>
              <input
                value={draft.thumbnail}
                onChange={(e) => updateDraft({ thumbnail: e.target.value })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Description</span>
              <textarea
                value={draft.description}
                onChange={(e) => updateDraft({ description: e.target.value })}
                rows={3}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm resize-y"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Author bio (optional)</span>
              <textarea
                value={draft.authorBio ?? ''}
                onChange={(e) => updateDraft({ authorBio: e.target.value || undefined })}
                rows={2}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm resize-y"
              />
            </label>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Modules and lessons</h3>
              <button
                type="button"
                onClick={addModule}
                className="inline-flex items-center gap-1 text-xs font-bold text-orange-500 hover:text-orange-400"
              >
                <Plus size={14} /> Add module
              </button>
            </div>

            {draft.modules.map((mod, mi) => (
              <div
                key={mod.id + '-' + mi}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/30 p-4 space-y-3"
              >
                <div className="flex flex-wrap gap-2 items-start justify-between">
                  <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                    <input
                      value={mod.id}
                      onChange={(e) => updateModule(mi, { id: e.target.value })}
                      className="w-28 font-mono text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                      title="Module id"
                    />
                    <input
                      value={mod.title}
                      onChange={(e) => updateModule(mi, { title: e.target.value })}
                      className="min-w-[8rem] flex-1 text-sm font-semibold bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-1.5"
                      placeholder="Module title"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeModule(mi)}
                    disabled={draft.modules.length <= 1}
                    className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg disabled:opacity-30"
                    aria-label="Remove module"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="space-y-2 pl-2 border-l-2 border-orange-500/30">
                  {mod.lessons.map((lesson, li) => (
                    <div key={lesson.id + '-' + li} className="rounded-lg bg-[var(--bg-secondary)]/80 p-3 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={lesson.id}
                          onChange={(e) => updateLesson(mi, li, { id: e.target.value })}
                          className="w-28 font-mono text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                        />
                        <input
                          value={lesson.title}
                          onChange={(e) => updateLesson(mi, li, { title: e.target.value })}
                          className="min-w-[6rem] flex-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                          placeholder="Lesson title"
                        />
                      </div>
                      <input
                        value={lesson.videoUrl}
                        onChange={(e) => updateLesson(mi, li, { videoUrl: e.target.value })}
                        className="w-full text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                        placeholder="https://www.youtube.com/watch?v=…"
                      />
                      <input
                        value={lesson.duration ?? ''}
                        onChange={(e) => updateLesson(mi, li, { duration: e.target.value || undefined })}
                        className="w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                        placeholder="Duration label (optional)"
                      />
                      <textarea
                        value={lesson.about ?? ''}
                        onChange={(e) => updateLesson(mi, li, { about: e.target.value || undefined })}
                        rows={2}
                        className="w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5 resize-y"
                        placeholder="About (optional)"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeLesson(mi, li)}
                          disabled={mod.lessons.length <= 1}
                          className="text-xs font-semibold text-red-400 hover:underline disabled:opacity-30"
                        >
                          Remove lesson
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addLesson(mi)}
                    className="text-xs font-bold text-orange-500 hover:text-orange-400"
                  >
                    + Add lesson
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSave()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-6 py-3 text-sm font-bold"
            >
              <Save size={18} />
              {busy ? 'Saving…' : 'Save to Firestore'}
            </button>
            <button
              type="button"
              disabled={busy || !publishedList.some((c) => c.id === draft.id)}
              onClick={() => void handleDelete()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-30 px-6 py-3 text-sm font-bold"
            >
              <Trash2 size={18} />
              Delete published
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
