import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Course } from '../../data/courses';
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

type ChatTurn = { role: 'user' | 'model'; text: string; sourcesUsed?: string[] };

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

  const requestGenerateSkeleton = useCallback(async () => {
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
      const ok = window.confirm(
        'Replace the current course outline (title, description, modules, lessons) with an AI-generated skeleton? Unsaved edits will be lost for those fields.'
      );
      if (!ok) return;
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
      showActionToast('AI skeleton applied. Review and save when ready.', 'success');
    } finally {
      setSkeletonBusy(false);
    }
  }, [apiKey, topic, isDirty, showActionToast, onApplyAiCourse, fallbackCategories, fallbackSkills]);

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

  const applyPendingChatSkeleton = useCallback(() => {
    if (!pendingChatSkeleton) return;
    const d = draftRef.current;
    if (!d) return;
    if (isDirty || courseHasOutlineContent(d)) {
      const ok = window.confirm(
        'Replace the current course outline with the proposal from chat? Unsaved outline edits will be lost.'
      );
      if (!ok) return;
    }
    const next = courseFromAiSkeleton(pendingChatSkeleton, d.id, {
      author: d.author,
      thumbnail: d.thumbnail,
      fallbackCategories,
      fallbackSkills,
    });
    onApplyAiCourse(next);
    setLastDesignNotes(pendingChatSkeleton.designNotes?.trim() || null);
    setPendingChatSkeleton(null);
    showActionToast('Outline from chat applied to draft.', 'success');
  }, [
    pendingChatSkeleton,
    isDirty,
    fallbackCategories,
    fallbackSkills,
    onApplyAiCourse,
    showActionToast,
  ]);

  const clearChat = useCallback(() => {
    setChatTurns([]);
    setChatInput('');
    setPendingChatSkeleton(null);
  }, []);

  if (!draft) return null;

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full touch-manipulation items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
          <Sparkles size={18} className="shrink-0 text-orange-500" aria-hidden />
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
                className="mt-1 size-4 shrink-0 rounded border-[var(--border-color)]"
              />
              <span className="text-xs leading-relaxed text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text-primary)]">Live Google Search grounding</span> — uses
                Gemini&apos;s search tool for current public web pages (syllabus news, board notices). Your Google AI
                billing may include grounded-search usage; see{' '}
                <a
                  href="https://ai.google.dev/gemini-api/docs/google-search"
                  className="text-orange-600 underline hover:text-orange-500"
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
              className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-orange-500/50 focus:outline-none sm:text-sm"
            />
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              With URLs listed, the model can use the{' '}
              <strong className="font-medium text-[var(--text-secondary)]">URL context</strong> tool to read those pages
              (HTML; large PDFs may not load fully). The API allows at most ~20 URLs per lookup — broad index pages like{' '}
              <a
                href="https://ncert.nic.in/textbook.php"
                className="text-orange-600 underline hover:text-orange-500"
                target="_blank"
                rel="noopener noreferrer"
              >
                ncert.nic.in/textbook.php
              </a>{' '}
              expose many links and often trigger that limit; prefer direct book or PDF links, or rely on Live Google
              Search. Up to 18 lines are sent from this box.
            </p>
          </div>

          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-[var(--text-muted)]">
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
              className="w-full min-h-[2.75rem] resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-orange-500/50 focus:outline-none sm:text-sm"
            />
            <button
              type="button"
              disabled={skeletonBusy || !apiKey}
              onClick={() => void requestGenerateSkeleton()}
              className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40 sm:w-auto"
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
                <MessageSquare size={16} className="text-orange-500/90" aria-hidden />
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
                        ? 'ml-4 bg-orange-500/15 text-[var(--text-primary)]'
                        : 'mr-4 bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      {turn.role === 'user' ? 'You' : 'Model'}
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
              <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2">
                <p className="text-xs font-semibold text-[var(--text-primary)]">Outline update ready</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Apply replaces modules, lesson titles, and course fields from the last model reply.
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={applyPendingChatSkeleton}
                    className="inline-flex min-h-11 flex-1 touch-manipulation items-center justify-center rounded-xl bg-orange-500 px-3 py-2 text-sm font-bold text-white hover:bg-orange-600"
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
                  className="mt-1 w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-orange-500/50 focus:outline-none disabled:opacity-50 sm:text-sm"
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
            <p className="text-xs text-amber-800 dark:text-amber-200">Set GEMINI_API_KEY in .env to enable AI tools.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
