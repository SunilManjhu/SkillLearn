import { Type, type Tool } from '@google/genai';
import type { Course, CourseLevel } from '../data/courses';
import { dedupeLabelsPreserveOrder } from './courseTaxonomy';
import { formatGenaiError, isGeminiUrlContextUrlLimitError } from './formatGenaiError';
import { formatContextForGenaiError, generateContentWithModelChain } from './geminiClient';
import { mergeGroundingSourceLines } from './geminiGroundingSummary';

/** Optional Google Search + URL context for syllabus / official sources (Gemini API tools). */
export type CourseAgentWebOptions = {
  googleSearch?: boolean;
  referenceUrls?: string[];
};

/** Gemini allows at most 20 URLs per URL-context lookup; stay under so the model can add few if any. */
const MAX_REFERENCE_URLS_FOR_CONTEXT = 18;

const URL_CONTEXT_LOOKUP_RULES =
  'URL context (hard API limit: 20 URLs per lookup): When calling the url_context tool, pass ONLY the URLs listed below—never more than that count in one call. Do not bulk-add every hyperlink scraped from a navigation or index page (e.g. ncert.nic.in/textbook.php is a class/subject hub with many links; including them all causes a 400 error). Prefer fetching only the user-listed URLs; use Google Search if you need additional specific pages.';

const URL_CONTEXT_RETRY_USER_NOTE =
  'Important: A prior URL-context attempt failed because too many URLs were requested in one lookup (Gemini limit: 20). For this response, do not use URL context for bulk link lists. Use Google Search to locate specific NCERT/CBSE syllabus or PDF pages if needed.';

function normalizeReferenceUrls(urls: string[] | undefined): string[] {
  if (!urls?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_REFERENCE_URLS_FOR_CONTEXT) break;
  }
  return out;
}

