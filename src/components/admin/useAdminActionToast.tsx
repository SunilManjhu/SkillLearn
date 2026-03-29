import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

export type AdminActionToastVariant = 'success' | 'danger' | 'neutral';

const TOAST_MS = 2200;

/**
 * Mobile-first toast: full width between side insets + safe-area bottom on phones;
 * bottom-right chip from `sm` up. Emerald success, red danger, muted neutral.
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
                className={`pointer-events-none fixed z-[90] w-auto max-w-none rounded-xl border px-3 py-2.5 text-left text-sm font-semibold shadow-2xl backdrop-blur-sm min-w-0 break-words sm:max-w-[min(100vw-3rem,28rem)] left-4 right-4 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] sm:left-auto sm:right-6 sm:bottom-6 sm:w-[min(100vw-3rem,28rem)] ${
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
