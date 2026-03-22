/** Maps Firebase Auth errors to actionable copy for the UI. */
export function formatAuthError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: string }).code);
    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this host';
      return `Firebase is blocking sign-in from “${host}”. In Firebase Console open your project → Build → Authentication → Settings → Authorized domains → Add domain. Enter “${host}” (hostname only, no port). If you use both localhost and 127.0.0.1, add each separately. Save, then try again.`;
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Google sign-in is not enabled for this Firebase project. In Firebase Console go to Build → Authentication → Sign-in method → enable Google.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Network error. Check your connection and try again.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Sign-in was closed before finishing. Try again.';
    }
    if (code === 'auth/cancelled-popup-request') {
      return 'Another sign-in window is already open. Close it and try again.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Pop-up was blocked. Allow pop-ups for this site, or we will try a full-page sign-in next.';
    }
  }
  if (error instanceof Error) return error.message;
  return 'Could not sign in. Try again.';
}
