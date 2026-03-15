import { useMemo } from "react";
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

interface StatusBarProps {
  markdown: string;
  isEditing: boolean;
  editorMode: EditorMode;
  editor: Editor | null;
}

export function StatusBar({ markdown, isEditing, editorMode, editor }: StatusBarProps) {
  const styles = useStyles();

  // Rich Text/읽기 모드: editor의 텍스트에서 카운트
  // Markdown 모드: state.markdown에서 카운트
  const { charCount, lineCount } = useMemo(() => {
    if (editorMode === "markdown" && isEditing) {
      return {
        charCount: markdown.length,
        lineCount: markdown ? markdown.split("\n").length : 0,
      };
    }
    if (editor) {
      const text = editor.state.doc.textContent;
      return {
        charCount: text.length,
        lineCount: editor.state.doc.childCount,
      };
    }
    return { charCount: 0, lineCount: 0 };
  }, [markdown, isEditing, editorMode, editor?.state.doc]);

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
