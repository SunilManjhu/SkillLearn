import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { Type } from '@google/genai';
import { Sparkles, X, Loader2, ChevronRight, Trash2 } from 'lucide-react';
import type { Course } from '../data/courses';
import { parseAssistantReplyJson } from '../utils/parseAssistantReply';
import { formatGenaiError } from '../utils/formatGenaiError';
import { useLearnerGeminiEnabled } from '../hooks/useLearnerGeminiEnabled';
import { useLearnerAiModelsSiteEnabled } from '../hooks/useLearnerAiModelsSiteEnabled';
import { formatContextForGenaiError, generateContentWithModelChain, getGeminiApiKey } from '../utils/geminiClient';

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type ChatTurn =
  | { id: string; role: 'learner'; content: string }
  | { id: string; role: 'assistant'; reply: string; course?: Course; modelUsed?: string }
  | { id: string; role: 'error'; content: string };

const MAX_HISTORY_TURNS = 14;

function formatHistoryForPrompt(msgs: ChatTurn[]): string {
  return msgs
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => {
      if (m.role === 'learner') return `Learner: ${m.content}`;
      if (m.role === 'error') return null;
      if (m.role === 'assistant') {
        const note = m.course ? ` [offered course: ${m.course.title}]` : '';
        return `Assistant: ${m.reply}${note}`;
      }
      return null;
    })
    .filter((line): line is string => line != null)
    .join('\n');
}

const SYSTEM_INSTRUCTION = [
  'You are a warm, professional learning consultant for i-Golden, a technology learning platform.',
  'Behave like a real consultant: be concise, friendly, and helpful.',
  'Handle greetings, thanks, and small talk naturally (briefly).',
  'Answer basic educational questions accurately (e.g. what is Python, what is HTML). Keep explanations clear and not overly long unless the user asks for depth.',
  'Do NOT recommend a course on every message. Use recommendCourseId only when it genuinely helps—e.g. the user asks what to study, wants a path, or your answer naturally leads to "we have a course on that."',
  'When you do suggest a course, mention it gently in your reply and set recommendCourseId to exactly one id from the catalog. Your reply should still read as a conversation, not a sales pitch.',
  'When no course fits or the user is only chatting or asking general facts, set recommendCourseId to null.',
  'You only know the courses listed in the catalog JSON below—do not invent courses.',
].join('\n');

interface DemoLearningAgentProps {
  onOpenCourse: (course: Course) => void;
  courses?: Course[];
}

