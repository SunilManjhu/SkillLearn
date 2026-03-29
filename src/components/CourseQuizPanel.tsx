import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useLearnerGeminiEnabled } from '../hooks/useLearnerGeminiEnabled';
import { useLearnerAiModelsSiteEnabled } from '../hooks/useLearnerAiModelsSiteEnabled';
import type { Lesson, QuizDefinition, QuizQuestion } from '../data/courses';
import type { User } from '../firebase';
import { getGeminiApiKey } from '../utils/geminiClient';
import {
  gradeFreeformAnswer,
  probeIncorrectMcq,
  probeWeakFreeform,
  revealFreeformModelAnswer,
  resolveMcqCorrectIndex,
} from '../utils/geminiQuiz';
import { saveQuizAttempt, type QuizAttemptPerQuestion } from '../utils/quizAttemptsFirestore';
import { coerceQuizIndex, mcqIndicesMatch } from '../utils/quizCoercion';

export interface CourseQuizPanelProps {
  courseId: string;
  courseTitle: string;
  lesson: Lesson;
  quiz: QuizDefinition;
  user: User | null;
  onMarkComplete: () => void;
  /** Marks quiz complete and opens the next lesson (or course end flow). */
  onGoToNextLesson: () => void;
}

type AnswerState = Record<string, { mcqIndex?: number; text?: string }>;

type McqResult = {
  questionId: string;
  type: 'mcq';
  score: number;
  correct: boolean;
  chosenIndex: number;
  /** Factual correct option (AI-resolved when API key present; else matches stored key). */
  truthIndex: number;
};

type FreeformResult = {
  questionId: string;
  type: 'freeform';
  score: number;
  feedback: string;
};

type QuestionResult = McqResult | FreeformResult;

/** Open-ended answers at or above this score count as passed. */
const FREEFORM_PASS_THRESHOLD = 65;

const STATIC_MCQ_HINT =
  'Re-read the question, rule out options that contradict what you learned, then pick the best remaining choice.';

const STATIC_FREEFORM_HINT =
  'Reread the question and rubric, add one concrete example or definition, then submit a revised answer.';

function isPassedResult(q: QuizQuestion, r: QuestionResult): boolean {
  if (r.type === 'mcq') return r.correct;
  return r.score >= FREEFORM_PASS_THRESHOLD;
}

function emptyAnswers(questions: QuizQuestion[]): AnswerState {
  const o: AnswerState = {};
  for (const q of questions) {
    o[q.id] = q.type === 'mcq' ? { mcqIndex: undefined } : { text: '' };
  }
  return o;
}

const QUIZ_PANEL_STORAGE_V = 1;

type PersistedQuizPanel = {
  v: typeof QUIZ_PANEL_STORAGE_V;
  questionIds: string[];
  nonPassingSubmitCount: number;
  submitted: boolean;
  allPassed: boolean;
  overallScore: number | null;
  results: QuestionResult[] | null;
  passedResults: Record<string, QuestionResult>;
  answers: AnswerState;
  hintUsedById: Record<string, boolean>;
  hintTextById: Record<string, string>;
  answerRevealById: Record<string, string>;
  /** After two failed full submits, learner tapped “Next lesson”; UI then offers “Start over” instead. */
  usedNextLessonBypass?: boolean;
};

type ReviewSnapshot = {
  overallScore: number;
  allPassed: boolean;
  results: QuestionResult[];
  nonPassingSubmitCount: number;
};

