import React, { useCallback, useState } from 'react';
import { User as FirebaseUser } from '../firebase';
import type { AuthProfileSnapshot } from '../utils/authProfileCache';
import { formatAuthError } from '../utils/authErrors';

export type AuthGateMode = 'sign-in' | 'sign-up';

export type AuthGateNavView = 'signin' | 'signup' | 'privacy' | 'catalog' | 'home';

export interface AuthGatePageProps {
  mode: AuthGateMode;
  isAuthReady: boolean;
  user: FirebaseUser | AuthProfileSnapshot | null;
  onContinueWithGoogle: () => Promise<void>;
  onNavigate: (view: AuthGateNavView, clear?: boolean) => void;
}

/** Google “G” mark (multicolor) for the OAuth button — brand colors per Google guidelines. */
export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden width={20} height={20}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export const AuthGatePage: React.FC<AuthGatePageProps> = ({
  mode,
  isAuthReady,
  user,
  onContinueWithGoogle,
  onNavigate,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onContinueWithGoogle();
    } catch (e) {
      setError(formatAuthError(e));
    } finally {
      setSubmitting(false);
    }
  }, [submitting, onContinueWithGoogle]);

  if (!isAuthReady) {
    return (
      <div className="flex min-h-[calc(100dvh-5rem)] items-center justify-center px-4 pt-24 pb-16">
        <p className="text-sm text-[var(--text-muted)]">Checking account…</p>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-[calc(100dvh-5rem)] items-center justify-center px-4 pt-24 pb-16">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 text-center shadow-xl">
          <p className="text-lg font-semibold text-[var(--text-primary)]">You&apos;re signed in</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {user.email ? (
              <>
                Signed in as <span className="font-medium text-[var(--text-secondary)]">{user.email}</span>
              </>
            ) : (
              'Your Google account is connected.'
            )}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('catalog', false)}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600"
          >
            Go to catalog
          </button>
        </div>
      </div>
    );
  }

  const isSignUp = mode === 'sign-up';

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] items-center justify-center px-4 pt-24 pb-16">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-xl sm:p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            {isSignUp ? 'Create your account' : 'Sign in'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            {isSignUp
              ? 'Use your Google account to save progress, earn certificates, and sync across devices. New and returning users both sign in with Google — we create your workspace the first time you connect.'
              : 'Welcome back. Sign in with the same Google account you used before to restore your progress and profile.'}
          </p>
        </div>

        <div className="mt-8 space-y-4">
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          ) : null}

          <button
            type="button"
            disabled={submitting}
            onClick={() => void onSubmit()}
            className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--hover-bg)] disabled:opacity-50"
          >
            <GoogleMark className="shrink-0" />
            {submitting ? 'Connecting…' : 'Continue with Google'}
          </button>

          <p className="text-center text-xs leading-relaxed text-[var(--text-muted)]">
            By continuing, you agree to our{' '}
            <button
              type="button"
              onClick={() => onNavigate('privacy', false)}
              className="font-medium text-[var(--text-primary)] underline decoration-[var(--text-muted)] underline-offset-2 hover:opacity-90"
            >
              Privacy Policy
            </button>
            .
          </p>

          <div className="border-t border-[var(--border-color)] pt-6 text-center text-sm text-[var(--text-secondary)]">
            {isSignUp ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('signin', false)}
                  className="font-semibold text-[var(--text-primary)] hover:opacity-90"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to <span className="font-semibold text-brand-500">i-Golden</span>?{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('signup', false)}
                  className="font-semibold text-[var(--text-primary)] hover:opacity-90"
                >
                  Create an account
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
