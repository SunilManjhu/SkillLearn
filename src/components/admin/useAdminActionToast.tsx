import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

export type AdminActionToastVariant = 'success' | 'danger' | 'neutral';

const TOAST_MS = 2200;

/**
 * Bottom-right toast: emerald success, red danger, muted neutral (e.g. no-op actions).
 */
export function useAdminActionToast() {
  const [text, setText] = useState<string | null>(null);
  const [variant, setVariant] = useState<AdminActionToastVariant>('success');
  const hideTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    },
    []
  );

  const showActionToast = useCallback((msg: string, v: AdminActionToastVariant = 'success') => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setVariant(v);
    setText(msg);
    hideTimerRef.current = window.setTimeout(() => {
      setText(null);
      hideTimerRef.current = null;
    }, TOAST_MS);
  }, []);

  /** Portal avoids `space-y-*` / scroll ancestors treating the toast as a flow sibling (fixes layout jump). */
  const actionToast =
    typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            {text && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className={`pointer-events-none fixed bottom-6 right-6 z-[90] rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-2xl backdrop-blur-sm max-w-[min(100vw-2rem,28rem)] ${
                  variant === 'danger'
                    ? 'border-red-500/45 bg-red-500/15 text-red-800 dark:border-red-400/50 dark:text-red-200'
                    : variant === 'neutral'
                      ? 'border-[var(--border-color)] bg-[var(--hover-bg)] text-[var(--text-secondary)]'
                      : 'border-emerald-500/45 bg-emerald-500/15 text-emerald-900 dark:border-emerald-400/40 dark:text-emerald-200'
                }`}
                role="status"
                aria-live="polite"
              >
                {text}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )
      : null;

  return { showActionToast, actionToast };
}