/** One URL per line from admin textarea. */
export function parseReferenceUrlsFromText(block: string): string[] {
  return normalizeReferenceUrls(block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
}

function buildCourseAgentTools(web: CourseAgentWebOptions | undefined): Tool[] | undefined {
  const urls = normalizeReferenceUrls(web?.referenceUrls);
  const tools: Tool[] = [];
  if (web?.googleSearch) tools.push({ googleSearch: {} });
  if (urls.length > 0) tools.push({ urlContext: {} });
  return tools.length ? tools : undefined;
}

function augmentContentsWithReferenceUrls(base: string, urls: string[]): string {
  if (!urls.length) return base;
  return [
    base,
    '',
    URL_CONTEXT_LOOKUP_RULES,
    '',
    'Reference URLs — use the URL context tool to read these pages when checking official curriculum, rationalized syllabi, or publication updates:',
    ...urls.map((u) => `- ${u}`),
  ].join('\n');
}

const MAX_OUTLINE_CHAT_TURNS = 14;

const PLACEHOLDER_VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

const LEVELS: CourseLevel[] = ['Beginner', 'Intermediate', 'Advanced', 'Proficient'];

const SKELETON_SYSTEM = [
  'You are an instructional designer for i-Golden, an online tech learning platform.',
  'Given a topic, output a concise course skeleton as JSON only.',
  'Use clear module and lesson titles. No lesson body text.',
  'Do not include video URLs — lessons are video placeholders only.',
  'When the topic is CBSE/NCERT Class 9–12 Social Science / Social Studies (English or bilingual), the standard is often four NCERT books — use one module per book when that fits: History (India and the Contemporary World), Geography (Contemporary India), Political Science/Civics (Democratic Politics), Economics (Understanding Economic Development). Adjust naming if the topic specifies another board or language.',
  'For each such textbook module, prefer one lesson per official chapter in that book (e.g. Class 10 History has five chapters) up to the max lessons-per-module limit in the user message.',
  `Stay within at most MAX_MODULES modules and MAX_LESSONS_PER_MODULE lessons per module (counts in user message).`,
  'Level must be one of: Beginner, Intermediate, Advanced, Proficient.',
  'Duration should be a short human string (e.g. "4h", "2h 30m").',
  'Categories and skills are short labels; omit unknowns (empty arrays are ok).',
  'Always set designNotes (2–5 sentences): structuring approach, assumptions, audience. If no web tools: note training-knowledge limits. If web tools are enabled: summarize what you verified via search or official URLs.',
].join('\n');

const REFINE_CHAT_SYSTEM = [
  'You help admins refine course outlines for i-Golden (online learning).',
  'You receive the current outline as JSON and a chat transcript (User / Model turns).',
  'Be constructive and specific. Do NOT send long refusals or policy lectures about browsing the web.',
  'If web tools are disabled: you cannot open live URLs — say so briefly if relevant, then help from training knowledge and pasted text.',
  'If web tools are enabled: use Google Search and/or URL context on the listed reference URLs to verify syllabus, rationalized curriculum, or official wording when the user asks; then answer in JSON.',
  'For school boards, NCERT, CBSE, state syllabi, or "rationalized 2025–26" requests: propose a sensible module/lesson structure from typical patterns you know; offer to tighten the outline if they paste chapter or unit titles.',
  'Never imply you will only help after they get information from the web. You are the drafting assistant; they verify official documents.',
  'Output one JSON object with keys `reply` (string) and `updatedSkeleton` (object or null). The `reply` field is mandatory: it must be a non-empty string on every turn (never "" or whitespace only), even when `updatedSkeleton` is null — put your conversational answer to the admin there.',
  'For informational questions only (e.g. chapter names from NCERT, syllabus facts) with no outline edit: set `updatedSkeleton` to null and put the full answer in `reply` — still as that JSON object, not plain prose outside JSON.',
  'Always write a helpful `reply` (1–10 sentences, or longer lists when the user asks for names/titles). Prefer actionable outline edits over disclaimers.',
  'Set `updatedSkeleton` when the user wants the outline changed (modules, lesson titles, title, description, level, duration, categories, skills) — including "align to X syllabus", lesson counts (e.g. 12 lessons), or "add topics on Y".',
  'When `updatedSkeleton` is set, it must be the complete new outline (same JSON shape as initial skeleton), not a partial diff.',
  'If the user only chats without wanting a new outline structure, set `updatedSkeleton` to null.',
  'In `designNotes` on updates: briefly what you changed; one line that admins should confirm against official materials if precision matters — not a repeat of the whole reply.',
  'Respect maxModules and maxLessonsPerModule stated in the message when building updatedSkeleton.',
].join('\n');

const SKELETON_WEB_TOOLS_ADDON =
  '\n\nWeb tools are enabled: use Google Search and/or URL context on reference URLs when they help the topic (e.g. current board syllabus, rationalized curriculum).';

const REFINE_WEB_TOOLS_ADDON =
  '\n\nWeb tools are enabled: use Google Search and/or URL context on reference URLs to verify official or current syllabus details when relevant; keep `reply` concise about what you verified. After tool use, still return valid JSON with a non-empty `reply` string.';

export type AiCourseSkeletonModule = {
  title: string;
  lessons: { title: string }[];
};

export type AiCourseSkeleton = {
  title: string;
  description: string;
  level: CourseLevel;
  duration: string;
  categories: string[];
  skills: string[];
  modules: AiCourseSkeletonModule[];
  /** Model’s approach, assumptions, and limitation disclaimer (not citations). */
  designNotes?: string;
};

function coerceLevel(x: unknown): CourseLevel {
  if (typeof x === 'string' && (LEVELS as readonly string[]).includes(x)) {
    return x as CourseLevel;
  }
  return 'Beginner';
}

function coerceStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((v) => typeof v === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

function coerceSkeletonFromRecord(
  o: Record<string, unknown>
): { ok: true; skeleton: AiCourseSkeleton } | { ok: false; error: string } {
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  if (!title) {
    return { ok: false, error: 'Skeleton missing course title.' };
  }
  const modulesRaw = o.modules;
  if (!Array.isArray(modulesRaw) || modulesRaw.length === 0) {
    return { ok: false, error: 'Skeleton must include at least one module.' };
  }
  const modules: AiCourseSkeletonModule[] = [];
  for (const m of modulesRaw) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const mr = m as Record<string, unknown>;
    const mt = typeof mr.title === 'string' ? mr.title.trim() : '';
    const lessonsRaw = mr.lessons;
    const lessons: { title: string }[] = [];
    if (Array.isArray(lessonsRaw)) {
      for (const l of lessonsRaw) {
        if (!l || typeof l !== 'object' || Array.isArray(l)) continue;
        const lt = typeof (l as Record<string, unknown>).title === 'string' ? (l as { title: string }).title.trim() : '';
        lessons.push({ title: lt || 'Lesson' });
      }
    }
    if (lessons.length === 0) {
      lessons.push({ title: 'Lesson' });
    }
    modules.push({ title: mt || `Module ${modules.length + 1}`, lessons });
  }
  if (modules.length === 0) {
    return { ok: false, error: 'No valid modules in skeleton.' };
  }
  const designNotesRaw = o.designNotes;
  const designNotes =
    typeof designNotesRaw === 'string' && designNotesRaw.trim() ? designNotesRaw.trim() : undefined;
  return {
    ok: true,
    skeleton: {
      title,
      description,
      level: coerceLevel(o.level),
      duration: typeof o.duration === 'string' && o.duration.trim() ? o.duration.trim() : '1h',
      categories: dedupeLabelsPreserveOrder(coerceStringArray(o.categories)),
      skills: dedupeLabelsPreserveOrder(coerceStringArray(o.skills)),
      modules,
      ...(designNotes ? { designNotes } : {}),
    },
  };
}

/** Gemini API disallows `responseMimeType: application/json` together with tools — parse model text instead. */
function extractFirstMarkdownCodeBlock(text: string): string | null {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const inner = m?.[1]?.trim();
  return inner || null;
}

/**
 * First complete `{ ... }` at bracket depth 0, respecting string escapes (for prose + JSON replies).
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseJsonFromModelText(raw: string): unknown | null {
  const trimmed = raw.trim();
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let r = tryParse(trimmed);
  if (r !== null) return r;

  const block = extractFirstMarkdownCodeBlock(trimmed);
  if (block) {
    r = tryParse(block);
    if (r !== null) return r;
    const innerObj = extractFirstJsonObject(block);
    if (innerObj) {
      r = tryParse(innerObj);
      if (r !== null) return r;
    }
  }

  const blob = extractFirstJsonObject(trimmed);
  if (blob) {
    r = tryParse(blob);
    if (r !== null) return r;
  }

  return null;
}

function pickStringFromRecord(o: Record<string, unknown>, ...preferredKeys: string[]): string {
  for (const key of preferredKeys) {
    if (key in o) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  for (const key of preferredKeys) {
    const found = Object.keys(o).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found) {
      const v = o[found];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

function hasRefineChatCandidateShape(o: Record<string, unknown>): boolean {
  if (pickStringFromRecord(o, 'reply', 'response', 'message', 'answer')) return true;
  return 'updatedSkeleton' in o;
}

/**
 * Prefer a JSON object that looks like refine-chat output. Tool-heavy responses sometimes
 * prepend another `{...}` so the first parse is not the final assistant JSON.
 */
function tryParseJsonForRefineChat(raw: string): unknown | null {
  const first = tryParseJsonFromModelText(raw);
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const o = first as Record<string, unknown>;
    if (hasRefineChatCandidateShape(o)) return first;
  }
  const t = raw.trim();
  for (let i = t.lastIndexOf('{'); i >= 0; i = t.lastIndexOf('{', i - 1)) {
    const blob = extractFirstJsonObject(t.slice(i));
    if (!blob) continue;
    try {
      const p = JSON.parse(blob) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        const o = p as Record<string, unknown>;
        if (hasRefineChatCandidateShape(o)) return p;
      }
    } catch {
      /* try earlier `{` */
    }
  }
  return first;
}

