import { useState, useRef, useEffect, useCallback } from "react";
import { makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import {
  ArrowUpRegular,
  ArrowDownRegular,
  ArrowSwapRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import type { Editor } from "@tiptap/core";
import {
  searchPluginKey,
  findSearchMatches,
  selectNonOverlappingMatches,
  type SearchPluginState,
} from "../extensions/SearchHighlight";
import { scrollToPos } from "../utils/scrollToPos";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";
import { pressableButton } from "../styles/interactions";

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
    width: "310px",
    pointerEvents: "auto",
  },
  topRow: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "6px 5px 6px 12px",
  },
  replaceRow: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "0 5px 6px 12px",
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
    lineHeight: "28px",
    "::placeholder": {
      color: tokens.colorNeutralForeground4,
      opacity: 0.55,
    },
  },
  count: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    paddingRight: "4px",
    minWidth: "36px",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  countNoMatch: {
    color: tokens.colorPaletteRedForeground1,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
    ...pressableButton,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  btnActive: {
    backgroundColor: tokens.colorNeutralBackground1Pressed,
  },
  caseSwitch: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    height: "28px",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground3,
    cursor: "pointer",
    flexShrink: 0,
    padding: "0 4px",
    marginRight: "2px",
    fontSize: "12px",
    fontFamily: "inherit",
    lineHeight: 1,
    ...pressableButton,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  caseSwitchOn: {
    color: tokens.colorNeutralForeground1,
  },
  caseTrack: {
    position: "relative",
    boxSizing: "border-box",
    width: "22px",
    height: "12px",
    borderRadius: "6px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStrokeAccessible),
    backgroundColor: "transparent",
    ...shorthands.transition([["background-color", "120ms", "ease"], ["border-color", "120ms", "ease"]]),
    flexShrink: 0,
  },
  caseTrackOn: {
    ...shorthands.borderColor(tokens.colorNeutralForeground2),
    backgroundColor: tokens.colorNeutralForeground2,
  },
  caseKnob: {
    position: "absolute",
    top: "50%",
    left: "2px",
    marginTop: "-3px",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: tokens.colorNeutralStrokeAccessible,
    ...shorthands.transition([["transform", "120ms", "ease"], ["background-color", "120ms", "ease"]]),
  },
  caseKnobOn: {
    transform: "translateX(10px)",
    backgroundColor: tokens.colorNeutralForegroundInverted,
  },
  textBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: "28px",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    flexShrink: 0,
    padding: "0 8px",
    fontSize: "12px",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    ...pressableButton,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
});

interface SearchBarProps {
  editor: Editor | null;
  onClose: () => void;
  replaceOpen: boolean;
  onToggleReplace: (open: boolean) => void;
  locale: Locale;
  /** Announces how many matches a Replace all touched; nothing else reports it. */
  onNotice: (text: string) => void;
}

