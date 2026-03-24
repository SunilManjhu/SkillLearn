import { useEffect } from 'react';

function isTypingInMultilineOrSelect(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName === 'SELECT') return true;
  return false;
}

function isTextLikeInput(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement) || el.tagName !== 'INPUT') return false;
  const t = (el as HTMLInputElement).type;
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden'].includes(t);
}

function handlesEnterNatively(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.tagName === 'BUTTON') return true;
  if (el.tagName === 'A' && el.hasAttribute('href')) return true;
  return false;
}

/**
 * Escape closes the dialog. Enter activates the primary action when focus is not in a field
 * that uses Enter (textarea, text inputs, selects) and not on a button/link (native activation).
 */
export function useDialogKeyboard(options: {
  open: boolean;
  onClose: () => void;
  onPrimaryAction?: () => void | Promise<void>;
}): void {
  const { open, onClose, onPrimaryAction } = options;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      if (e.repeat) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Enter' && onPrimaryAction) {
        const active = document.activeElement;
        if (isTypingInMultilineOrSelect(active) || isTextLikeInput(active)) return;
        if (handlesEnterNatively(active)) return;
        e.preventDefault();
        void onPrimaryAction();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose, onPrimaryAction]);
}