export function CourseQuizPanel({
  courseId,
  courseTitle: _courseTitle,
  lesson,
  quiz,
  user,
  onMarkComplete,
  onGoToNextLesson,
}: CourseQuizPanelProps) {
  void _courseTitle;
  const questions = quiz.questions;
  const [answers, setAnswers] = useState<AnswerState>(() => emptyAnswers(questions));
  const [passedResults, setPassedResults] = useState<Record<string, QuestionResult>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<QuestionResult[] | null>(null);
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [allPassed, setAllPassed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptSaved, setAttemptSaved] = useState<boolean | null>(null);

  /** One AI (or static) hint per question after a wrong graded attempt. */
  const [hintUsedById, setHintUsedById] = useState<Record<string, boolean>>({});
  const [hintTextById, setHintTextById] = useState<Record<string, string>>({});
  const [hintErrById, setHintErrById] = useState<Record<string, string>>({});
  const [hintLoadingById, setHintLoadingById] = useState<Record<string, boolean>>({});

  /** Submissions that did not clear every question; at 2+ we offer only “Next lesson”. */
  const [nonPassingSubmitCount, setNonPassingSubmitCount] = useState(0);

  /** Hydrated from localStorage after leaving and returning to this quiz. */
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);

  /** After “Next lesson” from the 2-fail path; primary action becomes “Start over” (scores reset). */
  const [usedNextLessonBypass, setUsedNextLessonBypass] = useState(false);

  /** Last graded attempt kept visible after “Take quiz again” (new blank attempt below). */
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(null);

  /** Shown after student used hint and submitted again still wrong. */
  const [answerRevealById, setAnswerRevealById] = useState<Record<string, string>>({});

  const storageKey = useMemo(() => `skilllearn:quizPanel:${courseId}:${lesson.id}`, [courseId, lesson.id]);
  const questionIdsSig = useMemo(() => questions.map((q) => q.id).join('\0'), [questions]);

  const envGeminiKey = getGeminiApiKey();
  const { enabled: userLearnerGeminiOn } = useLearnerGeminiEnabled();
  const { siteLearnerAiModelsEnabled } = useLearnerAiModelsSiteEnabled();
  const learnerGeminiOn = siteLearnerAiModelsEnabled && userLearnerGeminiOn;
  const apiKey = learnerGeminiOn ? envGeminiKey : undefined;
  const hasFreeform = questions.some((q) => q.type === 'freeform');
  const hasMcq = questions.some((q) => q.type === 'mcq');

  const isLocked = useCallback(
    (q: QuizQuestion) => {
      const r = passedResults[q.id];
      return r != null && isPassedResult(q, r);
    },
    [passedResults]
  );

  useEffect(() => {
    setError(null);
    setAttemptSaved(null);
    setSubmitting(false);
    setReviewSnapshot(null);

    const resetFresh = () => {
      setAnswers(emptyAnswers(questions));
      setPassedResults({});
      setSubmitted(false);
      setResults(null);
      setOverallScore(null);
      setAllPassed(false);
      setHintUsedById({});
      setHintTextById({});
      setHintErrById({});
      setHintLoadingById({});
      setAnswerRevealById({});
      setNonPassingSubmitCount(0);
      setRestoredFromStorage(false);
      setUsedNextLessonBypass(false);
    };

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw) as PersistedQuizPanel;
        if (
          p?.v === QUIZ_PANEL_STORAGE_V &&
          Array.isArray(p.questionIds) &&
          Array.isArray(p.results) &&
          p.submitted
        ) {
          const sig = p.questionIds.join('\0');
          if (sig === questionIdsSig) {
            setAnswers({ ...emptyAnswers(questions), ...(p.answers ?? {}) });
            setPassedResults(typeof p.passedResults === 'object' && p.passedResults ? p.passedResults : {});
            setSubmitted(true);
            setResults(p.results);
            setOverallScore(typeof p.overallScore === 'number' ? p.overallScore : null);
            setAllPassed(!!p.allPassed);
            setNonPassingSubmitCount(
              typeof p.nonPassingSubmitCount === 'number' ? p.nonPassingSubmitCount : 0
            );
            setHintUsedById(typeof p.hintUsedById === 'object' && p.hintUsedById ? p.hintUsedById : {});
            setHintTextById(typeof p.hintTextById === 'object' && p.hintTextById ? p.hintTextById : {});
            setAnswerRevealById(
              typeof p.answerRevealById === 'object' && p.answerRevealById ? p.answerRevealById : {}
            );
            setUsedNextLessonBypass(!!p.usedNextLessonBypass);
            setRestoredFromStorage(true);
            return;
          }
        }
        localStorage.removeItem(storageKey);
      }
    } catch {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }
    resetFresh();
  }, [lesson.id, storageKey, questionIdsSig, questions]);

  const setMcq = useCallback((qid: string, idx: number) => {
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], mcqIndex: idx } }));
  }, []);

  const setText = useCallback((qid: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], text } }));
  }, []);

  const validateFilled = useCallback((): string | null => {
    for (const q of questions) {
      if (isLocked(q)) continue;
      const a = answers[q.id];
      if (!a) return 'Answer every question that still needs a try.';
      if (q.type === 'mcq') {
        if (a.mcqIndex === undefined || a.mcqIndex < 0) return 'Select an option for each multiple-choice question that still needs a try.';
      } else if (!String(a.text ?? '').trim()) {
        return 'Write an answer for each open-ended question that still needs a try.';
      }
    }
    return null;
  }, [answers, isLocked, questions]);

  const handleSubmit = useCallback(async () => {
    const v = validateFilled();
    if (v) {
      setError(v);
      return;
    }
    setReviewSnapshot(null);
    if (hasFreeform) {
      if (!envGeminiKey) {
        setError('Open-ended questions need AI grading. Set GEMINI_API_KEY in your environment.');
        return;
      }
      if (!learnerGeminiOn) {
        setError(
          'Open-ended questions need AI grading. In Profile → Models, turn on Use AI models.'
        );
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    setAttemptSaved(null);

    const out: QuestionResult[] = [];
    const perQuestion: QuizAttemptPerQuestion[] = [];
    const nextPassed: Record<string, QuestionResult> = { ...passedResults };

    try {
      for (const q of questions) {
        const carried = passedResults[q.id];
        if (carried && isPassedResult(q, carried)) {
          if (carried.type === 'mcq') {
            const normalized: McqResult = {
              ...carried,
              truthIndex: carried.truthIndex ?? coerceQuizIndex(q.correctIndex) ?? 0,
            };
            out.push(normalized);
            perQuestion.push({
              questionId: q.id,
              type: 'mcq',
              score: normalized.score,
              correct: normalized.correct,
              chosenIndex: normalized.chosenIndex,
            });
          } else {
            out.push(carried);
            perQuestion.push({
              questionId: q.id,
              type: 'freeform',
              score: carried.score,
              aiFeedback: carried.feedback,
            });
          }
          continue;
        }

        const a = answers[q.id]!;
        if (q.type === 'mcq') {
          const chosenIndex = a.mcqIndex!;
          let truthIndex = coerceQuizIndex(q.correctIndex) ?? 0;
          if (apiKey) {
            const resolved = await resolveMcqCorrectIndex({
              apiKey,
              questionPrompt: q.prompt,
              choices: q.choices,
            });
            if (resolved.ok) truthIndex = resolved.correctIndex;
          }
          const correct = mcqIndicesMatch(chosenIndex, truthIndex);
          const score = correct ? 100 : 0;
          const newR: McqResult = {
            questionId: q.id,
            type: 'mcq',
            score,
            correct,
            chosenIndex,
            truthIndex,
          };
          out.push(newR);
          perQuestion.push({
            questionId: q.id,
            type: 'mcq',
            score,
            correct,
            chosenIndex,
          });
          if (correct) nextPassed[q.id] = newR;
        } else {
          const studentAnswer = String(a.text ?? '').trim();
          const graded = await gradeFreeformAnswer({
            apiKey: apiKey!,
            questionPrompt: q.prompt,
            rubric: q.rubric ?? '',
            studentAnswer,
          });
          if (!graded.ok) {
            setError(graded.error);
            setSubmitting(false);
            return;
          }
          const newR: FreeformResult = {
            questionId: q.id,
            type: 'freeform',
            score: graded.score,
            feedback: graded.feedback,
          };
          out.push(newR);
          perQuestion.push({
            questionId: q.id,
            type: 'freeform',
            score: graded.score,
            aiFeedback: graded.feedback,
          });
          if (isPassedResult(q, newR)) nextPassed[q.id] = newR;
        }
      }

      const passed = questions.every((q) => {
        const r = out.find((x) => x.questionId === q.id);
        return r != null && isPassedResult(q, r);
      });

      const avg = Math.round(out.reduce((s, r) => s + r.score, 0) / out.length);

      const revealUpdates: Record<string, string> = {};
      if (!passed) {
        for (const q of questions) {
          const r = out.find((x) => x.questionId === q.id);
          if (!r || isPassedResult(q, r)) continue;
          if (!hintUsedById[q.id]) continue;
          if (q.type === 'mcq' && r.type === 'mcq') {
            revealUpdates[q.id] = q.choices[r.truthIndex] ?? '';
          } else if (apiKey) {
            const rev = await revealFreeformModelAnswer({
              apiKey,
              questionPrompt: q.prompt,
              rubric: q.rubric ?? '',
            });
            revealUpdates[q.id] = rev.ok
              ? rev.answer
              : q.rubric?.trim() || 'Review the lesson for the main ideas, then try again.';
          } else {
            revealUpdates[q.id] = q.rubric?.trim() || 'Review the lesson and try again with more specific detail.';
          }
        }
      }

      setPassedResults(nextPassed);
      setResults(out);
      setOverallScore(avg);
      setAllPassed(passed);
      setSubmitted(true);
      if (passed) {
        setNonPassingSubmitCount(0);
        setAnswerRevealById({});
        setHintTextById({});
        setHintUsedById({});
        setHintErrById({});
      } else if (Object.keys(revealUpdates).length > 0) {
        setAnswerRevealById((prev) => ({ ...prev, ...revealUpdates }));
      }

      if (!passed) {
        setNonPassingSubmitCount((c) => c + 1);
      }

      if (user?.uid) {
        const saved = await saveQuizAttempt({
          userId: user.uid,
          courseId,
          lessonId: lesson.id,
          overallScore: avg,
          perQuestion,
        });
        setAttemptSaved(saved);
      } else {
        setAttemptSaved(false);
      }

      if (passed) {
        onMarkComplete();
      }
    } catch (e) {
      console.error('CourseQuizPanel submit:', e);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }, [
    answers,
    apiKey,
    courseId,
    envGeminiKey,
    hasFreeform,
    hintUsedById,
    learnerGeminiOn,
    lesson.id,
    onMarkComplete,
    passedResults,
    questions,
    user,
    validateFilled,
  ]);

  const fetchHintOnce = useCallback(
    async (q: QuizQuestion) => {
      if (hintUsedById[q.id] || hintLoadingById[q.id]) return;
      const r = results?.find((x) => x.questionId === q.id);
      if (!r || isPassedResult(q, r)) return;

      setHintErrById((prev) => {
        const next = { ...prev };
        delete next[q.id];
        return next;
      });
      setHintLoadingById((prev) => ({ ...prev, [q.id]: true }));

      try {
        if (q.type === 'mcq' && r.type === 'mcq') {
          if (!apiKey) {
            setHintTextById((prev) => ({ ...prev, [q.id]: STATIC_MCQ_HINT }));
            setHintUsedById((prev) => ({ ...prev, [q.id]: true }));
            return;
          }
          const wrongText = q.choices[r.chosenIndex] ?? '';
          const pr = await probeIncorrectMcq({
            apiKey,
            questionPrompt: q.prompt,
            choices: q.choices,
            selectedChoiceText: wrongText,
          });
          if (!pr.ok) {
            setHintErrById((prev) => ({ ...prev, [q.id]: pr.error }));
            return;
          }
          const hintBody = pr.probe.trim() ? pr.probe : STATIC_MCQ_HINT;
          setHintTextById((prev) => ({ ...prev, [q.id]: hintBody }));
          setHintUsedById((prev) => ({ ...prev, [q.id]: true }));
        } else if (q.type === 'freeform' && r.type === 'freeform') {
          if (!apiKey) {
            setHintTextById((prev) => ({ ...prev, [q.id]: STATIC_FREEFORM_HINT }));
            setHintUsedById((prev) => ({ ...prev, [q.id]: true }));
            return;
          }
          const pr = await probeWeakFreeform({
            apiKey,
            questionPrompt: q.prompt,
            rubric: q.rubric ?? '',
            hintContext: q.hintContext,
            studentAnswer: String(answers[q.id]?.text ?? '').trim(),
            score: r.score,
            graderFeedback: r.feedback,
          });
          if (!pr.ok) {
            setHintErrById((prev) => ({ ...prev, [q.id]: pr.error }));
            return;
          }
          const hintBody = pr.probe.trim() ? pr.probe : STATIC_FREEFORM_HINT;
          setHintTextById((prev) => ({ ...prev, [q.id]: hintBody }));
          setHintUsedById((prev) => ({ ...prev, [q.id]: true }));
        }
      } finally {
        setHintLoadingById((prev) => {
          const next = { ...prev };
          delete next[q.id];
          return next;
        });
      }
    },
    [answers, apiKey, hintLoadingById, hintUsedById, results]
  );

  const handleRetake = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setReviewSnapshot(null);
    setRestoredFromStorage(false);
    setUsedNextLessonBypass(false);
    setAnswers(emptyAnswers(questions));
    setPassedResults({});
    setSubmitted(false);
    setResults(null);
    setOverallScore(null);
    setAllPassed(false);
    setError(null);
    setAttemptSaved(null);
    setHintUsedById({});
    setHintTextById({});
    setHintErrById({});
    setHintLoadingById({});
    setAnswerRevealById({});
    setNonPassingSubmitCount(0);
  }, [questions, storageKey]);

  const handleTakeQuizAgain = useCallback(() => {
    if (overallScore !== null && results && results.length > 0) {
      setReviewSnapshot({
        overallScore,
        allPassed,
        results: results.map((r) => ({ ...r })),
        nonPassingSubmitCount,
      });
    } else {
      setReviewSnapshot(null);
    }
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setRestoredFromStorage(false);
    setUsedNextLessonBypass(false);
    setAnswers(emptyAnswers(questions));
    setPassedResults({});
    setSubmitted(false);
    setResults(null);
    setOverallScore(null);
    setAllPassed(false);
    setError(null);
    setAttemptSaved(null);
    setHintUsedById({});
    setHintTextById({});
    setHintErrById({});
    setHintLoadingById({});
    setAnswerRevealById({});
    setNonPassingSubmitCount(0);
  }, [questions, storageKey, overallScore, allPassed, results, nonPassingSubmitCount]);

  const handleNextLessonAfterFailures = useCallback(() => {
    if (submitted && results && results.length > 0) {
      setUsedNextLessonBypass(true);
      const payload: PersistedQuizPanel = {
        v: QUIZ_PANEL_STORAGE_V,
        questionIds: questions.map((q) => q.id),
        nonPassingSubmitCount,
        submitted,
        allPassed,
        overallScore,
        results,
        passedResults,
        answers,
        hintUsedById,
        hintTextById,
        answerRevealById,
        usedNextLessonBypass: true,
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {
        /* ignore quota */
      }
    }
    onGoToNextLesson();
  }, [
    answers,
    allPassed,
    answerRevealById,
    hintTextById,
    hintUsedById,
    nonPassingSubmitCount,
    onGoToNextLesson,
    overallScore,
    passedResults,
    questions,
    results,
    storageKey,
    submitted,
  ]);

  useEffect(() => {
    if (!submitted || !results || results.length === 0) return;
    const payload: PersistedQuizPanel = {
      v: QUIZ_PANEL_STORAGE_V,
      questionIds: questions.map((q) => q.id),
      nonPassingSubmitCount,
      submitted,
      allPassed,
      overallScore,
      results,
      passedResults,
      answers,
      hintUsedById,
      hintTextById,
      answerRevealById,
      usedNextLessonBypass: usedNextLessonBypass || undefined,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      /* ignore quota */
    }
  }, [
    storageKey,
    submitted,
    allPassed,
    overallScore,
    results,
    passedResults,
    answers,
    hintUsedById,
    hintTextById,
    answerRevealById,
    nonPassingSubmitCount,
    questions,
    usedNextLessonBypass,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-[var(--bg-secondary)] p-4 text-left text-[var(--text-primary)] sm:p-6">
      {hasFreeform && envGeminiKey && !learnerGeminiOn ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {siteLearnerAiModelsEnabled ? (
            <>
              AI grading is off on this device. Open <strong>Profile</strong> → <strong>Models</strong> and turn on{' '}
              <strong>Use AI models</strong> to submit open-ended answers.
            </>
          ) : (
            <>An administrator has turned off learner AI for everyone, so open-ended grading is unavailable.</>
          )}
        </div>
      ) : null}

      {!learnerGeminiOn && hasMcq ? (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          {siteLearnerAiModelsEnabled ? (
            <>
              With <strong>Use AI models</strong> off on this device, multiple-choice is graded only against the{' '}
              <strong>answer key stored in the course</strong>. If that key is wrong, turn AI back on for automatic
              fact-checking, or ask the author to fix it in Admin (quiz editor → <strong>Check key with AI</strong>).
            </>
          ) : (
            <>
              An administrator has turned off learner AI. Multiple-choice uses only the{' '}
              <strong>stored answer key</strong>; AI hints and key checking are unavailable until they turn it back on.
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1 border-b border-[var(--border-color)]/60 pb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Quiz</p>
        <h2 className="text-lg font-bold leading-snug sm:text-xl">{lesson.title}</h2>
        {lesson.about?.trim() ? (
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{lesson.about.trim()}</p>
        ) : null}
      </div>

      {restoredFromStorage && submitted ? (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          You&apos;re viewing a saved attempt on this device. Use <strong>Take quiz again</strong> below to retry;
          your scores stay visible for review until then.
        </div>
      ) : null}

      {submitted && !allPassed && (nonPassingSubmitCount >= 2 || !restoredFromStorage) ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {nonPassingSubmitCount >= 2 ? (
            <p>
              You can move on with <strong>Next lesson</strong> below. This lesson will be marked complete.
            </p>
          ) : (
            <p>
              For any incorrect question, use <strong>Hint</strong> once for AI guidance. If you still miss after
              submitting again, the <strong>correct answer</strong> is shown. Open-ended needs {FREEFORM_PASS_THRESHOLD}
              %+ to pass.
            </p>
          )}
        </div>
      ) : null}

      {submitted && allPassed ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          You passed every question. This lesson is marked complete.
        </div>
      ) : null}

      {reviewSnapshot ? (
        <div
          className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4"
          aria-label="Previous quiz attempt for review"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Previous attempt</p>
          <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">
            Score: <span className="text-orange-500">{reviewSnapshot.overallScore}%</span>
            {reviewSnapshot.allPassed ? (
              <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">Passed all</span>
            ) : (
              <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                {reviewSnapshot.nonPassingSubmitCount >= 2 ? 'You could move on after this run.' : 'For reference only'}
              </span>
            )}
          </p>
          <ul className="mt-3 flex flex-col gap-2 border-t border-[var(--border-color)]/60 pt-3">
            {questions.map((q, idx) => {
              const r = reviewSnapshot.results.find((x) => x.questionId === q.id);
              if (!r) return null;
              const ok = isPassedResult(q, r);
              return (
                <li key={`prev-${q.id}`} className="text-sm">
                  <span className="font-medium text-[var(--text-primary)]">
                    {idx + 1}.{' '}
                    <span className="font-normal text-[var(--text-secondary)]">{q.prompt}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                    {r.type === 'mcq' ? (
                      ok ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Correct</span>
                      ) : (
                        <span className="text-red-500">Incorrect</span>
                      )
                    ) : (
                      <>
                        <span className={ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
                          {r.score}% {ok ? '(passed)' : `(need ${FREEFORM_PASS_THRESHOLD}%+)`}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <ol className="flex flex-col gap-6">
        {questions.map((q, idx) => {
          const locked = isLocked(q);
          const showResult = submitted && results;
          const r = showResult ? (results.find((x) => x.questionId === q.id) as McqResult | FreeformResult | undefined) : undefined;
          const passedNow = r != null && isPassedResult(q, r);
          const revealText = answerRevealById[q.id];
          const showRevealedAnswer = Boolean(revealText);
          const revealCorrectMcq = q.type === 'mcq' && r?.type === 'mcq' && passedNow;
          const mcqTruthIdx =
            q.type !== 'mcq'
              ? 0
              : r?.type === 'mcq'
                ? (r.truthIndex ?? coerceQuizIndex(q.correctIndex) ?? 0)
                : coerceQuizIndex(q.correctIndex) ?? 0;

          return (
            <li key={q.id} className="list-none">
              <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
                <span className="text-[var(--text-muted)]">{idx + 1}. </span>
                {q.prompt}
                {locked ? (
                  <span className="ml-2 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    Passed
                  </span>
                ) : null}
              </p>
              {q.type === 'mcq' ? (
                <fieldset disabled={locked} className="space-y-2">
                  <legend className="sr-only">Choices</legend>
                  {q.choices.map((choice, ci) => {
                    const selected = mcqIndicesMatch(answers[q.id]?.mcqIndex, ci);
                    const wrong =
                      showResult &&
                      r &&
                      r.type === 'mcq' &&
                      !r.correct &&
                      !locked &&
                      mcqIndicesMatch(r.chosenIndex, ci);
                    const right =
                      (revealCorrectMcq && mcqIndicesMatch(ci, mcqTruthIdx)) ||
                      (showRevealedAnswer && mcqIndicesMatch(ci, mcqTruthIdx));
                    return (
                      <label
                        key={ci}
                        className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          wrong
                            ? 'border-red-500/60 bg-red-500/10'
                            : right
                              ? 'border-emerald-500/60 bg-emerald-500/10'
                              : selected
                                ? 'border-orange-500/50 bg-orange-500/10'
                                : 'border-[var(--border-color)] bg-[var(--bg-primary)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`quiz-${q.id}`}
                          checked={selected}
                          onChange={() => setMcq(q.id, ci)}
                          className="mt-1 h-4 w-4 shrink-0 border-[var(--border-color)] text-orange-500"
                        />
                        <span className="min-w-0 flex-1 leading-relaxed">{choice}</span>
                      </label>
                    );
                  })}
                  {showResult && r && r.type === 'mcq' ? (
                    <div className="flex flex-col gap-2">
                      <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                        {passedNow ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Correct</span>
                        ) : (
                          <>
                            <span className="text-red-500">Incorrect.</span>
                            {!hintUsedById[q.id] && !showRevealedAnswer ? (
                              <button
                                type="button"
                                onClick={() => void fetchHintOnce(q)}
                                disabled={!!hintLoadingById[q.id]}
                                className="inline-flex min-h-9 min-w-[44px] items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-200"
                              >
                                {hintLoadingById[q.id] ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : null}
                                Hint
                              </button>
                            ) : null}
                          </>
                        )}
                      </p>
                      {hintErrById[q.id] ? (
                        <p className="text-xs text-red-500">{hintErrById[q.id]}</p>
                      ) : null}
                      {hintTextById[q.id] && !passedNow ? (
                        <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)]">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            Hint
                          </p>
                          <p className="mt-1">{hintTextById[q.id]}</p>
                        </div>
                      ) : null}
                      {showRevealedAnswer ? (
                        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)]">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                            Correct answer
                          </p>
                          <p className="mt-1 font-medium">{revealText}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </fieldset>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={answers[q.id]?.text ?? ''}
                    onChange={(e) => setText(q.id, e.target.value)}
                    disabled={locked}
                    rows={4}
                    className="w-full resize-y rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] disabled:opacity-80"
                    placeholder="Your answer"
                  />
                  {showResult && r && r.type === 'freeform' ? (
                    <>
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm">
                        <p className="font-semibold text-[var(--text-primary)]">
                          Score: <span className="text-orange-500">{r.score}%</span>
                          {!passedNow ? (
                            <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                              (need {FREEFORM_PASS_THRESHOLD}%+ to pass)
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">{r.feedback}</p>
                      </div>
                      {!passedNow ? (
                        <div className="flex flex-col gap-2">
                          <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                            <span className="text-red-500">Not passing yet.</span>
                            {!hintUsedById[q.id] && !showRevealedAnswer ? (
                              <button
                                type="button"
                                onClick={() => void fetchHintOnce(q)}
                                disabled={!!hintLoadingById[q.id]}
                                className="inline-flex min-h-9 min-w-[44px] items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-200"
                              >
                                {hintLoadingById[q.id] ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : null}
                                Hint
                              </button>
                            ) : null}
                          </p>
                          {hintErrById[q.id] ? (
                            <p className="text-xs text-red-500">{hintErrById[q.id]}</p>
                          ) : null}
                          {hintTextById[q.id] ? (
                            <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)]">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Hint
                              </p>
                              <p className="mt-1">{hintTextById[q.id]}</p>
                            </div>
                          ) : null}
                          {showRevealedAnswer ? (
                            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)]">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                                Correct answer
                              </p>
                              <p className="mt-1 whitespace-pre-wrap font-medium">{revealText}</p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {submitted && overallScore !== null ? (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <p className="text-sm font-bold text-[var(--text-primary)]">
            Overall: <span className="text-orange-500">{overallScore}%</span>
            {!allPassed ? <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">(in progress)</span> : null}
          </p>
          {user?.uid ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {attemptSaved === true
                ? 'This attempt was saved to your account.'
                : attemptSaved === false
                  ? 'Could not save this attempt to the server.'
                  : null}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Sign in to save quiz attempts to your account. Progress is still stored on this device.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!allPassed && nonPassingSubmitCount >= 2 ? (
          usedNextLessonBypass ? (
            <button
              type="button"
              onClick={handleRetake}
              className="inline-flex min-h-11 min-w-[44px] w-full items-center justify-center rounded-xl border border-[var(--border-color)] px-4 py-3 text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] sm:w-auto sm:px-8"
            >
              Start over
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNextLessonAfterFailures}
              className="inline-flex min-h-11 min-w-[44px] w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 sm:w-auto sm:px-8"
            >
              Next lesson
              <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
            </button>
          )
        ) : restoredFromStorage && submitted ? (
          <button
            type="button"
            onClick={handleTakeQuizAgain}
            className="inline-flex min-h-11 min-w-[44px] w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 sm:w-auto sm:px-8"
          >
            Take quiz again
            <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
          </button>
        ) : (
          <>
            {!allPassed ? (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="inline-flex min-h-11 min-w-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50 sm:flex-none sm:px-8"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
                {submitting ? 'Grading…' : submitted ? 'Submit again' : 'Submit quiz'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleRetake}
              className="inline-flex min-h-11 min-w-[44px] items-center justify-center rounded-xl border border-[var(--border-color)] px-4 py-3 text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--hover-bg)]"
            >
              Start over
            </button>
          </>
        )}
      </div>
    </div>
  );
}
