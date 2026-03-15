import { makeStyles } from "@fluentui/react-components";
import { PillSelector } from "./PillSelector";
import type { EditorMode } from "../hooks/useMarkdownState";

const useStyles = makeStyles({
  floating: {
    position: "absolute",
    top: "12px",
    right: "16px",
    zIndex: 5,
  },
});

const ITEMS = [
  { key: "richtext", label: "Rich Text" },
  { key: "markdown", label: "Markdown" },
];

interface EditorToolbarProps {
  editorMode: EditorMode;
  onSwitchMode: () => void;
}

export function EditorToolbar({ editorMode, onSwitchMode }: EditorToolbarProps) {
  const styles = useStyles();

  return (
    <div className={styles.floating}>
      <PillSelector
        items={ITEMS}
        activeKey={editorMode}
        onSelect={() => onSwitchMode()}
      />
    </div>
  );
}
