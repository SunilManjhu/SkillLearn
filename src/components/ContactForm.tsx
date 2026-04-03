import React, { useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, type User } from '../firebase';
import type { AuthProfileSnapshot } from '../utils/authProfileCache';

export interface ContactFormProps {
  user: User | null;
  isAuthReady: boolean;
  /** Cached session for first paint (same as navbar) — when set before Firebase is ready, skip the spinner and show the form. */
  navUser: User | AuthProfileSnapshot | null;
  onLogin: () => Promise<void>;
}

export const ContactForm: React.FC<ContactFormProps> = ({ user, isAuthReady, navUser, onLogin }) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'subject' | 'message', string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  const validate = (): boolean => {
    const next: typeof fieldErrors = {};
    const sub = subject.trim();
    const msg = message.trim();

    if (!sub) next.subject = 'Please enter a subject.';
    if (!msg) next.message = 'Please enter a message.';

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!user) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      const tokenEmail = user.email ?? '';
      await addDoc(collection(db, 'contactMessages'), {
        subject: subject.trim(),
        message: message.trim(),
        userId: user.uid,
        senderEmail: tokenEmail,
        senderDisplayName: user.displayName ?? '',
        timestamp: serverTimestamp(),
      });
      setSuccess(true);
      setSubject('');
      setMessage('');
      setFieldErrors({});
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'contactMessages');
      setSubmitError('Could not send your message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAuthReady && !navUser) {
    return (
      <div
        className="flex min-h-[min(280px,50dvh)] flex-col items-center justify-center gap-3 px-2 text-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <Loader2 className="h-8 w-8 shrink-0 animate-spin text-orange-500" aria-hidden />
        <p className="text-sm text-[var(--text-secondary)]">Checking sign-in…</p>
      </div>
    );
  }

  if (isAuthReady && !user) {
    return (
      <div className="space-y-6 text-center">
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Sign in with Google to send us a message. We&apos;ll use your account name and email so we can reply.
        </p>
        <button
          type="button"
          disabled={loginSubmitting}
          onClick={async () => {
            setLoginSubmitting(true);
            try {
              await onLogin();
            } finally {
              setLoginSubmitting(false);
            }
          }}
          className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3.5 rounded-xl text-sm font-bold transition-colors"
        >
          <LogIn size={18} />
          {loginSubmitting ? 'Signing in…' : 'Continue with Google'}
        </button>
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center"
        role="status"
      >
        <p className="text-lg font-bold text-[var(--text-primary)] mb-2">Thank you!</p>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          We&apos;ve received your message and will get back to you soon at the email on your account.
        </p>
        <button
          type="button"
          onClick={() => setSuccess(false)}
          className="mt-6 text-sm font-bold text-orange-500 hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <div className="space-y-2">
        <label htmlFor="contact-subject" className="text-sm text-[var(--text-secondary)]">
          Subject
        </label>
        <input
          id="contact-subject"
          type="text"
          autoComplete="off"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            if (fieldErrors.subject) setFieldErrors((p) => ({ ...p, subject: undefined }));
          }}
          className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none"
          aria-invalid={!!fieldErrors.subject}
          aria-describedby={fieldErrors.subject ? 'contact-subject-err' : undefined}
        />
        {fieldErrors.subject && (
          <p id="contact-subject-err" className="text-xs text-red-500">
            {fieldErrors.subject}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <label htmlFor="contact-message" className="text-sm text-[var(--text-secondary)]">
          Message
        </label>
        <textarea
          id="contact-message"
          rows={4}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (fieldErrors.message) setFieldErrors((p) => ({ ...p, message: undefined }));
          }}
          className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none resize-y min-h-[6rem]"
          aria-invalid={!!fieldErrors.message}
          aria-describedby={fieldErrors.message ? 'contact-message-err' : undefined}
        />
        {fieldErrors.message && (
          <p id="contact-message-err" className="text-xs text-red-500">
            {fieldErrors.message}
          </p>
        )}
      </div>
      {submitError && (
        <p className="text-sm text-red-500" role="alert">
          {submitError}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || !user}
        aria-busy={submitting}
        className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:pointer-events-none text-white rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="animate-spin" size={20} aria-hidden />
            Sending…
          </>
        ) : (
          'Send message'
        )}
      </button>
    </form>
  );
};