function proseBeforeFirstBrace(raw: string): string {
  const i = raw.indexOf('{');
  if (i <= 0) return '';
  return raw
    .slice(0, i)
    .replace(/^[\s#*_`\-]+/g, '')
    .trim();
}

/** When the model returns prose (no JSON), optional whole-response ``` fence. */
function stripOuterMarkdownFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json|JSON|\w+)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return (m?.[1] ?? t).trim();
}

function extractRefineChatReply(root: Record<string, unknown>): string {
  let reply = pickStringFromRecord(root, 'reply', 'response', 'message', 'answer');
  if (!reply) {
    const r = root.reply;
    if (typeof r === 'number' && Number.isFinite(r)) reply = String(r);
  }
  if (reply) return reply;

  const rawSkel = root.updatedSkeleton;
  if (rawSkel !== null && rawSkel !== undefined) {
    if (typeof rawSkel === 'object' && !Array.isArray(rawSkel)) {
      const dn = (rawSkel as Record<string, unknown>).designNotes;
      if (typeof dn === 'string' && dn.trim()) return dn.trim();
    }
    return 'I proposed an updated outline in this turn — use **Apply** in the assistant panel if you want to replace the draft with the new structure.';
  }

  return '';
}

function parseSkeletonFromJson(
  text: string
): { ok: true; skeleton: AiCourseSkeleton } | { ok: false; error: string } {
  const parsed = tryParseJsonFromModelText(text);
  if (parsed === null) {
    return { ok: false, error: 'Could not parse course skeleton JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid skeleton shape.' };
  }
  return coerceSkeletonFromRecord(parsed as Record<string, unknown>);
}

