import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { getGeminiModelChain } from './geminiModelEnv';

const COLLECTION = 'siteSettings';
export const GEMINI_AI_MODELS_DOC_ID = 'geminiAiModels';

/** Same-tab refresh after admin save (optional listeners). */
export const GEMINI_AI_MODELS_CHANGED = 'skilllearn:geminiAiModelsChanged';

export const MAX_GEMINI_MODEL_IDS = 20;

const MODEL_ID_RE = /^[\w.-]+$/;

/** Client-side check before adding a model id from the admin UI (matches normalize rules). */
export function isValidGeminiModelIdInput(id: string): boolean {
  const t = id.trim();
  return t.length > 0 && t.length <= 120 && MODEL_ID_RE.test(t);
}

/**
 * Sanitize ordered model ids from Firestore or admin UI (dedupe, length cap, basic charset).
 */
export function normalizeGeminiModelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const id = x.trim();
    if (!id || id.length > 120 || !MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_GEMINI_MODEL_IDS) break;
  }
  return out;
}

/** Align Firestore `enabledFlags` to normalized id list; missing or wrong length → all enabled (legacy docs). */
export function alignGeminiEnabledFlags(idCount: number, raw: unknown): boolean[] {
  if (!Array.isArray(raw) || raw.length !== idCount) {
    return Array.from({ length: idCount }, () => true);
  }
  return raw.map((v) => v === true);
}

/**
 * Dedupe model ids (first wins), cap length, and keep the matching enabled flag per kept id.
 */
export function normalizeGeminiModelRows(rows: Array<{ id: string; enabled: boolean }>): {
  modelIds: string[];
  enabledFlags: boolean[];
} {
  const modelIds: string[] = [];
  const enabledFlags: boolean[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id || id.length > 120 || !MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    modelIds.push(id);
    enabledFlags.push(row.enabled !== false);
    if (modelIds.length >= MAX_GEMINI_MODEL_IDS) break;
  }
  return { modelIds, enabledFlags };
}

/** `firestore` = Admin → Smart Hub → Gemini model chain; `env` = no Firestore doc / empty ids → build-time env chain. */
export type GeminiModelChainSource = 'firestore' | 'env';

type CachedResolution = { chain: string[]; source: GeminiModelChainSource };

let cachedResolution: CachedResolution | null = null;

export function invalidateGeminiModelChainCache(): void {
  cachedResolution = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener(GEMINI_AI_MODELS_CHANGED, () => {
    invalidateGeminiModelChainCache();
  });
}

/**
 * Resolved order for AI calls: Firestore models with enabled flag true (order preserved), else env chain when doc missing/empty ids.
 * If the doc exists with at least one id but all are disabled, returns [] (no env fallback).
 * When `source` is `firestore`, callers should use this chain as-is (Smart Hub order); when `env`, the chain comes from `GEMINI_MODEL` / `GEMINI_MODEL_FALLBACK` (+ default lite).
 */
export async function getResolvedGeminiModelChainWithSource(): Promise<{
  chain: string[];
  source: GeminiModelChainSource;
}> {
  if (cachedResolution !== null) {
    return { chain: [...cachedResolution.chain], source: cachedResolution.source };
  }
  try {
    const snap = await getDoc(doc(db, COLLECTION, GEMINI_AI_MODELS_DOC_ID));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      const ids = normalizeGeminiModelIds(data.modelIds);
      if (ids.length > 0) {
        const flags = alignGeminiEnabledFlags(ids.length, data.enabledFlags);
        const enabledOnly = ids.filter((_, i) => flags[i]);
        cachedResolution = { chain: [...enabledOnly], source: 'firestore' };
        return { chain: [...cachedResolution.chain], source: cachedResolution.source };
      }
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${GEMINI_AI_MODELS_DOC_ID}`);
  }
  const fallback = getGeminiModelChain();
  cachedResolution = { chain: [...fallback], source: 'env' };
  return { chain: [...cachedResolution.chain], source: cachedResolution.source };
}

export async function getResolvedGeminiModelChain(): Promise<string[]> {
  const { chain } = await getResolvedGeminiModelChainWithSource();
  return chain;
}

export type GeminiModelAdminRow = { id: string; enabled: boolean };

/** Load current rows for the admin editor (Firestore if set, otherwise env defaults; legacy docs get all enabled). */
export async function loadGeminiAiModelsForAdmin(): Promise<{
  fromFirestore: boolean;
  rows: GeminiModelAdminRow[];
}> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, GEMINI_AI_MODELS_DOC_ID));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      const ids = normalizeGeminiModelIds(data.modelIds);
      if (ids.length > 0) {
        const flags = alignGeminiEnabledFlags(ids.length, data.enabledFlags);
        const rows = ids.map((id, i) => ({ id, enabled: flags[i]! }));
        return { fromFirestore: true, rows };
      }
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${GEMINI_AI_MODELS_DOC_ID}`);
  }
  const env = getGeminiModelChain();
  return { fromFirestore: false, rows: env.map((id) => ({ id, enabled: true })) };
}

export async function saveGeminiAiModels(rows: GeminiModelAdminRow[]): Promise<boolean> {
  const { modelIds, enabledFlags } = normalizeGeminiModelRows(rows);
  if (modelIds.length < 1) return false;
  try {
    await setDoc(doc(db, COLLECTION, GEMINI_AI_MODELS_DOC_ID), {
      modelIds,
      enabledFlags,
      updatedAt: serverTimestamp(),
    });
    cachedResolution = {
      chain: modelIds.filter((_, i) => enabledFlags[i]),
      source: 'firestore',
    };
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(GEMINI_AI_MODELS_CHANGED));
    }
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${GEMINI_AI_MODELS_DOC_ID}`);
    return false;
  }
}
