import React from 'react';
import { BookOpen, X } from 'lucide-react';
import type { User } from '../firebase';
import { AdminCourseCatalogSection } from './admin/AdminCourseCatalogSection';

interface CreatorPageProps {
  user: User;
  onDismiss: () => void;
  /** Refresh Browse Catalog / paths so creator drafts appear after save. */
  onCatalogChanged?: () => void | Promise<void>;
}

/**
 * Private course + path authoring for accounts with role `creator` (and admins for testing).
 * Reuses the admin catalog editors against `creatorCourses` / `creatorLearningPaths`.
 */
export const CreatorPage: React.FC<CreatorPageProps> = ({ user, onDismiss, onCatalogChanged }) => {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-3 pb-20 pt-24 text-[var(--text-primary)] sm:px-6 sm:pb-16">
      <div className="mx-auto min-w-0 max-w-6xl space-y-5 sm:space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="shrink-0 rounded-lg bg-orange-500/15 p-2 text-orange-500">
              <BookOpen size={22} aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">Creator studio</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
            aria-label="Close creator studio"
            title="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <AdminCourseCatalogSection
          catalogPersistence={{ kind: 'creator', ownerUid: user.uid }}
          catalogSectionTitle="Your courses"
          onCatalogChanged={() => void onCatalogChanged?.()}
        />
      </div>
    </div>
  );
};