const TOOLS_JSON_OUTPUT_ADDON =
  '\n\nIMPORTANT: After any tool use, your final assistant message must be a single JSON object only — no markdown code fences, no commentary before or after the JSON.';

/**
 * Merge AI skeleton into a full {@link Course} for the given document id (structured C{n}).
 * Taxonomy falls back to `fallbackCategories` / `fallbackSkills` when the model returns none.
 */
export function courseFromAiSkeleton(
  skeleton: AiCourseSkeleton,
  courseId: string,
  defaults: {
    author: string;
    thumbnail: string;
    fallbackCategories: string[];
    fallbackSkills: string[];
  }
): Course {
  const categories =
    skeleton.categories.length > 0 ? skeleton.categories : defaults.fallbackCategories;
  const skills = skeleton.skills.length > 0 ? skeleton.skills : defaults.fallbackSkills;
  const modules = skeleton.modules.map((mod, mi) => ({
    id: `tmpM${mi}`,
    title: mod.title,
    lessons: mod.lessons.map((les, li) => ({
      id: `tmpL${mi}_${li}`,
      title: les.title,
      videoUrl: PLACEHOLDER_VIDEO_URL,
    })),
  }));
  return {
    id: courseId,
    title: skeleton.title,
    author: defaults.author,
    thumbnail: defaults.thumbnail,
    description: skeleton.description,
    level: skeleton.level,
    duration: skeleton.duration,
    rating: 4.5,
    categories,
    skills,
    modules,
  };
}

export async function generateCourseSkeletonFromTopic(params: {
  apiKey: string;
  topic: string;
  maxModules?: number;
  maxLessonsPerModule?: number;
  web?: CourseAgentWebOptions;
}): Promise<
  | { ok: true; skeleton: AiCourseSkeleton; sourcesUsed?: string[]; modelUsed?: string }
  | { ok: false; error: string }
