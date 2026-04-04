import type { GroundingMetadata, UrlContextMetadata } from '@google/genai';

/** Human-readable lines from Google Search grounding chunks. */
export function linesFromGroundingMetadata(meta: GroundingMetadata | undefined): string[] {
  if (!meta?.groundingChunks?.length) return [];
  const out: string[] = [];
  for (const ch of meta.groundingChunks) {
    const w = ch.web;
    if (w?.uri) {
      const label = w.title?.trim() ? `${w.title.trim()} — ${w.uri}` : w.uri;
      out.push(label);
    }
  }
  return [...new Set(out)];
}

/** Human-readable lines from URL context tool (official pages the model fetched). */
export function linesFromUrlContextMetadata(meta: UrlContextMetadata | undefined): string[] {
  if (!meta?.urlMetadata?.length) return [];
  const out: string[] = [];
  for (const u of meta.urlMetadata) {
    if (u.retrievedUrl) {
      out.push(
        u.urlRetrievalStatus
          ? `${u.retrievedUrl} (${String(u.urlRetrievalStatus).replace(/^URL_RETRIEVAL_STATUS_/, '')})`
          : u.retrievedUrl
      );
    }
  }
  return [...new Set(out)];
}

export function mergeGroundingSourceLines(
  grounding?: GroundingMetadata,
  urlContext?: UrlContextMetadata
): string[] | undefined {
  const g = linesFromGroundingMetadata(grounding);
  const u = linesFromUrlContextMetadata(urlContext);
  const merged = [...g, ...u];
  return merged.length ? merged : undefined;
}
