import { useState, useEffect } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { t } from "../i18n";
import type { EditorMode } from "../hooks/useMarkdownState";
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
      const text = editor.state.doc.textContent;
      const pos = editor.state.selection.$head;
      // 현재 커서가 위치한 top-level 블록의 인덱스 (1-based)
      let row = 1;
      try {
        const resolved = editor.state.doc.resolve(pos.pos);
        // depth 1 = top-level block node
        row = resolved.index(0) + 1;
      } catch {
        row = 1;
      }
      setStats({
        charCount: text.length,
        lineCount: editor.state.doc.childCount,
        cursorRow: row,
      });
    };

    update();
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  return stats;
}

interface StatusBarProps {
  markdown: string;
  isEditing: boolean;
  editorMode: EditorMode;
  editor: Editor | null;
  locale: Locale;
}

export function StatusBar({ markdown, isEditing, editorMode, editor, locale }: StatusBarProps) {
  const styles = useStyles();
  const editorStats = useEditorStats(editor);
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  const useMarkdownSource = isEditing && editorMode === "markdown";
  const charCount = useMarkdownSource ? markdown.length : editorStats.charCount;
  const lineCount = useMarkdownSource
    ? (markdown ? markdown.split("\n").length : 0)
    : editorStats.lineCount;

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
