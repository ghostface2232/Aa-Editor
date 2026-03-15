import { useState, useEffect } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { EditorMode } from "../hooks/useMarkdownState";
import type { Editor } from "@tiptap/react";

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
  right: {
    display: "flex",
    gap: "16px",
  },
});

function useEditorStats(editor: Editor | null) {
  const [stats, setStats] = useState({ charCount: 0, lineCount: 0 });

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const text = editor.state.doc.textContent;
      setStats({
        charCount: text.length,
        lineCount: editor.state.doc.childCount,
      });
    };

    update(); // 초기값
    editor.on("update", update);
    return () => { editor.off("update", update); };
  }, [editor]);

  return stats;
}

interface StatusBarProps {
  markdown: string;
  isEditing: boolean;
  editorMode: EditorMode;
  editor: Editor | null;
}

export function StatusBar({ markdown, isEditing, editorMode, editor }: StatusBarProps) {
  const styles = useStyles();
  const editorStats = useEditorStats(editor);

  const useMarkdownSource = isEditing && editorMode === "markdown";
  const charCount = useMarkdownSource ? markdown.length : editorStats.charCount;
  const lineCount = useMarkdownSource
    ? (markdown ? markdown.split("\n").length : 0)
    : editorStats.lineCount;

  const modeLabel = !isEditing
    ? "읽기"
    : editorMode === "richtext"
      ? "Rich Text"
      : "Markdown";

  return (
    <div className={styles.statusBar}>
      <div className={styles.left}>
        <span>{charCount.toLocaleString()} 자</span>
        <span>{lineCount.toLocaleString()} 줄</span>
      </div>
      <div className={styles.right}>
        <span>UTF-8</span>
        <span>{modeLabel}</span>
      </div>
    </div>
  );
}
