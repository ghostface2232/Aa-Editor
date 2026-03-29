import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";

export const searchPluginKey = new PluginKey("searchHighlight");

export interface SearchPluginState {
  query: string;
  activeIndex: number;
  matches: { from: number; to: number }[];
}

function findMatches(doc: Node, query: string): { from: number; to: number }[] {
  const results: { from: number; to: number }[] = [];
  if (!query) return results;
  const lower = query.toLowerCase();

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const text = node.text.toLowerCase();
      let idx = text.indexOf(lower);
      while (idx !== -1) {
        results.push({ from: pos + idx, to: pos + idx + query.length });
        idx = text.indexOf(lower, idx + 1);
      }
    }
  });

  return results;
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init(): SearchPluginState {
            return { query: "", activeIndex: 0, matches: [] };
          },
          apply(tr, prev): SearchPluginState {
            const meta = tr.getMeta(searchPluginKey) as SearchPluginState | undefined;
            if (meta) return meta;
            if (tr.docChanged && prev.query) {
              const matches = findMatches(tr.doc, prev.query);
              const activeIndex = Math.min(
                prev.activeIndex,
                Math.max(0, matches.length - 1),
              );
              return { ...prev, matches, activeIndex };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const pluginState = searchPluginKey.getState(state) as SearchPluginState;
            if (!pluginState.query || pluginState.matches.length === 0) {
              return DecorationSet.empty;
            }

            const decos = pluginState.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class:
                  i === pluginState.activeIndex
                    ? "search-match-active"
                    : "search-match",
              }),
            );

            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
