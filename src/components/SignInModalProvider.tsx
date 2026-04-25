import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { User as FirebaseUser } from '../firebase';
import type { AuthProfileSnapshot } from '../utils/authProfileCache';
import { formatAuthError } from '../utils/authErrors';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { AUTH_GOOGLE_GATE_DESCRIPTION, GoogleMark, type AuthGateNavView } from './AuthGatePage';

type SignInModalUser = FirebaseUser | AuthProfileSnapshot | null;

export type SignInModalContextValue = {
  /** Opens the shared Auth Gate–styled sign-in dialog. */
  openSignInModal: () => void;
  closeSignInModal: () => void;
};

const SignInModalContext = createContext<SignInModalContextValue | null>(null);

export function useSignInModal(): SignInModalContextValue {
  const ctx = useContext(SignInModalContext);
  if (!ctx) {
    throw new Error('useSignInModal must be used within SignInModalProvider');
  }
  return ctx;
}

export interface SignInModalProviderProps {
  children: React.ReactNode;
  isAuthReady: boolean;
  user: SignInModalUser;
  onLogin: () => Promise<void>;
  onNavigate: (view: AuthGateNavView, shouldClear?: boolean) => void;
  reduceMotion: boolean | null;
}

export const SignInModalProvider: React.FC<SignInModalProviderProps> = ({
  children,
  isAuthReady,
  user,
  onLogin,
  onNavigate,
  reduceMotion,
}) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const closeSignInModal = useCallback(() => {
    setOpen(false);
    setError(null);
    setSubmitting(false);
  }, []);

  const openSignInModal = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);

  const primaryAction = useCallback(async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onLogin();
      closeSignInModal();
    } catch (e) {
      setError(formatAuthError(e));
    } finally {
      setSubmitting(false);
    }
  }, [submitting, onLogin, closeSignInModal]);

  useEffect(() => {
    if (user && open) {
      setOpen(false);
      setError(null);
      setSubmitting(false);
    }
  }, [user, open]);

  useBodyScrollLock(open);

  useDialogKeyboard({
    open,
    onClose: closeSignInModal,
    onPrimaryAction: primaryAction,
  });

  const value = useMemo(
    () => ({
      openSignInModal,
      closeSignInModal,
    }),
    [openSignInModal, closeSignInModal]
  );

  return (
    <SignInModalContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {open && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shared-sign-in-title"
          >
            <motion.div
              initial={{ scale: reduceMotion ? 1 : 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: reduceMotion ? 1 : 0.9, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              className="relative w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-xl sm:p-8"
            >
              <button
                type="button"
                onClick={closeSignInModal}
                className="absolute right-2 top-2 z-10 rounded-full p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] sm:right-3 sm:top-3"
                aria-label="Close"
              >
                <X size={20} aria-hidden />
              </button>
              {!isAuthReady ? (
                <p className="pt-6 text-center text-sm text-[var(--text-muted)] sm:pt-2">Checking account…</p>
              ) : (
                <>
                  <div className="text-center">
                    <h1
                      id="shared-sign-in-title"
                      className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl"
                    >
                      Sign in
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
                      {AUTH_GOOGLE_GATE_DESCRIPTION}
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
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!submitting) void primaryAction();
                      }}
                    >
                      <button
                        type="submit"
                        disabled={submitting}
                        autoFocus
                        className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--hover-bg)] disabled:opacity-50"
                      >
                        <GoogleMark className="shrink-0" />
                        {submitting ? 'Connecting…' : 'Continue with Google'}
                      </button>
                    </form>
                    <p className="text-center text-xs leading-relaxed text-[var(--text-muted)]">
                      By continuing, you agree to our{' '}
                      <button
                        type="button"
                        onClick={() => {
                          closeSignInModal();
                          onNavigate('privacy', false);
                        }}
                        className="font-medium text-[var(--text-primary)] underline decoration-[var(--text-muted)] underline-offset-2 hover:opacity-90"
                      >
                        Privacy Policy
                      </button>
                      .
                    </p>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </SignInModalContext.Provider>
  );
};