> {
  const maxModules = Math.min(8, Math.max(1, params.maxModules ?? 3));
  const maxLessonsPerModule = Math.min(8, Math.max(1, params.maxLessonsPerModule ?? 4));
  const refUrls = normalizeReferenceUrls(params.web?.referenceUrls);
  const baseContents = [
    `Topic: ${params.topic.trim()}`,
    '',
    `Constraints: at most ${maxModules} modules, at most ${maxLessonsPerModule} lessons per module.`,
  ].join('\n');
  let contents = augmentContentsWithReferenceUrls(baseContents, refUrls);

  const tools = buildCourseAgentTools(params.web);
  const systemInstruction =
    SKELETON_SYSTEM +
    (tools ? SKELETON_WEB_TOOLS_ADDON + TOOLS_JSON_OUTPUT_ADDON : '');

  const structuredJson = {
    responseMimeType: 'application/json' as const,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Course title' },
        description: { type: Type.STRING, description: '2–4 sentence catalog description' },
        level: {
          type: Type.STRING,
          description: 'Beginner | Intermediate | Advanced | Proficient',
        },
        duration: { type: Type.STRING, description: 'e.g. 4h' },
        categories: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Library category labels',
        },
        skills: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Skill tags',
        },
        modules: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              lessons: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { title: { type: Type.STRING } },
                  required: ['title'],
                },
              },
            },
            required: ['title', 'lessons'],
          },
        },
        designNotes: {
          type: Type.STRING,
          description:
            'Approach, assumptions; note training-only limits or what web/URL tools verified.',
        },
      },
      required: ['title', 'description', 'level', 'duration', 'modules'],
    },
  };

  let {
    text,
    error,
    groundingMetadata,
    urlContextMetadata,
    modelUsed,
    lastAttemptedModel,
    modelChain,
    chainSource,
  } = await generateContentWithModelChain(params.apiKey, contents, {
    systemInstruction,
    ...(tools ? {} : structuredJson),
    temperature: 0.55,
    ...(tools ? { tools } : {}),
  });

  if (
    error &&
    isGeminiUrlContextUrlLimitError(error) &&
    refUrls.length > 0
  ) {
    const retryContents = [baseContents, '', URL_CONTEXT_RETRY_USER_NOTE].join('\n');
    const retryTools = buildCourseAgentTools({
      googleSearch: params.web?.googleSearch,
      referenceUrls: undefined,
    });
    const second = await generateContentWithModelChain(params.apiKey, retryContents, {
      systemInstruction,
      ...(retryTools ? {} : structuredJson),
      temperature: 0.55,
      ...(retryTools ? { tools: retryTools } : {}),
    });
    text = second.text;
    error = second.error;
    groundingMetadata = second.groundingMetadata;
    urlContextMetadata = second.urlContextMetadata;
    modelUsed = second.modelUsed;
    lastAttemptedModel = second.lastAttemptedModel;
    modelChain = second.modelChain;
    chainSource = second.chainSource;
  }

  if (error) {
    return {
      ok: false,
      error: formatGenaiError(error, formatContextForGenaiError({ lastAttemptedModel, modelChain, chainSource })),
    };
  }
  if (!text) {
    return { ok: false, error: 'No response from the model. Try again.' };
  }

  const parsed = parseSkeletonFromJson(text);
  if (parsed.ok === false) {
    return { ok: false, error: parsed.error };
  }

  let { modules } = parsed.skeleton;
  if (modules.length > maxModules) {
    modules = modules.slice(0, maxModules);
  }
  modules = modules.map((m) => ({
    ...m,
    lessons: m.lessons.slice(0, maxLessonsPerModule),
  }));

  const sourcesUsed = mergeGroundingSourceLines(groundingMetadata, urlContextMetadata);
  return {
    ok: true,
    skeleton: { ...parsed.skeleton, modules },
    ...(sourcesUsed ? { sourcesUsed } : {}),
    ...(modelUsed ? { modelUsed } : {}),
  };
}

