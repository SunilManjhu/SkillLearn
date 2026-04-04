import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

function stripDataPmSlice(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(`<div id="wrap">${html}</div>`, 'text/html');
    const wrap = doc.getElementById('wrap');
    if (!wrap) return html;
    wrap.querySelectorAll('[data-pm-slice]').forEach((el) => el.removeAttribute('data-pm-slice'));
    return wrap.innerHTML;
  } catch {
    return html;
  }
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap fragment HTML so Word, Outlook, and similar clients accept rich paste from the clipboard.
 * Paste back into the lesson editor still parses from this document (body content only).
 */
function wrapClipboardHtml(innerHtml: string, plainText: string): string {
  const snippet = plainText.replace(/\s+/g, ' ').trim().slice(0, 120);
  const title = escapeXmlText(snippet || 'Notes');
  return (
    '<!DOCTYPE html>\n' +
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">\n' +
    '<head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><title>' +
    title +
    '</title></head>\n' +
    '<body>\n<!--StartFragment-->\n' +
    innerHtml +
    '\n<!--EndFragment-->\n</body>\n</html>'
  );
}

function handleCopyOrCut(view: EditorView, event: ClipboardEvent, isCut: boolean): boolean {
  const sel = view.state.selection;
  if (sel.empty) return false;

  const data = event.clipboardData;
  if (!data) {
    return false;
  }

  const { dom, text } = view.serializeForClipboard(sel.content());
  const inner = stripDataPmSlice(dom.innerHTML);
  const html = wrapClipboardHtml(inner, text);

  event.preventDefault();
  data.clearData();
  data.setData('text/html', html);
  data.setData('text/plain', text);

  if (isCut) {
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  }
  return true;
}

/**
 * Rich copy/cut for external apps: full HTML document + plain text on the clipboard.
 * When `clipboardData` is unavailable, returns false so ProseMirror's built-in copy runs.
 */
export const LessonNoteClipboardExport = Extension.create({
  name: 'lessonNoteClipboardExport',

  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('lessonNoteClipboardExport'),
        props: {
          handleDOMEvents: {
            copy: (view, event) => handleCopyOrCut(view, event as ClipboardEvent, false),
            cut: (view, event) => handleCopyOrCut(view, event as ClipboardEvent, true),
          },
        },
      }),
    ];
  },
});
