import { makeStyles, tokens } from "@fluentui/react-components";
import type { EditorMode } from "../hooks/useMarkdownState";

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
}

export function StatusBar({ markdown, isEditing, editorMode }: StatusBarProps) {
  const styles = useStyles();

  const charCount = markdown.length;
  const lineCount = markdown ? markdown.split("\n").length : 0;
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
