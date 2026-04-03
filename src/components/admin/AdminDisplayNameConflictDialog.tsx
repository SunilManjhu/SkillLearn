import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { TitleConflictHit } from '../../utils/catalogDisplayNameConflicts';

type AdminDisplayNameConflictDialogProps = {
  open: boolean;
  savingLabel: 'course' | 'path';
  conflict: TitleConflictHit | null;
  /** Element id to scroll to and focus (e.g. admin-course-title, admin-path-title). */
  renameFieldId: string;
  /**
   * Run before closing the dialog so the target node exists (e.g. expand collapsed “Course details”
   * that wraps the title input).
   */
  onPrepareRenameField?: () => void;
  onClose: () => void;
};

const RENAME_FOCUS_MAX_FRAMES = 24;

export function AdminDisplayNameConflictDialog({
  open,
  savingLabel,
  conflict,
  renameFieldId,
  onPrepareRenameField,
  onClose,
}: AdminDisplayNameConflictDialogProps) {
  const goToRename = () => {
    onPrepareRenameField?.();
    onClose();
    let frames = 0;
    const tryFocus = () => {
      const el = document.getElementById(renameFieldId);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
        return;
      }
      frames += 1;
      if (frames < RENAME_FOCUS_MAX_FRAMES) requestAnimationFrame(tryFocus);
    };
    requestAnimationFrame(tryFocus);
  };

  return (
    <AnimatePresence>
      {open && conflict && (
        <div
          className="fixed inset-0 z-[102] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-display-name-conflict-title"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
              <h2
                id="admin-display-name-conflict-title"
                className="text-xl font-bold text-[var(--text-primary)]"
              >
                Title already in use
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                Another {conflict.entity === 'path' ? 'learning path' : 'course'} already uses the display
                name{' '}
                <span className="font-semibold text-[var(--text-primary)]">
                  &ldquo;{conflict.title.trim() || conflict.id}&rdquo;
                </span>{' '}
                (id <span className="font-mono text-[var(--text-primary)]">{conflict.id}</span>). Choose a
                different title for this {savingLabel} before saving.
              </p>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                >
                  OK
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={goToRename}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-500 sm:w-auto"
                >
                  Go to title
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
