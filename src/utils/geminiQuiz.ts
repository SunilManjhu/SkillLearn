import { Type } from '@google/genai';
import { formatGenaiError } from './formatGenaiError';
import { formatContextForGenaiError, generateContentWithModelChain } from './geminiClient';
import { coerceQuizIndex, coerceScore0to100 } from './quizCoercion';

const GRADE_SYSTEM = [
  'You grade short learner answers for an online course quiz. Be fair and slightly generous when in doubt.',
  'The app treats 70+ as PASSING. If the answer is factually correct OR shows clear understanding of the main idea, score at least 75.',
  'If mostly right with small omissions or informal wording, score 70–90.',
  'Use 90–100 when the answer fully satisfies the question and rubric.',
  'Use 50–69 only for partial or shaky understanding; 0–49 for wrong, off-topic, or empty.',
  'Do not penalize for brevity if the content is correct. Do not demand exact wording from the rubric.',
  'Use the instructor rubric as guidance, not as a literal answer key.',
  'Respond with JSON only: integer score 0–100 and brief constructive feedback (1–4 sentences).',
].join('\n');

export async function gradeFreeformAnswer(params: {
  apiKey: string;
  questionPrompt: string;
  rubric: string;
  studentAnswer: string;
}): Promise<{ ok: true; score: number; feedback: string } | { ok: false; error: string }> {
  const rubricBlock = params.rubric.trim() || 'Assess understanding and factual accuracy.';
  const contents = [
    'Grade this submission. Passing is 70+; give 70+ when the student demonstrates the right idea or correct facts.',
    '',
    `Question:\n${params.questionPrompt}`,
    '',
    `Instructor rubric (guidance, not exact-match required):\n${rubricBlock}`,
    '',
    `Student answer:\n${params.studentAnswer}`,
  ].join('\n');

  const gen = await generateContentWithModelChain(params.apiKey, contents, {
    systemInstruction: GRADE_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        score: {
          type: Type.NUMBER,
          description:
            'Integer 0–100. Use 70+ if answer is correct or substantially right; 90+ if fully satisfies the question.',
        },
        feedback: { type: Type.STRING, description: 'Brief constructive feedback' },
      },
      required: ['score', 'feedback'],
    },
    temperature: 0.25,
  });
  const { text, error } = gen;

  if (error) {
    return { ok: false, error: formatGenaiError(error, formatContextForGenaiError(gen)) };
  }
  if (!text) {
    return { ok: false, error: 'No response from the model. Try again.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Could not parse grading response.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid grading response shape.' };
  }
  const rec = parsed as Record<string, unknown>;
  const scoreCoerced = coerceScore0to100(rec.score);
  const feedback = rec.feedback;
  if (scoreCoerced === null) {
    return { ok: false, error: 'Invalid score in response.' };
  }
  const score = scoreCoerced;
  if (typeof feedback !== 'string' || !feedback.trim()) {
    return { ok: false, error: 'Invalid feedback in response.' };
  }
  return { ok: true, score, feedback: feedback.trim() };
}

const PROBE_MCQ_SYSTEM = [
  'The student answered a multiple-choice quiz question incorrectly.',
  'Reply in JSON with a single field "probe": 2–4 short sentences.',
  'The probe should nudge them toward the right concept (Socratic, concrete).',
  'Do NOT name which option is correct, do NOT use letters (A/B/C), indices, or quote the correct option text.',
  'You may briefly reference the idea behind their wrong choice vs what the question is really asking.',
].join('\n');

const PROBE_FREEFORM_SYSTEM = [
  'The student submitted a weak open-ended quiz answer (score below passing).',
  'Reply in JSON with a single field "probe": 2–4 short sentences.',
  'Use the grader feedback as context; add a fresh nudge toward what to rethink or add.',
  'Do NOT paste a full model answer or rewrite their response for them.',
  'Optional hintContext is safe to use for direction; instructor rubric is for your eyes only—do not quote it verbatim.',
].join('\n');

export async function probeIncorrectMcq(params: {
  apiKey: string;
  questionPrompt: string;
  choices: string[];
  selectedChoiceText: string;
}): Promise<{ ok: true; probe: string } | { ok: false; error: string }> {
  const choicesBlock = params.choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const contents = [
    'Generate a probing hint for the learner.',
    '',
    `Question:\n${params.questionPrompt}`,
    '',
    `Options (numbered for your reading only — do not tell the student which number is correct):\n${choicesBlock}`,
    '',
    `What the student selected (incorrect):\n${params.selectedChoiceText}`,
  ].join('\n');

  const genMcq = await generateContentWithModelChain(params.apiKey, contents, {
    systemInstruction: PROBE_MCQ_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        probe: { type: Type.STRING, description: 'Short probing hint, no answer reveal' },
      },
      required: ['probe'],
    },
    temperature: 0.45,
  });
  const { text, error } = genMcq;

  if (error) return { ok: false, error: formatGenaiError(error, formatContextForGenaiError(genMcq)) };
  if (!text) return { ok: false, error: 'No response from the model. Try again.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Could not parse probe response.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid probe response shape.' };
  }
  const probe = (parsed as Record<string, unknown>).probe;
  if (typeof probe !== 'string' || !probe.trim()) {
    return { ok: true, probe: '' };
  }
  return { ok: true, probe: probe.trim() };
}

