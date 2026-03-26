import React from 'react';

type Variant = 'overview' | 'player';

/**
 * Shown while the live Firestore catalog is resolving on a cold load (overview / player).
 * Matches the rough layout of CourseOverview / CoursePlayer so the transition feels continuous.
 */
export function CourseCatalogLoadingSkeleton({ variant = 'overview' }: { variant?: Variant }) {
  if (variant === 'player') {
    return (
      <div
        className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] pb-8 pt-16 px-4"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">Loading course curriculum…</span>
        <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row gap-6 lg:items-start">
          <div className="flex-1 min-w-0 space-y-4">
            <div className="aspect-video w-full rounded-2xl border border-[var(--border-color)] animate-pulse bg-[var(--bg-secondary)]" />
            <div className="h-10 w-3/4 max-w-xl rounded-lg animate-pulse bg-[var(--hover-bg)]" />
            <div className="h-4 w-full max-w-2xl rounded animate-pulse bg-[var(--hover-bg)]" />
          </div>
          <div className="w-full lg:w-80 shrink-0 border border-[var(--border-color)] rounded-2xl bg-[var(--bg-secondary)] p-4 space-y-3">
            <div className="h-5 w-24 rounded animate-pulse bg-[var(--hover-bg)] mb-2" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 py-2 border-b border-[var(--border-color)] last:border-0">
                <div className="h-4 w-4 shrink-0 rounded animate-pulse bg-[var(--hover-bg)] mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 rounded animate-pulse bg-[var(--hover-bg)]" />
                  <div className="h-3 w-1/3 rounded animate-pulse bg-[var(--hover-bg)]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] pb-10 pt-16"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading course curriculum…</span>

      {/* Hero placeholder */}
      <div className="relative w-full overflow-hidden">
        <div className="h-56 md:h-72 w-full animate-pulse bg-[var(--bg-secondary)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-transparent to-transparent pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 -mt-32 md:-mt-40 pb-8">
          <div className="max-w-3xl space-y-4">
            <div className="h-6 w-32 rounded-full animate-pulse bg-[var(--hover-bg)]" />
            <div className="h-10 md:h-12 w-4/5 max-w-xl rounded-xl animate-pulse bg-[var(--hover-bg)]" />
            <div className="space-y-2">
              <div className="h-4 w-full max-w-2xl rounded animate-pulse bg-[var(--hover-bg)]" />
              <div className="h-4 w-full max-w-xl rounded animate-pulse bg-[var(--hover-bg)]" />
            </div>
            <div className="flex gap-3 pt-2">
              <div className="h-14 w-40 rounded-2xl animate-pulse bg-[var(--hover-bg)]" />
              <div className="h-14 w-36 rounded-2xl animate-pulse bg-[var(--hover-bg)]" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-8 w-48 rounded-lg animate-pulse bg-[var(--hover-bg)]" />
            <div className="space-y-4">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="border border-[var(--border-color)] rounded-2xl overflow-hidden bg-[var(--bg-secondary)]"
                >
                  <div className="p-6 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg animate-pulse bg-[var(--hover-bg)] shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 w-2/3 rounded animate-pulse bg-[var(--hover-bg)]" />
                      <div className="h-3 w-24 rounded animate-pulse bg-[var(--hover-bg)]" />
                    </div>
                  </div>
                  <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-6 py-3 space-y-3">
                    {[0, 1, 2].map((j) => (
                      <div key={j} className="flex items-center justify-between gap-4 py-2">
                        <div className="h-4 flex-1 max-w-md rounded animate-pulse bg-[var(--hover-bg)]" />
                        <div className="h-3 w-12 rounded animate-pulse bg-[var(--hover-bg)] shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-8">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl p-8 space-y-4">
              <div className="h-4 w-28 rounded animate-pulse bg-[var(--hover-bg)]" />
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl animate-pulse bg-[var(--hover-bg)] shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-5 w-32 rounded animate-pulse bg-[var(--hover-bg)]" />
                  <div className="h-3 w-20 rounded animate-pulse bg-[var(--hover-bg)]" />
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <div className="h-3 w-full rounded animate-pulse bg-[var(--hover-bg)]" />
                <div className="h-3 w-full rounded animate-pulse bg-[var(--hover-bg)]" />
                <div className="h-3 w-3/4 rounded animate-pulse bg-[var(--hover-bg)]" />
              </div>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl p-8 space-y-6">
              <div className="h-4 w-32 rounded animate-pulse bg-[var(--hover-bg)]" />
              {[0, 1, 2].map((k) => (
                <div key={k} className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl animate-pulse bg-[var(--hover-bg)] shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-16 rounded animate-pulse bg-[var(--hover-bg)]" />
                    <div className="h-4 w-28 rounded animate-pulse bg-[var(--hover-bg)]" />
                  </div>
                </div>
              ))}
              <div className="h-14 w-full rounded-2xl animate-pulse bg-[var(--hover-bg)] mt-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
