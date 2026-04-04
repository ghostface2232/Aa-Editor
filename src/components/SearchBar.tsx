import { useState, useRef, useEffect, useCallback } from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  ArrowUpRegular,
  ArrowDownRegular,
  ArrowSwapRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import type { Editor } from "@tiptap/core";
import type { EditorView as CmEditorView } from "@codemirror/view";
import { searchPluginKey, type SearchPluginState } from "../extensions/SearchHighlight";
import { setCmSearch } from "../extensions/cmSearchHighlight";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";

/* ─── inline SVG icons for replace actions ─── */

const ReplaceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 1l3 3-3 3" />
    <path d="M2 7V5a2 2 0 0 1 2-2h10" />
    <path d="M5 15l-3-3 3-3" />
    <path d="M14 9v2a2 2 0 0 1-2 2H2" />
  </svg>
);

const ReplaceAllIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 1l3 3-3 3" />
    <path d="M2 4h12" />
    <path d="M5 15l-3-3 3-3" />
    <path d="M14 12H2" />
  </svg>
);

const useStyles = makeStyles({
  wrapper: {
    position: "absolute",
    top: "8px",
    right: "20px",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    boxShadow: tokens.shadow8,
    width: "280px",
    pointerEvents: "auto",
  },
  topRow: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "4px 4px 4px 10px",
  },
  replaceRow: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "0 4px 4px 10px",
    overflow: "hidden",
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
  btnActive: {
    backgroundColor: tokens.colorNeutralBackground1Pressed,
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
  replaceOpen: boolean;
  onToggleReplace: (open: boolean) => void;
  locale: Locale;
}

export function SearchBar({ editor, cmView, isCmMode, onClose, replaceOpen, onToggleReplace, locale }: SearchBarProps) {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (replaceOpen) replaceInputRef.current?.focus(); }, [replaceOpen]);

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
    setReplaceText("");
    onToggleReplace(false);
    onClose();
  }, [editor, cmView, isCmMode, onClose, onToggleReplace]);

  /* ── Tiptap: sync React state from plugin after content dispatch ── */

  const syncAfterTiptapReplace = useCallback(
    (desiredIndex: number) => {
      if (!editor) return;
      // Plugin already recomputed matches in apply() — read directly, no doc traversal
      const ps = searchPluginKey.getState(editor.state) as SearchPluginState;
      const count = ps.matches.length;
      const idx = count > 0
        ? ((desiredIndex % count) + count) % count
        : 0;

      // Correct activeIndex for decoration highlighting (wrapping vs clamping)
      if (idx !== ps.activeIndex) {
        const { tr } = editor.state;
        tr.setMeta(searchPluginKey, { query, activeIndex: idx, matches: ps.matches } satisfies SearchPluginState);
        editor.view.dispatch(tr);
      }

      setMatchCount(count);
      setActiveIndex(idx);
      if (count > 0 && ps.matches[idx]) {
        scrollToPos(editor.view.dom, () => editor.view.coordsAtPos(ps.matches[idx].from));
      }
    },
    [editor, query],
  );

  /* ── replace — Tiptap ── */

  const handleReplaceTiptap = useCallback(() => {
    if (!editor || !query || matchCount === 0) return;
    const ps = searchPluginKey.getState(editor.state) as SearchPluginState;
    const match = ps.matches[ps.activeIndex];
    if (!match) return;

    const { tr } = editor.state;
    tr.insertText(replaceText, match.from, match.to);
    editor.view.dispatch(tr);
    syncAfterTiptapReplace(activeIndex);
  }, [editor, query, replaceText, matchCount, activeIndex, syncAfterTiptapReplace]);

  const handleReplaceAllTiptap = useCallback(() => {
    if (!editor || !query || matchCount === 0) return;
    const ps = searchPluginKey.getState(editor.state) as SearchPluginState;
    const { matches } = ps;

    const { tr } = editor.state;
    for (let idx = matches.length - 1; idx >= 0; idx--) {
      tr.insertText(replaceText, matches[idx].from, matches[idx].to);
    }
    editor.view.dispatch(tr);
    syncAfterTiptapReplace(0);
  }, [editor, query, replaceText, matchCount, syncAfterTiptapReplace]);

  /* ── replace — CodeMirror ── */

  const handleReplaceCm = useCallback(() => {
    if (!cmView || !query) return;
    const matches = findCmMatches(cmView.state.doc.toString(), query);
    if (matches.length === 0) return;
    const idx = ((activeIndex % matches.length) + matches.length) % matches.length;
    const match = matches[idx];

    cmView.dispatch({
      changes: { from: match.from, to: match.to, insert: replaceText },
    });
    dispatchSearch(query, idx);
  }, [cmView, query, replaceText, activeIndex, dispatchSearch]);

  const handleReplaceAllCm = useCallback(() => {
    if (!cmView || !query) return;
    const matches = findCmMatches(cmView.state.doc.toString(), query);
    if (matches.length === 0) return;

    const changes = [...matches]
      .reverse()
      .map(m => ({ from: m.from, to: m.to, insert: replaceText }));
    cmView.dispatch({ changes });
    dispatchSearch(query, 0);
  }, [cmView, query, replaceText, dispatchSearch]);

  /* ── unified replace ── */

  const handleReplace = useCallback(() => {
    isCmMode ? handleReplaceCm() : handleReplaceTiptap();
  }, [isCmMode, handleReplaceCm, handleReplaceTiptap]);

  const handleReplaceAll = useCallback(() => {
    isCmMode ? handleReplaceAllCm() : handleReplaceAllTiptap();
  }, [isCmMode, handleReplaceAllCm, handleReplaceAllTiptap]);

  /* ── keyboard ── */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); handleClose(); }
      else if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? goPrev() : goNext(); }
    },
    [handleClose, goNext, goPrev],
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); handleClose(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleReplaceAll(); }
      else if (e.key === "Enter") { e.preventDefault(); handleReplace(); }
    },
    [handleClose, handleReplace, handleReplaceAll],
  );

  return (
    <div className={styles.wrapper}>
      {/* ── Find row ── */}
      <div className={styles.topRow}>
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
        <button
          className={mergeClasses(styles.btn, replaceOpen && styles.btnActive)}
          onClick={() => onToggleReplace(!replaceOpen)}
          tabIndex={-1}
          title={i("search.replacePlaceholder")}
        >
          <ArrowSwapRegular fontSize={14} />
        </button>
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

      {/* ── Replace row ── */}
      {replaceOpen && (
        <div className={styles.replaceRow}>
          <input
            ref={replaceInputRef}
            className={styles.input}
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder={i("search.replacePlaceholder")}
            spellCheck={false}
          />
          <button className={styles.btn} onClick={handleReplace} tabIndex={-1} title="Replace">
            <ReplaceIcon />
          </button>
          <button className={styles.btn} onClick={handleReplaceAll} tabIndex={-1} title="Replace All">
            <ReplaceAllIcon />
          </button>
        </div>
      )}
    </div>
  );
}
