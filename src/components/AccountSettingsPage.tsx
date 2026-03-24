import React from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { X } from 'lucide-react';

interface AccountSettingsPageProps {
  onDismiss: () => void;
}

export const AccountSettingsPage: React.FC<AccountSettingsPageProps> = ({ onDismiss }) => {
  useDialogKeyboard({
    open: true,
    onClose: onDismiss,
    onPrimaryAction: onDismiss,
  });

  return (
    <div
      className="w-full max-w-4xl pb-8 pt-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-settings-title"
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between gap-4">
          <h1 id="account-settings-title" className="text-xl font-bold text-[var(--text-primary)]">
            Account Settings
          </h1>
          <button
            type="button"
            onClick={onDismiss}
            className="p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)] shrink-0"
            aria-label="Close account settings"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6 sm:p-8 space-y-6">
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-[var(--border-color)]">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Preferences</h2>
              <p className="text-sm text-[var(--text-secondary)]">Manage your learning and account preferences.</p>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-[var(--text-primary)]">Email Notifications</div>
                  <div className="text-sm text-[var(--text-secondary)]">
                    Receive updates about new courses and activity.
                  </div>
                </div>
                <div className="w-12 h-6 bg-orange-500 rounded-full relative cursor-pointer shrink-0">
                  <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-[var(--text-primary)]">Autoplay Lessons</div>
                  <div className="text-sm text-[var(--text-secondary)]">
                    Automatically start the next lesson in a course.
                  </div>
                </div>
                <div className="w-12 h-6 bg-gray-600 rounded-full relative cursor-pointer shrink-0">
                  <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-[var(--text-primary)]">Public Profile</div>
                  <div className="text-sm text-[var(--text-secondary)]">
                    Allow others to see your progress and certificates.
                  </div>
                </div>
                <div className="w-12 h-6 bg-orange-500 rounded-full relative cursor-pointer shrink-0">
                  <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-[var(--border-color)]">
              <h2 className="text-xl font-bold text-red-500">Danger Zone</h2>
              <p className="text-sm text-[var(--text-secondary)]">Irreversible actions for your account.</p>
            </div>
            <div className="p-6">
              <button
                type="button"
                className="text-red-500 border border-red-500/20 px-6 py-2 rounded-lg font-bold hover:bg-red-500 hover:text-white transition-all"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
