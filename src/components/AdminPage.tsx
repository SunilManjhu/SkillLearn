import React, { useRef, useState } from 'react';
import { Shield, Send, Database, BookOpen, Flag, Users } from 'lucide-react';
import type { Course } from '../data/courses';
import { STATIC_CATALOG_FALLBACK } from '../data/courses';
import type { AdminHistoryTab } from '../utils/appHistory';
import { createBroadcastAlert, type BroadcastAlertType } from '../utils/alertsFirestore';
import { seedPublishedCoursesFromStaticCatalog } from '../utils/publishedCoursesFirestore';
import { AdminCourseCatalogSection } from './admin/AdminCourseCatalogSection';
import { AdminModerationSection } from './admin/AdminModerationSection';
import { AdminUserRolesSection } from './admin/AdminUserRolesSection';

interface AdminPageProps {
  courses: Course[];
  activeTab: AdminHistoryTab;
  currentAdminUid?: string;
  onTabChange: (tab: AdminHistoryTab) => void;
  onDismiss: () => void;
  onCatalogChanged: () => void | Promise<void>;
}

const ALERT_TYPES: { value: BroadcastAlertType; label: string }[] = [
  { value: 'course_update', label: 'Course update' },
  { value: 'topic_update', label: 'Topic / module update' },
  { value: 'video_update', label: 'New or updated video' },
  { value: 'course_change', label: 'Other course change' },
];

export const AdminPage: React.FC<AdminPageProps> = ({
  courses,
  activeTab: tab,
  currentAdminUid,
  onTabChange,
  onDismiss,
  onCatalogChanged,
}) => {
  const [type, setType] = useState<BroadcastAlertType>('course_update');
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showValidationHints, setShowValidationHints] = useState(false);
  const [targetingOpen, setTargetingOpen] = useState(false);
  const courseRef = useRef<HTMLSelectElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedCourse = courses.find((c) => c.id === courseId);
  const courseMissing = !courseId;
  const titleMissing = !title.trim();
  const messageMissing = !message.trim();

  const handleSend = async () => {
    if (courseMissing) {
      setShowValidationHints(true);
      setStatus('Course is required.');
      courseRef.current?.focus();
      return;
    }
    if (titleMissing) {
      setShowValidationHints(true);
      setStatus('Title is required.');
      titleRef.current?.focus();
      return;
    }
    if (messageMissing) {
      setShowValidationHints(true);
      setStatus('Message is required.');
      messageRef.current?.focus();
      return;
    }
    setBusy(true);
    setShowValidationHints(false);
    setStatus(null);
    const id = await createBroadcastAlert({
      type,
      title: title.trim(),
      message: message.trim(),
      courseId,
      moduleId: moduleId.trim() || undefined,
      lessonId: lessonId.trim() || undefined,
    });
    setBusy(false);
    if (id) {
      setStatus('Alert published.');
      setTitle('');
      setMessage('');
      setModuleId('');
      setLessonId('');
      setShowValidationHints(false);
    } else {
      setStatus('Failed to publish (check console / rules).');
    }
  };

  const handleSeedCatalog = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await seedPublishedCoursesFromStaticCatalog(STATIC_CATALOG_FALLBACK);
      await onCatalogChanged();
      setStatus('Seeded. Catalog updated in this session.');
    } catch {
      setStatus('Seed failed (check console / rules).');
    }
    setBusy(false);
  };

  const tabBtn = (id: AdminHistoryTab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => {
        onTabChange(id);
        setStatus(null);
        setShowValidationHints(false);
      }}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
        tab === id
          ? 'bg-orange-500 text-white'
          : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--hover-bg)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] pt-24 pb-16 px-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-orange-500/15 text-orange-500">
              <Shield size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Admin portal</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Alerts, catalog, and moderation. Students do not see this page.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-sm font-semibold text-orange-500 hover:text-orange-400"
          >
            Close
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabBtn('alerts', 'Alerts', <Send size={16} />)}
          {tabBtn('catalog', 'Courses', <BookOpen size={16} />)}
          {tabBtn('moderation', 'Moderation', <Flag size={16} />)}
          {tabBtn('users', 'Users', <Users size={16} />)}
        </div>

        {tab === 'alerts' && (
        <div className="space-y-8">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Send size={20} className="text-orange-500" />
            Send course alert
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Only users enrolled in the selected course receive this in their notification bell.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as BroadcastAlertType)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              >
                {ALERT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]">Course</label>
              <select
                ref={courseRef}
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                aria-invalid={showValidationHints && courseMissing ? true : undefined}
                className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && courseMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
                }`}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              {showValidationHints && courseMissing && (
                <p className="text-xs text-red-400">Course is required.</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">Title</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={showValidationHints && titleMissing ? true : undefined}
              className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                showValidationHints && titleMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
              }`}
              placeholder="Short headline"
            />
            {showValidationHints && titleMissing && (
              <p className="text-xs text-red-400">Title is required.</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">Message</label>
            <textarea
              ref={messageRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              aria-invalid={showValidationHints && messageMissing ? true : undefined}
              className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm resize-none ${
                showValidationHints && messageMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
              }`}
              placeholder="What changed?"
            />
            {showValidationHints && messageMissing && (
              <p className="text-xs text-red-400">Message is required.</p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => setTargetingOpen((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]"
            >
              Optional targeting (module / lesson)
              <span className="text-[10px]">{targetingOpen ? 'Hide' : 'Show'}</span>
            </button>
            {targetingOpen && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                    Module ID (optional)
                  </label>
                  <select
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {(selectedCourse?.modules ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                    Lesson ID (optional)
                  </label>
                  <select
                    value={lessonId}
                    onChange={(e) => setLessonId(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {(selectedCourse?.modules ?? []).flatMap((m) =>
                      m.lessons.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title} ({l.id})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSend()}
            className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold"
          >
            {busy ? 'Publishing…' : 'Publish alert'}
          </button>
        </div>

        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Database size={20} className="text-orange-500" />
            Catalog bootstrap
          </h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            One-time: copy the bundled static catalog into <code className="text-orange-500/90">publishedCourses</code>{' '}
            so the app loads courses from Firestore. Requires admin rules deployed.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSeedCatalog()}
            className="w-full py-3 rounded-xl border border-[var(--border-color)] hover:bg-[var(--hover-bg)] disabled:opacity-50 text-sm font-bold"
          >
            Seed published courses from static fallback
          </button>
        </div>
        </div>
        )}

        {tab === 'catalog' && <AdminCourseCatalogSection onCatalogChanged={onCatalogChanged} />}

        {tab === 'moderation' && <AdminModerationSection />}
        {tab === 'users' && <AdminUserRolesSection currentAdminUid={currentAdminUid} />}

        {status && tab === 'alerts' && (
          <p className="text-sm text-[var(--text-secondary)] border border-[var(--border-color)] rounded-xl p-4 bg-[var(--bg-secondary)]">
            {status}
          </p>
        )}
      </div>
    </div>
  );
};
