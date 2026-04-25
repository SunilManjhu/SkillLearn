import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useSignInModal } from './SignInModalProvider';

/** Home hero CTA for signed-out users — opens the shared sign-in modal (no `#/signin` route). */
export function GuestHomeSignInCta() {
  const { openSignInModal } = useSignInModal();
  return (
    <button
      type="button"
      onClick={() => openSignInModal()}
      className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md bg-brand-500 px-6 py-4 text-white transition-colors hover:bg-brand-600 sm:flex-initial sm:px-8"
    >
      <span className="flex items-center gap-2 font-bold">
        Get started free
        <ChevronRight size={20} />
      </span>
      <span className="text-sm font-medium text-white/90">Sign in with Google</span>
    </button>
  );
}
