import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Course } from '../../data/courses';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import {
  compactOutlineForChat,
  courseFromAiSkeleton,
  generateCourseSkeletonFromTopic,
  parseReferenceUrlsFromText,
  refineOutlineWithChat,
  type AiCourseSkeleton,
  type CourseAgentWebOptions,
} from '../../utils/geminiCourseAgent';

/** NCERT/CBSE Class 10 Social Science is four textbooks — cap must allow ≥4 top-level modules. */
const OUTLINE_MAX_MODULES = 6;
/** NCERT books often have 5–7 chapters per subject; backend allows up to 8. */
const OUTLINE_MAX_LESSONS_PER_MODULE = 8;

function courseHasOutlineContent(course: Course): boolean {
  if (course.title.trim()) return true;
  if (course.description.trim()) return true;
  for (const mod of course.modules) {
    if (mod.title.trim()) return true;
    for (const les of mod.lessons) {
      if (les.title.trim()) return true;
    }
  }
  return false;
}

export type AdminCourseAiAssistantProps = {
  draft: Course | null;
  apiKey: string | undefined;
  isDirty: boolean;
  showActionToast: (message: string, tone?: 'danger' | 'success') => void;
  onApplyAiCourse: (course: Course) => void;
  fallbackCategories: string[];
  fallbackSkills: string[];
};

type ChatTurn = { role: 'user' | 'model'; text: string; sourcesUsed?: string[]; modelId?: string };

