import { useState, useRef, useEffect, useCallback } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowUpRegular,
  ArrowDownRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import type { Editor } from "@tiptap/core";
import type { EditorView as CmEditorView } from "@codemirror/view";
import { searchPluginKey, type SearchPluginState } from "../extensions/SearchHighlight";
import { setCmSearch } from "../extensions/cmSearchHighlight";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";

const useStyles = makeStyles({
  wrapper: {
    position: "absolute",
    top: "8px",
    right: "20px",
    display: "flex",
    alignItems: "center",
    gap: "2px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "4px 4px 4px 10px",
    boxShadow: tokens.shadow8,
    width: "280px",
    pointerEvents: "auto",
  },
  input: {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: "13px",
    fontFamily: "inherit",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    minWidth: 0,
    lineHeight: "24px",
    "::placeholder": {
      color: tokens.colorNeutralForeground4,
    },
  },
  count: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    paddingRight: "4px",
    minWidth: "36px",
    textAlign: "right",
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
});

/* ─── helpers ─── */

function findCmMatches(text: string, query: string): { from: number; to: number }[] {
  const results: { from: number; to: number }[] = [];
  if (!query) return results;
  const lower = query.toLowerCase();
  const haystack = text.toLowerCase();
  let idx = haystack.indexOf(lower);
  while (idx !== -1) {
    results.push({ from: idx, to: idx + query.length });
    idx = haystack.indexOf(lower, idx + 1);
  }
  return results;
}

function scrollToPos(dom: HTMLElement, getCoords: () => { top: number } | null) {
  requestAnimationFrame(() => {
    try {
      const coords = getCoords();
      if (!coords) return;
      let scrollParent: HTMLElement | null = dom.parentElement;
      while (scrollParent) {
        const { overflowY } = window.getComputedStyle(scrollParent);
        if (overflowY === "auto" || overflowY === "scroll") break;
        scrollParent = scrollParent.parentElement;
      }
      if (scrollParent) {
        const rect = scrollParent.getBoundingClientRect();
        const relativeTop = coords.top - rect.top;
        const padding = 80;
        if (relativeTop < padding || relativeTop > rect.height - padding) {
          scrollParent.scrollTo({
            top: scrollParent.scrollTop + relativeTop - rect.height / 3,
            behavior: "smooth",
          });
        }
      }
    } catch { /* no-op */ }
  });
}

/* ─── component ─── */

interface SearchBarProps {
  editor: Editor | null;
  cmView: CmEditorView | null;
  isCmMode: boolean;
  onClose: () => void;
  locale: Locale;
}

export function SearchBar({ editor, cmView, isCmMode, onClose, locale }: SearchBarProps) {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  useEffect(() => { inputRef.current?.focus(); }, []);

  /* ── Tiptap search ── */

  const dispatchTiptap = useCallback(
    (q: string, activeIdx: number) => {
      if (!editor) return { count: 0, clamped: 0 };
      const matches: { from: number; to: number }[] = [];
      if (q) {
        const lower = q.toLowerCase();
        editor.state.doc.descendants((node, pos) => {
          if (node.isText && node.text) {
            const text = node.text.toLowerCase();
            let idx = text.indexOf(lower);
            while (idx !== -1) {
              matches.push({ from: pos + idx, to: pos + idx + q.length });
              idx = text.indexOf(lower, idx + 1);
            }
          }
        });
      }
      const clamped = matches.length > 0
        ? ((activeIdx % matches.length) + matches.length) % matches.length
        : 0;

      const { tr } = editor.state;
      tr.setMeta(searchPluginKey, { query: q, activeIndex: clamped, matches } satisfies SearchPluginState);
      editor.view.dispatch(tr);

      if (matches.length > 0) {
        const match = matches[clamped];
        scrollToPos(editor.view.dom, () => editor.view.coordsAtPos(match.from));
      }
      return { count: matches.length, clamped };
    },
    [editor],
  );

  /* ── CodeMirror search ── */

  const dispatchCm = useCallback(
    (q: string, activeIdx: number) => {
      if (!cmView) return { count: 0, clamped: 0 };
      const matches = findCmMatches(cmView.state.doc.toString(), q);
      const clamped = matches.length > 0
        ? ((activeIdx % matches.length) + matches.length) % matches.length
        : 0;

      cmView.dispatch({ effects: setCmSearch.of({ query: q, activeIndex: clamped }) });

      if (matches.length > 0) {
        const match = matches[clamped];
        scrollToPos(cmView.dom, () => cmView.coordsAtPos(match.from));
      }
      return { count: matches.length, clamped };
    },
    [cmView],
  );

  /* ── unified dispatch ── */

  const dispatchSearch = useCallback(
    (q: string, idx: number) => {
      const result = isCmMode ? dispatchCm(q, idx) : dispatchTiptap(q, idx);
      setMatchCount(result.count);
      setActiveIndex(result.clamped);
    },
    [isCmMode, dispatchCm, dispatchTiptap],
  );

  const handleQueryChange = useCallback(
    (value: string) => { setQuery(value); dispatchSearch(value, 0); },
    [dispatchSearch],
  );

  const goNext = useCallback(() => dispatchSearch(query, activeIndex + 1), [dispatchSearch, query, activeIndex]);
  const goPrev = useCallback(() => dispatchSearch(query, activeIndex - 1), [dispatchSearch, query, activeIndex]);

  const handleClose = useCallback(() => {
    if (editor && !isCmMode) {
      const { tr } = editor.state;
      tr.setMeta(searchPluginKey, { query: "", activeIndex: 0, matches: [] } satisfies SearchPluginState);
      editor.view.dispatch(tr);
    }
    if (cmView && isCmMode) {
      cmView.dispatch({ effects: setCmSearch.of({ query: "", activeIndex: 0 }) });
    }
    onClose();
  }, [editor, cmView, isCmMode, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); handleClose(); }
      else if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? goPrev() : goNext(); }
    },
    [handleClose, goNext, goPrev],
  );

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={i("search.placeholder")}
        spellCheck={false}
      />
      <span className={styles.count} style={{ visibility: query ? "visible" : "hidden" }}>
        {query ? (matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : "0") : "0/0"}
      </span>
      <button className={styles.btn} onClick={goPrev} tabIndex={-1}>
        <ArrowUpRegular fontSize={14} />
      </button>
      <button className={styles.btn} onClick={goNext} tabIndex={-1}>
        <ArrowDownRegular fontSize={14} />
      </button>
      <button className={styles.btn} onClick={handleClose} tabIndex={-1}>
        <DismissRegular fontSize={14} />
      </button>
    </div>
  );
}
