import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { buildTimestampDecorations } from '../utils/noteTimestampDecorations';

/** Dispatch `state.tr.setMeta(NOTE_PLAYBACK_TICK_META, true)` to refresh highlights. */
export const NOTE_PLAYBACK_TICK_META = 'notePlaybackTick';

const pluginKey = new PluginKey('lessonNoteTimestampHighlight');

export const LessonNoteTimestampHighlight = Extension.create({
  name: 'lessonNoteTimestampHighlight',

  addOptions() {
    return {
      getPlaybackSeconds: (): number => -1,
    };
  },

  addProseMirrorPlugins() {
    const getPlaybackSeconds = this.options.getPlaybackSeconds;

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init(_, { doc }) {
            return buildTimestampDecorations(doc, getPlaybackSeconds());
          },
          apply(tr, oldSet, _oldState, newState) {
            if (tr.docChanged || tr.getMeta(NOTE_PLAYBACK_TICK_META)) {
              return buildTimestampDecorations(newState.doc, getPlaybackSeconds());
            }
            return oldSet.map(tr.mapping, newState.doc);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state) ?? null;
          },
        },
      }),
    ];
  },
});