/** Compact JSON of the draft outline for chat refinement (no ids / quiz payloads). */
export function compactOutlineForChat(course: Course): string {
  const payload = {
    title: course.title,
    description: course.description,
    level: course.level,
    duration: course.duration,
    categories: course.categories,
    skills: course.skills,
    modules: course.modules.map((m) => ({
      title: m.title,
      lessons: m.lessons.map((l) => ({
        title: l.title,
        contentKind: l.contentKind ?? 'video',
      })),
    })),
  };
  return JSON.stringify(payload);
}

export async function refineOutlineWithChat(params: {
  apiKey: string;
  history: { role: 'learner' | 'model'; text: string }[];
  outlineJson: string;
  maxModules: number;
  maxLessonsPerModule: number;
  web?: CourseAgentWebOptions;
}): Promise<
  | { ok: true; reply: string; skeleton: AiCourseSkeleton | null; sourcesUsed?: string[]; modelUsed?: string }
  | { ok: false; error: string }
> {
  const hist = params.history
    .slice(-MAX_OUTLINE_CHAT_TURNS)
    .map((h) => `${h.role === 'learner' ? 'Learner' : 'Model'}: ${h.text}`)
    .join('\n\n');

  const refUrls = normalizeReferenceUrls(params.web?.referenceUrls);
  const baseContents = [
    `Constraints: at most ${params.maxModules} modules, at most ${params.maxLessonsPerModule} lessons per module.`,
    '',
    'Current outline JSON:',
    params.outlineJson,
    '',
    'Chat so far:',
    hist || '(no prior messages)',
    '',
    'Respond helpfully: draft or revise the outline; avoid long refusal monologues. If web tools are off, use training knowledge and pasted text. If web tools are on, verify current syllabus or official details when asked.',
  ].join('\n');
  let contents = augmentContentsWithReferenceUrls(baseContents, refUrls);

  const updatedSkeletonSchema = {
    type: Type.OBJECT,
    nullable: true,
    properties: {
      title: { type: Type.STRING, description: 'Course title' },
      description: { type: Type.STRING, description: 'Catalog description' },
      level: {
        type: Type.STRING,
        description: 'Beginner | Intermediate | Advanced | Proficient',
      },
      duration: { type: Type.STRING, description: 'e.g. 4h' },
      categories: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Library category labels',
      },
      skills: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Skill tags',
      },
      modules: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            lessons: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { title: { type: Type.STRING } },
                required: ['title'],
              },
            },
          },
          required: ['title', 'lessons'],
        },
      },
      designNotes: {
        type: Type.STRING,
        description: 'What changed and limitation disclaimer',
      },
    },
    required: ['title', 'description', 'level', 'duration', 'modules'],
  } as const;

  const tools = buildCourseAgentTools(params.web);
  const systemInstruction =
    REFINE_CHAT_SYSTEM + (tools ? REFINE_WEB_TOOLS_ADDON + TOOLS_JSON_OUTPUT_ADDON : '');

  const refineStructuredJson = {
    responseMimeType: 'application/json' as const,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        reply: {
          type: Type.STRING,
          description: 'Conversational reply to the admin',
        },
        updatedSkeleton: updatedSkeletonSchema,
      },
      required: ['reply'],
    },
  };

  let {
    text,
    error,
    groundingMetadata,
    urlContextMetadata,
    modelUsed,
    lastAttemptedModel,
    modelChain,
    chainSource,
  } = await generateContentWithModelChain(params.apiKey, contents, {
    systemInstruction,
    ...(tools ? {} : refineStructuredJson),
    temperature: 0.5,
    ...(tools ? { tools } : {}),
  });

  if (
    error &&
    isGeminiUrlContextUrlLimitError(error) &&
    refUrls.length > 0
  ) {
    const retryContents = [baseContents, '', URL_CONTEXT_RETRY_USER_NOTE].join('\n');
    const retryTools = buildCourseAgentTools({
      googleSearch: params.web?.googleSearch,
      referenceUrls: undefined,
    });
    const second = await generateContentWithModelChain(params.apiKey, retryContents, {
      systemInstruction,
      ...(retryTools ? {} : refineStructuredJson),
      temperature: 0.5,
      ...(retryTools ? { tools: retryTools } : {}),
    });
    text = second.text;
    error = second.error;
    groundingMetadata = second.groundingMetadata;
    urlContextMetadata = second.urlContextMetadata;
    modelUsed = second.modelUsed;
    lastAttemptedModel = second.lastAttemptedModel;
    modelChain = second.modelChain;
    chainSource = second.chainSource;
  }

  if (error) {
    return {
      ok: false,
      error: formatGenaiError(error, formatContextForGenaiError({ lastAttemptedModel, modelChain, chainSource })),
    };
  }
  if (!text) {
    return { ok: false, error: 'No response from the model. Try again.' };
  }

  const sourcesUsed = mergeGroundingSourceLines(groundingMetadata, urlContextMetadata);
  const modelSpread = modelUsed ? { modelUsed } : {};

  let parsed: unknown = tryParseJsonForRefineChat(text);
  if (parsed === null) {
    const unwrapped = stripOuterMarkdownFence(text);
    if (unwrapped.length > 0 && unwrapped !== text.trim()) {
      parsed = tryParseJsonForRefineChat(unwrapped);
    }
  }

  const plainTextFallbackReply = (): string | null => {
    const plain = stripOuterMarkdownFence(text);
    return plain.length >= 4 ? plain.slice(0, 12000) : null;
  };

  if (parsed === null) {
    const fb = plainTextFallbackReply();
    if (fb) {
      return {
        ok: true,
        reply: fb,
        skeleton: null,
        ...(sourcesUsed ? { sourcesUsed } : {}),
        ...modelSpread,
      };
    }
    return { ok: false, error: 'Could not parse chat response JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const fb = plainTextFallbackReply();
    if (fb) {
      return {
        ok: true,
        reply: fb,
        skeleton: null,
        ...(sourcesUsed ? { sourcesUsed } : {}),
        ...modelSpread,
      };
    }
    return { ok: false, error: 'Invalid chat response shape.' };
  }
  const root = parsed as Record<string, unknown>;
  let reply = extractRefineChatReply(root);
  if (!reply) {
    const prose = proseBeforeFirstBrace(text);
    if (prose.length >= 12) reply = prose.slice(0, 8000);
  }
  if (!reply) {
    return {
      ok: false,
      error:
        'Could not read a reply from the model. Try a shorter question, or ask for a concrete outline change (e.g. "reduce to 12 lessons total to match NCERT").',
    };
  }

  const rawSkel = root.updatedSkeleton;
  if (rawSkel === null || rawSkel === undefined) {
    return { ok: true, reply, skeleton: null, ...(sourcesUsed ? { sourcesUsed } : {}), ...modelSpread };
  }
  if (typeof rawSkel !== 'object' || Array.isArray(rawSkel)) {
    return { ok: true, reply, skeleton: null, ...(sourcesUsed ? { sourcesUsed } : {}), ...modelSpread };
  }

  const coerced = coerceSkeletonFromRecord(rawSkel as Record<string, unknown>);
  if (coerced.ok === false) {
    return {
      ok: true,
      reply: `${reply}\n\n(Outline update was not applied: ${coerced.error})`,
      skeleton: null,
      ...(sourcesUsed ? { sourcesUsed } : {}),
      ...modelSpread,
    };
  }

  let { modules } = coerced.skeleton;
  if (modules.length > params.maxModules) {
    modules = modules.slice(0, params.maxModules);
  }
  modules = modules.map((m) => ({
    ...m,
    lessons: m.lessons.slice(0, params.maxLessonsPerModule),
  }));

  return {
    ok: true,
    reply,
    skeleton: { ...coerced.skeleton, modules },
    ...(sourcesUsed ? { sourcesUsed } : {}),
    ...modelSpread,
  };
}
