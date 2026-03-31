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
  const hideDeadlineRef = useRef<number | null>(null);
  const remainingMsRef = useRef<number>(TOAST_MS);
  const pausedRef = useRef(false);

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
    pausedRef.current = false;
    remainingMsRef.current = TOAST_MS;
    hideDeadlineRef.current = Date.now() + TOAST_MS;
    hideTimerRef.current = window.setTimeout(() => {
      setText(null);
      hideTimerRef.current = null;
      hideDeadlineRef.current = null;
    }, TOAST_MS);
  }, []);

  const pause = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const dl = hideDeadlineRef.current;
    if (dl != null) {
      remainingMsRef.current = Math.max(0, dl - Date.now());
      hideDeadlineRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    if (text == null) return;
    const ms = Math.max(250, remainingMsRef.current || 0);
    hideDeadlineRef.current = Date.now() + ms;
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    hideTimerRef.current = window.setTimeout(() => {
      setText(null);
      hideTimerRef.current = null;
      hideDeadlineRef.current = null;
    }, ms);
  }, [text]);

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
                onMouseEnter={pause}
                onMouseLeave={resume}
                onFocus={pause}
                onBlur={resume}
                tabIndex={0}
                className={`pointer-events-auto fixed z-[90] w-auto max-w-none whitespace-pre-line rounded-xl border px-3 py-2.5 text-left text-sm font-semibold shadow-2xl backdrop-blur-sm min-w-0 break-words sm:max-w-[min(100vw-3rem,28rem)] left-4 right-4 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] sm:left-auto sm:right-6 sm:bottom-6 sm:w-[min(100vw-3rem,28rem)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 ${
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
