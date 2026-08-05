import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { Editor } from "@tiptap/core";
import { buildLineIndex, lineToPos, posToLine, selectionForLinePos } from "../utils/documentLines";
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
    alignItems: "center",
    gap: "2px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "6px 5px 6px 12px",
    boxShadow: tokens.shadow8,
    minWidth: "100px",
    width: "fit-content",
    pointerEvents: "auto",
  },
  input: {
    width: "60px",
    border: "none",
    outline: "none",
    fontSize: "13px",
    fontFamily: "inherit",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
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
});

interface GoToLineBarProps {
  editor: Editor | null;
  onClose: () => void;
  locale: Locale;
}

export function GoToLineBar({ editor, onClose, locale }: GoToLineBarProps) {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  // Track the document ourselves. The bar stays open while the user keeps
  // typing, and App does not re-render per keystroke, so deriving the total
  // from `editor.state.doc` during render alone would freeze it at whatever it
  // was when the bar opened — and disagree with the status bar's count.
  //
  // Coalesced to one update per frame, like the status bar's own stats hook:
  // rebuilding the line index is an O(document) walk, and running it on every
  // transaction would walk the document twice per frame while the bar is open.
  const [trackedDoc, setTrackedDoc] = useState(() => editor?.state.doc ?? null);
  useEffect(() => {
    if (!editor) {
      setTrackedDoc(null);
      return;
    }
    let frame: number | null = null;
    const apply = () => {
      frame = null;
      setTrackedDoc((prev) => (prev === editor.state.doc ? prev : editor.state.doc));
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(apply);
    };
    apply();
    editor.on("transaction", schedule);
    return () => {
      editor.off("transaction", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor]);

  // Same logical-line definition the status bar reports, so the number the user
  // reads there is the number they can type here.
  const lineIndex = useMemo(
    () => (trackedDoc ? buildLineIndex(trackedDoc) : null),
    [trackedDoc],
  );
  const totalLines = lineIndex?.total ?? 0;

  // The caret's line seeds the input once, at mount. Deriving it on every
  // render would repeat a document walk whose result is then discarded.
  const [lineValue, setLineValue] = useState(() => {
    if (!editor) return "1";
    return String(posToLine(buildLineIndex(editor.state.doc), editor.state.selection.from));
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const showIndicator = useCallback((dom: HTMLElement, coords: { top: number; bottom: number }) => {
    let scrollParent: HTMLElement | null = dom.parentElement;
    while (scrollParent) {
      const { overflowY } = window.getComputedStyle(scrollParent);
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;

    if (!indicatorRef.current) {
      const el = document.createElement("div");
      el.className = "goto-line-indicator";
      scrollParent.style.position = "relative";
      scrollParent.appendChild(el);
      indicatorRef.current = el;
    }

    const el = indicatorRef.current;
    const parentRect = scrollParent.getBoundingClientRect();
    const top = coords.top - parentRect.top + scrollParent.scrollTop;
    const height = coords.bottom - coords.top;
    el.style.cssText = `
      position: absolute; left: calc(var(--editor-padding-x, 2rem) - 8px); top: ${top}px;
      width: 3px; height: ${height}px; border-radius: 1.5px;
      background: var(--colorBrandForeground1, #0078d4);
      pointer-events: none; z-index: 5;
      transition: top var(--motion-base) ease, height var(--motion-base) ease, opacity var(--motion-base) ease;
      opacity: 1;
    `;
  }, []);

  const hideIndicator = useCallback(() => {
    if (indicatorRef.current) {
      indicatorRef.current.remove();
      indicatorRef.current = null;
    }
  }, []);

  useEffect(() => hideIndicator, [hideIndicator]);

  const jumpToLine = useCallback((rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!/^\d+$/.test(trimmed)) return;
    const parsed = Number.parseInt(trimmed, 10);
    if (!editor) return;

    // Rebuild rather than reuse the memo: `trackedDoc` is a frame behind by
    // design, so during that frame the memoised index describes the previous
    // document and would resolve the jump to the wrong position.
    const index = buildLineIndex(editor.state.doc);
    const clamped = Math.max(1, Math.min(index.total, parsed));
    const pos = lineToPos(index, clamped);
    const { tr } = editor.state;
    tr.setSelection(selectionForLinePos(editor.state.doc, pos));
    editor.view.dispatch(tr);
    // scrollIntoView requires focus, so we drive scroll manually via scrollToPos
    scrollToPos(editor.view.dom, () => editor.view.coordsAtPos(pos));
    requestAnimationFrame(() => {
      try {
        const coords = editor.view.coordsAtPos(pos);
        showIndicator(editor.view.dom, coords);
      } catch {}
    });
    if (String(clamped) !== rawValue) {
      setLineValue(String(clamped));
    }
  }, [editor, showIndicator]);

  const handleClose = useCallback(() => {
    hideIndicator();
    editor?.commands.focus();
    onClose();
  }, [editor, onClose, hideIndicator]);

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        className={styles.input}
        value={lineValue}
        onChange={(e) => {
          const next = e.target.value;
          setLineValue(next);
          jumpToLine(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            handleClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            jumpToLine(lineValue);
          }
        }}
        placeholder={i("search.gotoLinePlaceholder")}
        inputMode="numeric"
        spellCheck={false}
      />
      <span className={styles.count}>
        / {totalLines}
      </span>
      <button className={styles.btn} onClick={handleClose} tabIndex={-1}>
        <DismissRegular fontSize={16} />
      </button>
    </div>
  );
}