export function SearchBar({ editor, onClose, replaceOpen, onToggleReplace, locale, onNotice }: SearchBarProps) {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (replaceOpen) replaceInputRef.current?.focus(); }, [replaceOpen]);

  const dispatchTiptap = useCallback(
    (q: string, activeIdx: number, matchCase: boolean) => {
      if (!editor) return { count: 0, clamped: 0 };
      const matches = findSearchMatches(editor.state.doc, q, matchCase);
      const clamped = matches.length > 0
        ? ((activeIdx % matches.length) + matches.length) % matches.length
        : 0;

      const { tr } = editor.state;
      tr.setMeta(searchPluginKey, { query: q, activeIndex: clamped, matches, caseSensitive: matchCase } satisfies SearchPluginState);
      editor.view.dispatch(tr);

      if (matches.length > 0) {
        const match = matches[clamped];
        scrollToPos(editor.view.dom, () => editor.view.coordsAtPos(match.from));
      }
      return { count: matches.length, clamped };
    },
    [editor],
  );

  const dispatchSearch = useCallback(
    (q: string, idx: number, matchCase: boolean = caseSensitive) => {
      const result = dispatchTiptap(q, idx, matchCase);
      setMatchCount(result.count);
      setActiveIndex(result.clamped);
    },
    [dispatchTiptap, caseSensitive],
  );

  const handleQueryChange = useCallback(
    (value: string) => { setQuery(value); dispatchSearch(value, 0); },
    [dispatchSearch],
  );

  const toggleCaseSensitive = useCallback(() => {
    const next = !caseSensitive;
    setCaseSensitive(next);
    dispatchSearch(query, 0, next);
  }, [caseSensitive, dispatchSearch, query]);

  const goNext = useCallback(() => dispatchSearch(query, activeIndex + 1), [dispatchSearch, query, activeIndex]);
  const goPrev = useCallback(() => dispatchSearch(query, activeIndex - 1), [dispatchSearch, query, activeIndex]);

  const handleClose = useCallback(() => {
    if (editor) {
      const { tr } = editor.state;
      tr.setMeta(searchPluginKey, { query: "", activeIndex: 0, matches: [], caseSensitive } satisfies SearchPluginState);
      editor.view.dispatch(tr);
    }
    setReplaceText("");
    onToggleReplace(false);
    onClose();
  }, [editor, onClose, onToggleReplace, caseSensitive]);

  const syncAfterReplace = useCallback(
    (desiredIndex: number) => {
      if (!editor) return;
      // Plugin already recomputed matches in apply().
      const ps = searchPluginKey.getState(editor.state) as SearchPluginState;
      const count = ps.matches.length;
      const idx = count > 0
        ? ((desiredIndex % count) + count) % count
        : 0;

      if (idx !== ps.activeIndex) {
        const { tr } = editor.state;
        tr.setMeta(searchPluginKey, { query, activeIndex: idx, matches: ps.matches, caseSensitive } satisfies SearchPluginState);
        editor.view.dispatch(tr);
      }

      setMatchCount(count);
      setActiveIndex(idx);
      if (count > 0 && ps.matches[idx]) {
        scrollToPos(editor.view.dom, () => editor.view.coordsAtPos(ps.matches[idx].from));
      }
    },
    [editor, query, caseSensitive],
  );

  const handleReplace = useCallback(() => {
    if (!editor || !query || matchCount === 0) return;
    const ps = searchPluginKey.getState(editor.state) as SearchPluginState;
    const match = ps.matches[ps.activeIndex];
    if (!match) return;

    const { tr } = editor.state;
    tr.insertText(replaceText, match.from, match.to);
    editor.view.dispatch(tr);
    syncAfterReplace(activeIndex);
  }, [editor, query, replaceText, matchCount, activeIndex, syncAfterReplace]);

  const handleReplaceAll = useCallback(() => {
    if (!editor || !query || matchCount === 0) return;
    const ps = searchPluginKey.getState(editor.state) as SearchPluginState;
    const matches = selectNonOverlappingMatches(ps.matches);
    if (matches.length === 0) return;

    const { tr } = editor.state;
    for (const match of matches) {
      tr.insertText(replaceText, tr.mapping.map(match.from), tr.mapping.map(match.to));
    }
    editor.view.dispatch(tr);
    syncAfterReplace(0);
    onNotice(t("search.replaced", locale).replace("{n}", String(matches.length)));
  }, [editor, query, replaceText, matchCount, syncAfterReplace, onNotice, locale]);

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

  const noMatch = query !== "" && matchCount === 0;

  return (
    <div className={styles.wrapper}>
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
        <span
          className={mergeClasses(styles.count, noMatch && styles.countNoMatch)}
          style={{ visibility: query ? "visible" : "hidden" }}
        >
          {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : "0/0"}
        </span>
        <button
          className={mergeClasses(styles.caseSwitch, caseSensitive && styles.caseSwitchOn)}
          onClick={toggleCaseSensitive}
          title={i("search.caseSensitive")}
          aria-label={i("search.caseSensitive")}
          role="switch"
          aria-checked={caseSensitive}
        >
          <span aria-hidden="true">Aa</span>
          <span aria-hidden="true" className={mergeClasses(styles.caseTrack, caseSensitive && styles.caseTrackOn)}>
            <span className={mergeClasses(styles.caseKnob, caseSensitive && styles.caseKnobOn)} />
          </span>
        </button>
        <button
          className={mergeClasses(styles.btn, replaceOpen && styles.btnActive)}
          onClick={() => onToggleReplace(!replaceOpen)}
          tabIndex={-1}
          title={i("search.replace")}
          aria-label={i("search.replace")}
          aria-pressed={replaceOpen}
        >
          <ArrowSwapRegular fontSize={16} />
        </button>
        <button className={styles.btn} onClick={goPrev} tabIndex={-1} title={i("search.previous")} aria-label={i("search.previous")}>
          <ArrowUpRegular fontSize={16} />
        </button>
        <button className={styles.btn} onClick={goNext} tabIndex={-1} title={i("search.next")} aria-label={i("search.next")}>
          <ArrowDownRegular fontSize={16} />
        </button>
        <button className={styles.btn} onClick={handleClose} tabIndex={-1} title={i("search.close")} aria-label={i("search.close")}>
          <DismissRegular fontSize={16} />
        </button>
      </div>

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
          <button className={styles.textBtn} onClick={handleReplace} tabIndex={-1}>
            {i("search.replace")}
          </button>
          <button className={styles.textBtn} onClick={handleReplaceAll} tabIndex={-1}>
            {i("search.replaceAll")}
          </button>
        </div>
      )}
    </div>
  );
}
