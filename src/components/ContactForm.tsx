import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

const WEB3FORMS_URL = 'https://api.web3forms.com/submit';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const ContactForm: React.FC = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'firstName' | 'lastName' | 'email' | 'message', string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY as string | undefined;

  const validate = (): boolean => {
    const next: typeof fieldErrors = {};
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim();
    const msg = message.trim();

    if (!fn) next.firstName = 'Please enter your first name.';
    if (!ln) next.lastName = 'Please enter your last name.';
    if (!em) next.email = 'Please enter your email.';
    else if (!isValidEmail(em)) next.email = 'Please enter a valid email address.';
    if (!msg) next.message = 'Please enter a message.';

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    if (!accessKey?.trim()) {
      setSubmitError('The contact form is not configured. Please try again later.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(WEB3FORMS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: accessKey.trim(),
          subject: 'SkillStream: Contact form message',
          name: `${firstName.trim()} ${lastName.trim()}`,
          email: email.trim(),
          message: message.trim(),
        }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string };
      if (!res.ok || !data.success) {
        setSubmitError(data.message || 'Something went wrong. Please try again.');
        return;
      }
      setSuccess(true);
      setFirstName('');
      setLastName('');
      setEmail('');
      setMessage('');
      setFieldErrors({});
    } catch {
      setSubmitError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center"
        role="status"
      >
        <p className="text-lg font-bold text-[var(--text-primary)] mb-2">Thank you!</p>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          We&apos;ve received your message and will get back to you soon at the email you provided.
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
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="contact-first-name" className="text-sm text-[var(--text-secondary)]">
            First Name
          </label>
          <input
            id="contact-first-name"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              if (fieldErrors.firstName) setFieldErrors((p) => ({ ...p, firstName: undefined }));
            }}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none"
            aria-invalid={!!fieldErrors.firstName}
            aria-describedby={fieldErrors.firstName ? 'contact-first-name-err' : undefined}
          />
          {fieldErrors.firstName && (
            <p id="contact-first-name-err" className="text-xs text-red-500">
              {fieldErrors.firstName}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="contact-last-name" className="text-sm text-[var(--text-secondary)]">
            Last Name
          </label>
          <input
            id="contact-last-name"
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              if (fieldErrors.lastName) setFieldErrors((p) => ({ ...p, lastName: undefined }));
            }}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none"
            aria-invalid={!!fieldErrors.lastName}
            aria-describedby={fieldErrors.lastName ? 'contact-last-name-err' : undefined}
          />
          {fieldErrors.lastName && (
            <p id="contact-last-name-err" className="text-xs text-red-500">
              {fieldErrors.lastName}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="contact-email" className="text-sm text-[var(--text-secondary)]">
          Email
        </label>
        <input
          id="contact-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
          }}
          className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none"
          aria-invalid={!!fieldErrors.email}
          aria-describedby={fieldErrors.email ? 'contact-email-err' : undefined}
        />
        {fieldErrors.email && (
          <p id="contact-email-err" className="text-xs text-red-500">
            {fieldErrors.email}
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
        disabled={submitting}
        className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:pointer-events-none text-white rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="animate-spin" size={20} aria-hidden />
            Sending…
          </>
        ) : (
          'Send Message'
        )}
      </button>
    </form>
  );
};