export function AdminCourseAiAssistant({
  draft,
  apiKey,
  isDirty,
  showActionToast,
  onApplyAiCourse,
  fallbackCategories,
  fallbackSkills,
}: AdminCourseAiAssistantProps) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [topicHint, setTopicHint] = useState('');
  const [skeletonBusy, setSkeletonBusy] = useState(false);
  const [lastDesignNotes, setLastDesignNotes] = useState<string | null>(null);
  const [lastSkeletonSources, setLastSkeletonSources] = useState<string[] | null>(null);
  const [useGoogleSearch, setUseGoogleSearch] = useState(true);
  const [referenceUrlsText, setReferenceUrlsText] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [pendingChatSkeleton, setPendingChatSkeleton] = useState<AiCourseSkeleton | null>(null);
  const [outlineReplaceDialog, setOutlineReplaceDialog] = useState<null | 'skeleton' | 'chatApply'>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatTurnsRef = useRef(chatTurns);
  chatTurnsRef.current = chatTurns;

  const webOptionsRef = useRef<CourseAgentWebOptions>({ googleSearch: true });
  webOptionsRef.current = {
    googleSearch: useGoogleSearch,
    referenceUrls: parseReferenceUrlsFromText(referenceUrlsText),
  };

  const outlineReplaceKindRef = useRef(outlineReplaceDialog);
  outlineReplaceKindRef.current = outlineReplaceDialog;

  const closeOutlineReplaceDialog = useCallback(() => setOutlineReplaceDialog(null), []);

  const runGenerateSkeleton = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed) {
      showActionToast('Enter a topic first.', 'danger');
      return;
    }
    if (!apiKey) {
      showActionToast('Set GEMINI_API_KEY in .env to use AI course tools.', 'danger');
      return;
    }
    const d = draftRef.current;
    if (!d) {
      showActionToast('Select or create a course first.', 'danger');
      return;
    }

    setSkeletonBusy(true);
    try {
      const res = await generateCourseSkeletonFromTopic({
        apiKey,
        topic: trimmed,
        maxModules: OUTLINE_MAX_MODULES,
        maxLessonsPerModule: OUTLINE_MAX_LESSONS_PER_MODULE,
        web: webOptionsRef.current,
      });
      if (res.ok === false) {
        showActionToast(res.error, 'danger');
        return;
      }
      const next = courseFromAiSkeleton(res.skeleton, d.id, {
        author: d.author,
        thumbnail: d.thumbnail,
        fallbackCategories,
        fallbackSkills,
      });
      onApplyAiCourse(next);
      setTopicHint(trimmed);
      setLastDesignNotes(res.skeleton.designNotes?.trim() || null);
      setLastSkeletonSources(res.sourcesUsed ?? null);
      showActionToast(
        res.modelUsed
          ? `AI skeleton applied using ${res.modelUsed}. Review and save when ready.`
          : 'AI skeleton applied. Review and save when ready.',
        'success'
      );
    } finally {
      setSkeletonBusy(false);
    }
  }, [apiKey, topic, showActionToast, onApplyAiCourse, fallbackCategories, fallbackSkills]);

  const runGenerateSkeletonRef = useRef(runGenerateSkeleton);
  runGenerateSkeletonRef.current = runGenerateSkeleton;

  const requestGenerateSkeleton = useCallback(() => {
    const trimmed = topic.trim();
    if (!trimmed) {
      showActionToast('Enter a topic first.', 'danger');
      return;
    }
    if (!apiKey) {
      showActionToast('Set GEMINI_API_KEY in .env to use AI course tools.', 'danger');
      return;
    }
    const d = draftRef.current;
    if (!d) {
      showActionToast('Select or create a course first.', 'danger');
      return;
    }
    if (isDirty || courseHasOutlineContent(d)) {
      setOutlineReplaceDialog('skeleton');
      return;
    }
    void runGenerateSkeleton();
  }, [apiKey, topic, isDirty, showActionToast, runGenerateSkeleton]);

  useEffect(() => {
    if (!open || chatTurns.length === 0) return;
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [open, chatTurns.length, chatBusy]);

  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    if (!apiKey) {
      showActionToast('Set GEMINI_API_KEY in .env to use chat.', 'danger');
      return;
    }
    const d = draftRef.current;
    if (!d) {
      showActionToast('Select or create a course first.', 'danger');
      return;
    }

    setChatInput('');
    setPendingChatSkeleton(null);
    const historyAfterUser = [...chatTurnsRef.current, { role: 'user' as const, text }];
    setChatTurns(historyAfterUser);
    setChatBusy(true);
    try {
      const res = await refineOutlineWithChat({
        apiKey,
        history: historyAfterUser,
        outlineJson: compactOutlineForChat(d),
        maxModules: OUTLINE_MAX_MODULES,
        maxLessonsPerModule: OUTLINE_MAX_LESSONS_PER_MODULE,
        web: webOptionsRef.current,
      });
      if (res.ok === false) {
        showActionToast(res.error, 'danger');
        setChatTurns((prev) => prev.slice(0, -1));
        setChatInput(text);
        return;
      }
      const withModel = [
        ...historyAfterUser,
        {
          role: 'model' as const,
          text: res.reply,
          ...(res.sourcesUsed?.length ? { sourcesUsed: res.sourcesUsed } : {}),
          ...(res.modelUsed ? { modelId: res.modelUsed } : {}),
        },
      ];
      setChatTurns(withModel);
      if (res.skeleton) {
        setPendingChatSkeleton(res.skeleton);
      }
    } finally {
      setChatBusy(false);
    }
  }, [apiKey, chatInput, chatBusy, showActionToast]);

  const runApplyChatSkeleton = useCallback(() => {
    if (!pendingChatSkeleton) return;
    const d = draftRef.current;
    if (!d) return;
    const next = courseFromAiSkeleton(pendingChatSkeleton, d.id, {
      author: d.author,
      thumbnail: d.thumbnail,
      fallbackCategories,
      fallbackSkills,
    });
    onApplyAiCourse(next);
    setLastDesignNotes(pendingChatSkeleton.designNotes?.trim() || null);
    setPendingChatSkeleton(null);
    const lastModelId = [...chatTurnsRef.current]
      .reverse()
      .find((t) => t.role === 'model' && t.modelId)?.modelId;
    showActionToast(
      lastModelId
        ? `Outline from chat applied (last reply: ${lastModelId}).`
        : 'Outline from chat applied to draft.',
      'success'
    );
  }, [pendingChatSkeleton, fallbackCategories, fallbackSkills, onApplyAiCourse, showActionToast]);

  const runApplyChatSkeletonRef = useRef(runApplyChatSkeleton);
  runApplyChatSkeletonRef.current = runApplyChatSkeleton;

  const confirmOutlineReplaceDialog = useCallback(() => {
    const kind = outlineReplaceKindRef.current;
    setOutlineReplaceDialog(null);
    if (kind === 'skeleton') void runGenerateSkeletonRef.current();
    else if (kind === 'chatApply') runApplyChatSkeletonRef.current();
  }, []);

  useBodyScrollLock(outlineReplaceDialog !== null);
  useDialogKeyboard({
    open: outlineReplaceDialog !== null,
    onClose: closeOutlineReplaceDialog,
    onPrimaryAction: confirmOutlineReplaceDialog,
  });

  const applyPendingChatSkeleton = useCallback(() => {
    if (!pendingChatSkeleton) return;
    const d = draftRef.current;
    if (!d) return;
    if (isDirty || courseHasOutlineContent(d)) {
      setOutlineReplaceDialog('chatApply');
      return;
    }
    runApplyChatSkeleton();
  }, [pendingChatSkeleton, isDirty, runApplyChatSkeleton]);

  const clearChat = useCallback(() => {
    setChatTurns([]);
    setChatInput('');
    setPendingChatSkeleton(null);
  }, []);

  if (!draft) return null;

  const outlineReplaceIsSkeleton = outlineReplaceDialog === 'skeleton';

  return (
    <>
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full touch-manipulation items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
          <Sparkles size={18} className="shrink-0 text-admin-icon" aria-hidden />
          <span className="truncate">AI course assistant</span>
        </span>
        {open ? (
          <ChevronDown size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
        ) : (
          <ChevronRight size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-[var(--border-color)] px-4 py-4">
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">
            Generate a draft outline from a topic and refine it with chat. Set lesson video URLs manually in the catalog
            editor.
          </p>
          <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/30 px-3 py-3">
            <p className="text-xs font-semibold text-[var(--text-primary)]">Web &amp; official sources</p>
            <label className="flex min-h-11 cursor-pointer touch-manipulation items-start gap-3">
              <input
                type="checkbox"
                checked={useGoogleSearch}
                onChange={(e) => setUseGoogleSearch(e.target.checked)}
                className="mt-1 size-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
              />
              <span className="text-xs leading-relaxed text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text-primary)]">Live Google Search grounding</span> — uses
                Gemini&apos;s search tool for current public web pages (syllabus news, board notices). Your Google AI
                billing may include grounded-search usage; see{' '}
                <a
                  href="https://ai.google.dev/gemini-api/docs/google-search"
                  className="text-[#616161] underline hover:text-[#616161]"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Gemini: Grounding with Google Search
                </a>
                .
              </span>
            </label>
            <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="admin-ai-ref-urls">
              Official document URLs (optional, one per line)
            </label>
            <textarea
              id="admin-ai-ref-urls"
              value={referenceUrlsText}
              onChange={(e) => setReferenceUrlsText(e.target.value)}
              placeholder="https://ncert.nic.in/…&#10;https://cbseacademic.nic.in/…"
              rows={3}
              className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[#8b8c8c]/90 focus:outline-none sm:text-sm"
            />
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              With URLs listed, the model can use the{' '}
              <strong className="font-medium text-[var(--text-secondary)]">URL context</strong> tool to read those pages
              (HTML; large PDFs may not load fully). The API allows at most ~20 URLs per lookup — broad index pages like{' '}
              <a
                href="https://ncert.nic.in/textbook.php"
                className="text-[#616161] underline hover:text-[#616161]"
                target="_blank"
                rel="noopener noreferrer"
              >
                ncert.nic.in/textbook.php
              </a>{' '}
              expose many links and often trigger that limit; prefer direct book or PDF links, or rely on Live Google
              Search. Up to 18 lines are sent from this box.
            </p>
          </div>

          <div className="rounded-lg border border-[#8b8c8c]/65 bg-[#757676]/10 px-3 py-2 text-xs leading-relaxed text-[var(--text-muted)]">
            {useGoogleSearch || parseReferenceUrlsFromText(referenceUrlsText).length > 0 ? (
              <>
                <span className="font-semibold text-[var(--text-primary)]">Grounding on: </span>
                The model may use search and/or your URLs; check{' '}
                <strong className="font-semibold text-[var(--text-secondary)]">Sources</strong> under chat when the API
                returns them. Still verify critical policy on the original site.
              </>
            ) : (
              <>
                <span className="font-semibold text-[var(--text-primary)]">Grounding off: </span>
                Outlines use training data only unless you enable search or add URLs.
              </>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="admin-ai-course-topic">
              Topic
            </label>
            <textarea
              id="admin-ai-course-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Python for data analysis"
              rows={2}
              className="w-full min-h-[2.75rem] resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[#8b8c8c]/90 focus:outline-none sm:text-sm"
            />
            <button
              type="button"
              disabled={skeletonBusy || !apiKey}
              onClick={() => void requestGenerateSkeleton()}
              className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-[#616161] px-4 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40 sm:w-auto"
            >
              {skeletonBusy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
              Generate skeleton
            </button>
            {lastDesignNotes ? (
              <details className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--text-primary)] touch-manipulation min-h-11 py-2">
                  Model notes (latest outline)
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-muted)]">
                  {lastDesignNotes}
                </p>
              </details>
            ) : null}
            {lastSkeletonSources && lastSkeletonSources.length > 0 ? (
              <details className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--text-primary)] touch-manipulation min-h-11 py-2">
                  Sources (last skeleton generation)
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-[var(--text-muted)]">
                  {lastSkeletonSources.map((line, i) => (
                    <li key={i} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          <div className="border-t border-[var(--border-color)] pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <MessageSquare size={16} className="text-admin-icon opacity-90" aria-hidden />
                Refine outline (chat)
              </span>
              {chatTurns.length > 0 ? (
                <button
                  type="button"
                  onClick={clearChat}
                  className="inline-flex min-h-9 touch-manipulation items-center gap-1 rounded-lg border border-[var(--border-color)] px-2 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                >
                  <Trash2 size={14} aria-hidden />
                  Clear chat
                </button>
              ) : null}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Ask for changes (e.g. &quot;Add a module on testing&quot;, &quot;Shorten module 2&quot;). When the model
              returns an outline update, apply it to the draft with the button below.
            </p>
            <div
              ref={chatScrollRef}
              className="max-h-48 min-h-[4rem] space-y-2 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-3 py-2"
              aria-label="Outline chat messages"
            >
              {chatTurns.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No messages yet.</p>
              ) : (
                chatTurns.map((turn, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-2 py-1.5 text-xs leading-relaxed ${
                      turn.role === 'user'
                        ? 'ml-4 bg-[#616161]/15 text-[var(--text-primary)]'
                        : 'mr-4 bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      {turn.role === 'user' ? (
                        'You'
                      ) : (
                        <>
                          Model
                          {turn.modelId ? (
                            <>
                              {' '}
                              · <span className="font-mono font-normal normal-case">{turn.modelId}</span>
                            </>
                          ) : null}
                        </>
                      )}
                    </span>
                    <span className="whitespace-pre-wrap">{turn.text}</span>
                    {turn.role === 'model' && turn.sourcesUsed && turn.sourcesUsed.length > 0 ? (
                      <details className="mt-2 border-t border-[var(--border-color)]/60 pt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] touch-manipulation">
                          Sources from this reply
                        </summary>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-[var(--text-muted)]">
                          {turn.sourcesUsed.map((line, j) => (
                            <li key={j} className="break-words">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {pendingChatSkeleton ? (
              <div className="rounded-lg border border-[#8b8c8c]/80 bg-[#616161]/10 px-3 py-2">
                <p className="text-xs font-semibold text-[var(--text-primary)]">Outline update ready</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Apply replaces modules, lesson titles, and course fields from the last model reply.
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={applyPendingChatSkeleton}
                    className="inline-flex min-h-11 flex-1 touch-manipulation items-center justify-center rounded-xl bg-[#616161] px-3 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676]"
                  >
                    Apply outline to draft
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingChatSkeleton(null)}
                    className="inline-flex min-h-11 flex-1 touch-manipulation items-center justify-center rounded-xl border border-[var(--border-color)] px-3 py-2 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-xs font-semibold text-[var(--text-secondary)]">
                <span className="sr-only">Message</span>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendChatMessage();
                    }
                  }}
                  placeholder="Ask to adjust the outline…"
                  rows={2}
                  disabled={chatBusy}
                  className="mt-1 w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[#8b8c8c]/90 focus:outline-none disabled:opacity-50 sm:text-sm"
                />
              </label>
              <button
                type="button"
                disabled={chatBusy || !apiKey || !chatInput.trim()}
                onClick={() => void sendChatMessage()}
                className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl bg-[var(--bg-secondary)] px-4 py-2 text-sm font-bold text-[var(--text-primary)] ring-1 ring-[var(--border-color)] hover:bg-[var(--hover-bg)] disabled:opacity-40"
              >
                {chatBusy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
                Send
              </button>
            </div>
          </div>

          {!apiKey ? (
            <p className="text-xs text-[#393a3a] app-dark:text-[#cfcfcf]">Set GEMINI_API_KEY in .env to enable AI tools.</p>
          ) : null}
        </div>
      )}
    </div>

      <AnimatePresence>
        {outlineReplaceDialog ? (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-[#272828]/75 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-sm sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-ai-outline-replace-title"
            aria-describedby="admin-ai-outline-replace-desc"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeOutlineReplaceDialog();
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] p-4 sm:p-6">
                <h2
                  id="admin-ai-outline-replace-title"
                  className="text-lg font-bold text-[var(--text-primary)] sm:text-xl"
                >
                  Replace course outline?
                </h2>
                <button
                  type="button"
                  onClick={closeOutlineReplaceDialog}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} className="text-[var(--text-secondary)]" aria-hidden />
                </button>
              </div>
              <div
                id="admin-ai-outline-replace-desc"
                className="p-4 text-sm leading-relaxed text-[var(--text-secondary)] sm:p-6"
              >
                {outlineReplaceIsSkeleton ? (
                  <p>
                    Replace the current course outline (title, description, modules, lessons) with an AI-generated
                    skeleton? Unsaved edits will be lost for those fields.
                  </p>
                ) : (
                  <p>
                    Replace the current course outline with the proposal from chat? Unsaved outline edits will be lost.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3 border-t border-[var(--border-color)] p-4 sm:flex-row sm:justify-end sm:gap-3 sm:p-6">
                <button
                  type="button"
                  autoFocus
                  onClick={confirmOutlineReplaceDialog}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#757676] sm:w-auto"
                >
                  {outlineReplaceIsSkeleton ? 'Replace with AI skeleton' : 'Apply outline'}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