export async function probeWeakFreeform(params: {
  apiKey: string;
  questionPrompt: string;
  rubric: string;
  hintContext?: string;
  studentAnswer: string;
  score: number;
  graderFeedback: string;
}): Promise<{ ok: true; probe: string } | { ok: false; error: string }> {
  const rubricBlock = params.rubric.trim() || '(No separate rubric.)';
  const hint = params.hintContext?.trim() || '(None.)';
  const contents = [
    'Generate a follow-up probe so the learner can revise their answer.',
    '',
    `Question:\n${params.questionPrompt}`,
    '',
    `Instructor rubric (internal):\n${rubricBlock}`,
    '',
    `Optional hint context:\n${hint}`,
    '',
    `Student answer:\n${params.studentAnswer}`,
    '',
    `Score (0–100): ${params.score}`,
    '',
    `Grader feedback:\n${params.graderFeedback}`,
  ].join('\n');

  const genFf = await generateContentWithModelChain(params.apiKey, contents, {
    systemInstruction: PROBE_FREEFORM_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        probe: { type: Type.STRING, description: 'Nudge to revise; no full model answer' },
      },
      required: ['probe'],
    },
    temperature: 0.4,
  });
  const { text, error } = genFf;

  if (error) return { ok: false, error: formatGenaiError(error, formatContextForGenaiError(genFf)) };
  if (!text) return { ok: false, error: 'No response from the model. Try again.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Could not parse probe response.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid probe response shape.' };
  }
  const probe = (parsed as Record<string, unknown>).probe;
  if (typeof probe !== 'string' || !probe.trim()) {
    return { ok: true, probe: '' };
  }
  return { ok: true, probe: probe.trim() };
}

const RESOLVE_MCQ_SYSTEM = [
  'You verify multiple-choice keys for educational quizzes.',
  'Given the question and the list of options with 0-based indices, return the index of the single factually correct option.',
  'Use standard science/chemistry facts for STEM questions. Ignore any assumption about which option was "marked" by an author—pick the one that is actually correct.',
  'If two options seem partially correct, choose the one that best matches how the question is phrased.',
].join('\n');

/**
 * Fact-check which option is correct (fixes wrong author keys and complements Firestore parse fixes).
 */
export async function resolveMcqCorrectIndex(params: {
  apiKey: string;
  questionPrompt: string;
  choices: string[];
}): Promise<{ ok: true; correctIndex: number } | { ok: false; error: string }> {
  if (params.choices.length < 2) {
    return { ok: false, error: 'Not enough choices.' };
  }
  const list = params.choices.map((c, i) => `${i}: ${c}`).join('\n');
  const contents = [
    'Which option index is correct? Respond with JSON only.',
    '',
    `Question:\n${params.questionPrompt}`,
    '',
    `Options:\n${list}`,
  ].join('\n');

  const genResolve = await generateContentWithModelChain(params.apiKey, contents, {
    systemInstruction: RESOLVE_MCQ_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        correctIndex: {
          type: Type.NUMBER,
          description: `Integer 0 to ${params.choices.length - 1}`,
        },
      },
      required: ['correctIndex'],
    },
    temperature: 0.15,
  });
  const { text, error } = genResolve;

  if (error) return { ok: false, error: formatGenaiError(error, formatContextForGenaiError(genResolve)) };
  if (!text) return { ok: false, error: 'No response from the model.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Could not parse resolution response.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid resolution shape.' };
  }
  const idx = coerceQuizIndex((parsed as Record<string, unknown>).correctIndex);
  if (idx === null || idx < 0 || idx >= params.choices.length) {
    return { ok: false, error: 'Model returned an invalid index.' };
  }
  return { ok: true, correctIndex: idx };
}

const REVEAL_FREEFORM_SYSTEM = [
  'The learner failed an open-ended quiz question even after a hint. Provide a clear exemplar answer they can learn from.',
  'Use 3–8 sentences. Be accurate and directly address the question.',
  'Use the instructor rubric as a guide for what a strong answer should include.',
  'This text will be shown to the student as the reference answer.',
].join('\n');

/** Shown after hint + another failed attempt (open-ended only). */
export async function revealFreeformModelAnswer(params: {
  apiKey: string;
  questionPrompt: string;
  rubric: string;
}): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  const rubricBlock = params.rubric.trim() || 'Cover the main ideas the question asks for.';
  const contents = [
    'Write the exemplar answer as JSON only.',
    '',
    `Question:\n${params.questionPrompt}`,
    '',
    `Rubric / key points:\n${rubricBlock}`,
  ].join('\n');

  const genReveal = await generateContentWithModelChain(params.apiKey, contents, {
    systemInstruction: REVEAL_FREEFORM_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        answer: { type: Type.STRING, description: 'Complete exemplar answer for the learner' },
      },
      required: ['answer'],
    },
    temperature: 0.35,
  });
  const { text, error } = genReveal;

  if (error) return { ok: false, error: formatGenaiError(error, formatContextForGenaiError(genReveal)) };
  if (!text) return { ok: false, error: 'No response from the model. Try again.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Could not parse exemplar response.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid exemplar response shape.' };
  }
  const answer = (parsed as Record<string, unknown>).answer;
  if (typeof answer !== 'string' || !answer.trim()) {
    return { ok: false, error: 'Empty exemplar answer.' };
  }
  return { ok: true, answer: answer.trim() };
}