export function DemoLearningAgent({ onOpenCourse, courses = [] }: DemoLearningAgentProps) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const allowedIds = useMemo(() => new Set(courses.map((c) => c.id)), [courses]);
  const catalogSnippet = useMemo(
    () =>
      courses.map((c) => ({
        id: c.id,
        title: c.title,
        categories: c.categories,
        skills: c.skills,
        level: c.level,
      })),
    [courses]
  );

  const envGeminiKey = getGeminiApiKey();
  const { enabled: userLearnerGeminiOn } = useLearnerGeminiEnabled();
  const { siteLearnerAiModelsEnabled } = useLearnerAiModelsSiteEnabled();
  const learnerGeminiOn = siteLearnerAiModelsEnabled && userLearnerGeminiOn;
  const apiKey = learnerGeminiOn ? envGeminiKey : undefined;
  const hasChatContent = messages.length > 0 || loading;

  useEffect(() => {
    if (!hasChatContent) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open, hasChatContent]);

  const handleClearChat = () => {
    setMessages([]);
    setGoal('');
  };

  const handleSend = async () => {
    const trimmed = goal.trim();
    if (!trimmed || !apiKey) return;

    const userTurn: ChatTurn = { id: newId(), role: 'learner', content: trimmed };
    const historyIncludingUser = [...messages, userTurn];
    const historyText = formatHistoryForPrompt(historyIncludingUser);

    setMessages((prev) => [...prev, userTurn]);
    setGoal('');
    setLoading(true);

    try {
      const contents =
        historyText.length > 0
          ? `Conversation so far:\n${historyText}\n\nReply to the latest user message.`
          : trimmed;
      const config = {
        systemInstruction: `${SYSTEM_INSTRUCTION}\n\nCourse catalog (JSON):\n${JSON.stringify(catalogSnippet)}`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description:
                'Natural conversational reply: answer the user, consult where appropriate, and only soft-sell a course when recommendCourseId is set.',
            },
            recommendCourseId: {
              type: Type.STRING,
              nullable: true,
              description:
                'Set to a catalog course id when offering that course; use null when no course this turn.',
            },
          },
          required: ['reply'],
        },
        temperature: 0.65,
      };

      const gen = await generateContentWithModelChain(apiKey, contents, config);
      const { text, error: genError, modelUsed: assistantModel } = gen;

      if (genError) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'error', content: formatGenaiError(genError, formatContextForGenaiError(gen)) },
        ]);
        return;
      }

      if (!text) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'error', content: 'No response from the model. Try again.' },
        ]);
        return;
      }

      const parsed = parseAssistantReplyJson(text, allowedIds);
      if (parsed.ok === false) {
        setMessages((prev) => [...prev, { id: newId(), role: 'error', content: parsed.error }]);
        return;
      }

      const { reply, recommendCourseId } = parsed.data;
      const course =
        recommendCourseId != null ? courses.find((c) => c.id === recommendCourseId) : undefined;

      if (recommendCourseId != null && !course) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'error', content: 'Suggested course is not in our catalog.' },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          reply,
          ...(course ? { course } : {}),
          ...(assistantModel ? { modelUsed: assistantModel } : {}),
        },
      ]);
    } catch (e) {
      console.error('DemoLearningAgent:', e);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'error', content: formatGenaiError(e) },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const closeAssistant = useCallback(() => setOpen(false), []);

  const assistantPrimaryAction = useCallback(() => {
    if (!loading && goal.trim() && apiKey) void handleSend();
  }, [loading, goal, apiKey, handleSend]);

  useDialogKeyboard({
    open,
    onClose: closeAssistant,
    onPrimaryAction: assistantPrimaryAction,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed z-[60] flex h-14 w-14 touch-manipulation items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] text-orange-500 shadow-lg transition-colors hover:bg-[var(--hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-4 sm:bottom-6 sm:right-6"
        aria-expanded={open}
        aria-label={open ? 'Close learning assistant' : 'Open learning assistant'}
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {open && (
        <div
          className={`fixed z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl max-h-[min(85dvh,32rem)] bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-4 sm:bottom-24 sm:right-6 sm:w-[min(22rem,calc(100vw-3rem))] ${
            hasChatContent ? 'h-[min(85dvh,32rem)]' : ''
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Demo learning assistant"
        >
          <div
            className={`shrink-0 p-4 ${hasChatContent ? 'border-b border-[var(--border-color)]' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">Learning assistant</h2>
              <button
                type="button"
                onClick={handleClearChat}
                disabled={messages.length === 0 && !loading}
                className="shrink-0 rounded-lg border border-[var(--border-color)] p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40"
                title="Clear chat"
                aria-label="Clear chat history"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {!envGeminiKey && (
            <p className="shrink-0 border-b border-[var(--border-color)] px-4 py-3 text-xs text-[var(--text-primary)]">
              Add <code className="rounded bg-[var(--bg-primary)] px-1">GEMINI_API_KEY</code> to{' '}
              <code className="rounded bg-[var(--bg-primary)] px-1">.env</code> (see{' '}
              <code className="rounded bg-[var(--bg-primary)] px-1">.env.example</code>). Keys in the browser are
              for local/demo only; use a backend in production.
            </p>
          )}

          {envGeminiKey && !learnerGeminiOn && (
            <p className="shrink-0 border-b border-[var(--border-color)] px-4 py-3 text-xs leading-relaxed text-[var(--text-primary)]">
              {siteLearnerAiModelsEnabled ? (
                <>
                  Smart Verify is off on this device. Open <strong>Profile</strong> → <strong>Smart Hub</strong> and enable{' '}
                  <strong>Smart Verify</strong> to use the assistant.
                </>
              ) : (
                <>An administrator has turned off learner AI for everyone. The assistant cannot run until they turn it
                back on.</>
              )}
            </p>
          )}

          {hasChatContent && (
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              <ul className="flex flex-col gap-3">
                {messages.map((m) => {
                  if (m.role === 'learner') {
                    return (
                      <li key={m.id} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-orange-500/20 px-3 py-2 text-sm text-[var(--text-primary)]">
                          {m.content}
                        </div>
                      </li>
                    );
                  }
                  if (m.role === 'error') {
                    return (
                      <li key={m.id} className="flex justify-start">
                        <div className="max-w-[90%] rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                          {m.content}
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={m.id} className="flex justify-start">
                      <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                        {m.modelUsed ? (
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                            Model · <span className="font-mono normal-case">{m.modelUsed}</span>
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)] leading-relaxed">
                          {m.reply}
                        </p>
                        {m.course && (
                          <>
                            <p className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">
                              {m.course.title}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                onOpenCourse(m.course!);
                                setOpen(false);
                              }}
                              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 py-2 text-xs font-bold text-orange-500 transition-colors hover:bg-orange-500/20"
                            >
                              Open course
                              <ChevronRight size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
                {loading && (
                  <li className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                      <Loader2 className="animate-spin text-orange-500" size={16} />
                      Thinking…
                    </div>
                  </li>
                )}
              </ul>
              <div ref={bottomRef} className="h-px w-full shrink-0" aria-hidden />
            </div>
          )}

          <div
            className={`shrink-0 p-4 ${hasChatContent ? 'border-t border-[var(--border-color)]' : ''}`}
          >
            <label htmlFor="demo-agent-goal" className="sr-only">
              Message
            </label>
            <textarea
              id="demo-agent-goal"
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Say hi, ask a question, or ask for a course…"
              disabled={loading || !apiKey}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!loading && goal.trim() && apiKey) void handleSend();
                }
              }}
              className="mb-3 w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-orange-500/50 focus:outline-none disabled:opacity-50"
            />

            <button
              type="button"
              disabled={loading || !goal.trim() || !apiKey}
              onClick={() => void handleSend()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              <Sparkles size={18} />
              {loading ? 'Working…' : 'Send'}
            </button>
            <p className="mt-2 text-center text-[10px] text-[var(--text-muted)]">
              Enter to send · Shift+Enter for newline
            </p>
          </div>
        </div>
      )}
    </>
  );
}
