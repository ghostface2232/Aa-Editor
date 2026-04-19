import { InputRule, Mark, mergeAttributes } from "@tiptap/core";
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { NoteDoc } from "../hooks/useNotesLoader";
import type { Locale } from "../hooks/useSettings";

export interface WikiLinkStorage {
  docs: NoteDoc[];
  locale: Locale;
  // Navigate to a note by its current title (case-insensitive).
  // No-op if no exact match; handled by the click dispatcher.
  navigateToTitle: (title: string) => void;
  // Create a note with the given title and persist it. Does NOT switch the
  // current document. Returns the new note's id once scheduling succeeds.
  createNoteWithTitle: (title: string) => Promise<string | null>;
}

export interface WikiLinkAttributes {
  target: string;
}

const WIKI_LINK_DECORATION_KEY = new PluginKey("wikiLinkDecorations");

function normalizeTitle(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

export function findDocByTitle(docs: NoteDoc[], title: string): NoteDoc | null {
  const needle = normalizeTitle(title);
  if (!needle) return null;
  return docs.find((doc) => normalizeTitle(doc.fileName) === needle) ?? null;
}

const WikiLink = Mark.create<unknown, WikiLinkStorage>({
  name: "wikiLink",

  // The mark wraps `[[Title]]` verbatim (brackets included), so it behaves
  // like a contiguous atomic run even when the user edits around the edges.
  inclusive: false,
  spanning: false,
  // Prevent Link (and other "_" group marks) from coexisting on the same text.
  excludes: "_",

  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-wiki-link") ?? "",
        renderHTML: (attrs) => {
          const target = (attrs as WikiLinkAttributes).target ?? "";
          return { "data-wiki-link": target };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wiki-link]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "wiki-link",
      }),
      0,
    ];
  },

  addStorage(): WikiLinkStorage {
    return {
      docs: [],
      locale: "en",
      navigateToTitle: () => {},
      createNoteWithTitle: async () => null,
    };
  },

  markdownTokenName: "wikiLink",

  markdownTokenizer: {
    name: "wikiLink",
    level: "inline" as const,
    start: (src: string) => {
      const idx = src.indexOf("[[");
      return idx < 0 ? -1 : idx;
    },
    tokenize: (src: string) => {
      const match = /^\[\[([^\[\]\n]+)\]\]/.exec(src);
      if (!match) return undefined;
      const target = match[1].trim();
      if (!target) return undefined;
      return {
        type: "wikiLink",
        raw: match[0],
        target,
      };
    },
  },

  parseMarkdown(
    token: MarkdownToken,
    helpers: MarkdownParseHelpers,
  ) {
    const target = String(token.target ?? "").trim();
    const text = typeof token.raw === "string" ? token.raw : `[[${target}]]`;
    return helpers.applyMark(
      "wikiLink",
      [helpers.createTextNode(text)],
      { target },
    );
  },

  // The text node already contains the full `[[Title]]`. The mark itself
  // contributes no opening/closing syntax — the placeholder maps back to
  // the text verbatim.
  renderMarkdown(
    node: JSONContent,
    helpers: MarkdownRendererHelpers,
  ) {
    return helpers.renderChildren(node);
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\[\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const target = (match[1] ?? "").trim();
          if (!target) return null;

          const markType = state.schema.marks.wikiLink;
          if (!markType) return null;

          const { tr } = state;
          // Guard against re-entry: if the range is already fully covered by
          // a wikiLink mark with the same target, skip.
          const alreadyMarked = state.doc.rangeHasMark(range.from, range.to, markType);
          if (!alreadyMarked) {
            tr.addMark(range.from, range.to, markType.create({ target }));
          }
          tr.removeStoredMark(markType);
          return null;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: WIKI_LINK_DECORATION_KEY,
        state: {
          init: (_, state) => buildMissingDecorations(state.doc, extension.storage.docs),
          apply: (tr, value, _oldState, newState) => {
            if (!tr.docChanged && !tr.getMeta(WIKI_LINK_DECORATION_KEY)) {
              return value;
            }
            return buildMissingDecorations(newState.doc, extension.storage.docs);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick: (view, pos, event) => {
            if (event.button !== 0) return false;
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
              return false;
            }

            const $pos = view.state.doc.resolve(pos);
            const marks = $pos.marks();
            const wikiMark = marks.find((mark) => mark.type.name === "wikiLink");
            if (!wikiMark) return false;

            const target = (wikiMark.attrs as WikiLinkAttributes).target ?? "";
            if (!target) return false;

            const hit = findDocByTitle(extension.storage.docs, target);
            if (!hit) {
              // Missing target — let the click fall through so the user can
              // still place the caret and edit the bracketed text.
              return false;
            }

            extension.storage.navigateToTitle(target);
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

function buildMissingDecorations(
  doc: import("@tiptap/pm/model").Node,
  docs: NoteDoc[],
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const wikiMark = node.marks.find((m) => m.type.name === "wikiLink");
    if (!wikiMark) return;

    const target = (wikiMark.attrs as WikiLinkAttributes).target ?? "";
    const exists = !!findDocByTitle(docs, target);
    if (exists) return;

    const from = pos;
    const to = pos + node.nodeSize;
    decorations.push(
      Decoration.inline(from, to, { class: "wiki-link-missing" }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

/** Dispatch a no-op transaction that flags the decoration plugin to rebuild. */
export function refreshWikiLinkDecorations(editor: import("@tiptap/core").Editor): void {
  const { tr } = editor.state;
  tr.setMeta(WIKI_LINK_DECORATION_KEY, { refresh: true });
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

export default WikiLink;
