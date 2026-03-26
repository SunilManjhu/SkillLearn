import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export type AdminActionToastVariant = 'success' | 'danger';

const TOAST_MS = 2200;

/**
 * Bottom-right toast matching admin catalog styling: emerald for success, red for danger.
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

  const actionToast = (
    <AnimatePresence>
      {text && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className={`pointer-events-none fixed bottom-6 right-6 z-[90] rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-2xl backdrop-blur-sm max-w-[min(100vw-2rem,28rem)] ${
            variant === 'danger'
              ? 'border-red-400/50 bg-red-500/15 text-red-300'
              : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
          }`}
          role="status"
          aria-live="polite"
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return { showActionToast, actionToast };
}
