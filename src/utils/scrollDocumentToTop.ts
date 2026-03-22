/** Resets all common document scroll roots (some engines use scrollingElement vs body). */
export function scrollDocumentToTop(): void {
  window.scrollTo(0, 0);
  const root = document.scrollingElement ?? document.documentElement;
  root.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}
