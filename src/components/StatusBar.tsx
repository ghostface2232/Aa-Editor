import { useState, useEffect, useMemo } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { t } from "../i18n";
import type { EditorSurface } from "../hooks/useMarkdownState";
import type { Editor } from "@tiptap/react";
import type { Locale } from "../hooks/useSettings";

const useStyles = makeStyles({
  statusBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "24px",
    paddingLeft: "12px",
    paddingRight: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    userSelect: "none",
  },
  left: {
    display: "flex",
    gap: "16px",
  },
});

function useEditorStats(editor: Editor | null) {
  const [stats, setStats] = useState({ charCount: 0, lineCount: 0, cursorRow: 1 });

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const doc = editor.state.doc;
      let row = 1;
      try {
        row = doc.resolve(editor.state.selection.$head.pos).index(0) + 1;
      } catch {}
      setStats((prev) => {
        const next = {
          charCount: doc.textContent.length,
          lineCount: doc.childCount,
          cursorRow: row,
        };
        // 변경 없으면 동일 참조 반환 → 불필요한 리렌더 방지
        if (prev.charCount === next.charCount && prev.lineCount === next.lineCount && prev.cursorRow === next.cursorRow) {
          return prev;
        }
        return next;
      });
    };

    update();
    // transaction은 update + selectionUpdate를 모두 포함
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);

  return stats;
}

/** 뉴라인 문자 수 세기 (split보다 효율적) */
function countLines(str: string): number {
  if (!str) return 0;
  let count = 1;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 10) count++;
  }
  return count;
}

interface StatusBarProps {
  markdown: string;
  surface: EditorSurface;
  editor: Editor | null;
  locale: Locale;
}

export function StatusBar({ markdown, surface, editor, locale }: StatusBarProps) {
  const styles = useStyles();
  const editorStats = useEditorStats(editor);
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  const useMarkdownSource = surface === "markdown";
  const mdLineCount = useMemo(() => countLines(markdown), [markdown]);
  const charCount = useMarkdownSource ? markdown.length : editorStats.charCount;
  const lineCount = useMarkdownSource ? mdLineCount : editorStats.lineCount;

  return (
    <div className={styles.statusBar}>
      <div className={styles.left}>
        <span>{charCount.toLocaleString()}{i("status.chars")}</span>
        <span>{lineCount.toLocaleString()}{i("status.lines")}</span>
      </div>
      <span>{i("status.cursorRow")}{editorStats.cursorRow}{i("status.cursorRowSuffix")}</span>
    </div>
  );
}
