import { memo, useState, useEffect } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { t } from "../i18n";
import type { Editor } from "@tiptap/react";
import type { Locale } from "../hooks/useSettings";
import { MOTION_DURATION_SLOW } from "../styles/interactions";

const useStyles = makeStyles({
  shell: {
    flexShrink: 0,
    height: "24px",
    overflow: "hidden",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    transitionProperty: "height, border-top-color, background-color",
    transitionDuration: MOTION_DURATION_SLOW,
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  shellHidden: {
    pointerEvents: "none",
    height: "0px",
    borderTopColor: "transparent",
    backgroundColor: "transparent",
  },
  statusBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "24px",
    paddingLeft: "12px",
    paddingRight: "12px",
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    userSelect: "none",
    transitionProperty: "transform, opacity",
    transitionDuration: MOTION_DURATION_SLOW,
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  statusBarHidden: {
    transform: "translateY(18px)",
    opacity: 0,
  },
  left: {
    display: "flex",
    gap: "16px",
  },
});

function useEditorStats(editor: Editor | null, enabled: boolean) {
  const [stats, setStats] = useState({ charCount: 0, lineCount: 0, cursorRow: 1 });

  useEffect(() => {
    if (!editor || !enabled) return;

    // Keep the expensive document-wide counts keyed to ProseMirror's immutable
    // doc identity. Selection-only transactions reuse the same node, so cursor
    // movement updates only the cheap row readout.
    let frame: number | null = null;
    let lastDoc: Editor["state"]["doc"] | null = null;
    let charCount = 0;
    let lineCount = 0;
    const compute = () => {
      frame = null;
      const doc = editor.state.doc;
      if (doc !== lastDoc) {
        lastDoc = doc;
        charCount = doc.textContent.length;
        lineCount = doc.childCount;
      }
      const row = editor.state.selection.$head.index(0) + 1;
      setStats((prev) => {
        const next = {
          charCount,
          lineCount,
          cursorRow: row,
        };
        if (prev.charCount === next.charCount && prev.lineCount === next.lineCount && prev.cursorRow === next.cursorRow) {
          return prev;
        }
        return next;
      });
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(compute);
    };

    compute();
    editor.on("transaction", schedule);
    return () => {
      editor.off("transaction", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor, enabled]);

  return stats;
}

interface StatusBarProps {
  editor: Editor | null;
  hidden: boolean;
  locale: Locale;
}

function StatusBarImpl({ editor, hidden, locale }: StatusBarProps) {
  const styles = useStyles();
  const { charCount, lineCount, cursorRow } = useEditorStats(editor, !hidden);
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  return (
    <div
      className={hidden ? `${styles.shell} ${styles.shellHidden}` : styles.shell}
    >
      <div className={hidden ? `${styles.statusBar} ${styles.statusBarHidden}` : styles.statusBar}>
        <div className={styles.left}>
          <span>{charCount.toLocaleString()}{i("status.chars")}</span>
          <span>{lineCount.toLocaleString()}{i("status.lines")}</span>
        </div>
        <span>{i("status.cursorRow")}{cursorRow}{i("status.cursorRowSuffix")}</span>
      </div>
    </div>
  );
}

// Memoized so unrelated App state changes (e.g. a sidebar group toggle) don't
// re-render the status bar. Cursor/char stats come from its own editor hook.
export const StatusBar = memo(StatusBarImpl);
