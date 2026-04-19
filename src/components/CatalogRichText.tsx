import React, { useMemo, type ElementType } from 'react';
import { catalogMiniRichDisplayHtml } from '../utils/catalogMiniRichHtml';

type CatalogRichTextProps = {
  value: string;
  className?: string;
  /** Host element; default `span` for inline titles. */
  as?: ElementType;
};

/**
 * Renders catalog mini-HTML (sub/sup, bold, etc.) with DOMPurify. Use for module/lesson titles and about text.
 */
export function CatalogRichText({ value, className, as: Tag = 'span' }: CatalogRichTextProps) {
  const html = useMemo(() => catalogMiniRichDisplayHtml(value), [value]);
  if (!html) return null;
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
