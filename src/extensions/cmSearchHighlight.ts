import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export interface CmSearchMeta {
  query: string;
  activeIndex: number;
}

export const setCmSearch = StateEffect.define<CmSearchMeta>();

const matchMark = Decoration.mark({ class: "cm-search-match" });
const activeMark = Decoration.mark({ class: "cm-search-match-active" });

function buildDecorations(
  doc: { toString(): string },
  query: string,
  activeIndex: number,
): DecorationSet {
  if (!query) return Decoration.none;
  const ranges: ReturnType<typeof matchMark.range>[] = [];
  const text = doc.toString().toLowerCase();
  const lower = query.toLowerCase();
  let idx = text.indexOf(lower);
  let i = 0;
  while (idx !== -1) {
    const mark = i === activeIndex ? activeMark : matchMark;
    ranges.push(mark.range(idx, idx + query.length));
    i++;
    idx = text.indexOf(lower, idx + 1);
  }
  return Decoration.set(ranges);
}

export const cmSearchField = StateField.define<{
  query: string;
  activeIndex: number;
  decorations: DecorationSet;
}>({
  create() {
    return { query: "", activeIndex: 0, decorations: Decoration.none };
  },
  update(state, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCmSearch)) {
        const { query, activeIndex } = effect.value;
        return {
          query,
          activeIndex,
          decorations: buildDecorations(tr.state.doc, query, activeIndex),
        };
      }
    }
    if (tr.docChanged && state.query) {
      return {
        ...state,
        decorations: buildDecorations(tr.state.doc, state.query, state.activeIndex),
      };
    }
    return state;
  },
  provide: (f) => EditorView.decorations.from(f, (val) => val.decorations),
});
