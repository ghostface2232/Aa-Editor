import {
  Button,
  Tooltip,
  Divider,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  TextBoldRegular,
  TextItalicRegular,
  TextUnderlineRegular,
  TextStrikethroughRegular,
  CodeRegular,
  CodeBlockRegular,
  TextBulletListRegular,
  TextNumberListLtrRegular,
  TaskListLtrRegular,
  TextQuoteOpeningRegular,
  LineHorizontal1Regular,
  ImageAddRegular,
  ArrowUndoRegular,
  ArrowRedoRegular,
  ChevronDownRegular,
} from "@fluentui/react-icons";
import { PillSelector } from "./PillSelector";
import type { EditorMode } from "../hooks/useMarkdownState";
import type { Editor } from "@tiptap/react";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "6px 12px",
    flexShrink: 0,
    flexWrap: "nowrap",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 5,
    overflow: "hidden",
    maxHeight: "44px",
    transitionProperty: "max-height, opacity, padding, border-bottom-width",
    transitionDuration: "0.25s",
    transitionTimingFunction: "ease",
  },
  barHidden: {
    maxHeight: "0",
    opacity: 0,
    paddingTop: "0",
    paddingBottom: "0",
    borderBottomWidth: "0",
  },
  tools: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
    minWidth: "8px",
  },
  divider: {
    height: "20px",
    marginLeft: "4px",
    marginRight: "4px",
  },
  toolBtn: {
    minWidth: "28px",
    height: "28px",
    padding: "0",
    borderRadius: "6px",
    border: "none",
  },
  toolBtnActive: {
    minWidth: "28px",
    height: "28px",
    padding: "0",
    borderRadius: "6px",
    border: "none",
    backgroundColor: "var(--ui-active-bg)",
    fontWeight: 500,
  },
  headingBtn: {
    minWidth: "auto",
    height: "28px",
    padding: "0 8px",
    borderRadius: "6px",
    border: "none",
    fontSize: "12px",
    gap: "4px",
  },
  headingBtnActive: {
    minWidth: "auto",
    height: "28px",
    padding: "0 8px",
    borderRadius: "6px",
    border: "none",
    fontSize: "12px",
    gap: "4px",
    backgroundColor: "var(--ui-active-bg)",
    fontWeight: 500,
  },
});

const MODE_ITEMS = [
  { key: "richtext", label: "Rich Text" },
  { key: "markdown", label: "Markdown" },
];

interface EditorToolbarProps {
  editorMode: EditorMode;
  onSwitchMode: () => void;
  editor: Editor | null;
  sidebarOpen: boolean;
  visible: boolean;
}

export function EditorToolbar({
  editorMode,
  onSwitchMode,
  editor,
  sidebarOpen,
  visible,
}: EditorToolbarProps) {
  const styles = useStyles();
  const isRichText = editorMode === "richtext";
  const showTools = visible && isRichText && !!editor;

  const isHeading = editor?.isActive("heading") ?? false;
  const headingLabel = !editor
    ? "본문"
    : editor.isActive("heading", { level: 1 })
      ? "H1"
      : editor.isActive("heading", { level: 2 })
        ? "H2"
        : editor.isActive("heading", { level: 3 })
          ? "H3"
          : "본문";

  const tb = (
    tooltip: string,
    icon: React.ReactElement,
    action: () => void,
    active: boolean,
  ) => (
    <Tooltip content={tooltip} relationship="label">
      <Button
        appearance="subtle"
        icon={icon}
        className={active ? styles.toolBtnActive : styles.toolBtn}
        onClick={action}
      />
    </Tooltip>
  );

  return (
    <div
      className={mergeClasses(styles.bar, !visible && styles.barHidden)}
      style={visible && !sidebarOpen ? { paddingLeft: "46px" } : undefined}
    >
      <PillSelector
        items={MODE_ITEMS}
        activeKey={editorMode}
        onSelect={() => onSwitchMode()}
      />

      {/* 서식 도구: Rich Text일 때 슬라이드 인, Markdown일 때 슬라이드 아웃 */}
      <div className={styles.tools} style={!showTools ? { display: "none" } : undefined}>
        <Divider vertical className={styles.divider} />

        {/* 헤딩 드롭다운 */}
        <Menu>
          <MenuTrigger>
            <Button
              appearance="subtle"
              className={isHeading ? styles.headingBtnActive : styles.headingBtn}
              icon={<ChevronDownRegular />}
              iconPosition="after"
            >
              {headingLabel}
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => editor?.chain().focus().setParagraph().run()}>
                본문
              </MenuItem>
              <MenuItem onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
                <span style={{ fontSize: "1.4em", fontWeight: 600 }}>제목 1</span>
              </MenuItem>
              <MenuItem onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
                <span style={{ fontSize: "1.2em", fontWeight: 500 }}>제목 2</span>
              </MenuItem>
              <MenuItem onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
                <span style={{ fontSize: "1.05em", fontWeight: 500 }}>제목 3</span>
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>

        <Divider vertical className={styles.divider} />

        {tb("굵게 (Ctrl+B)", <TextBoldRegular />,
          () => editor?.chain().focus().toggleBold().run(),
          editor?.isActive("bold") ?? false)}
        {tb("기울임 (Ctrl+I)", <TextItalicRegular />,
          () => editor?.chain().focus().toggleItalic().run(),
          editor?.isActive("italic") ?? false)}
        {tb("밑줄 (Ctrl+U)", <TextUnderlineRegular />,
          () => editor?.chain().focus().toggleUnderline().run(),
          editor?.isActive("underline") ?? false)}
        {tb("취소선", <TextStrikethroughRegular />,
          () => editor?.chain().focus().toggleStrike().run(),
          editor?.isActive("strike") ?? false)}
        {tb("인라인 코드", <CodeRegular />,
          () => editor?.chain().focus().toggleCode().run(),
          editor?.isActive("code") ?? false)}

        <Divider vertical className={styles.divider} />

        {tb("글머리 기호 목록", <TextBulletListRegular />,
          () => editor?.chain().focus().toggleBulletList().run(),
          editor?.isActive("bulletList") ?? false)}
        {tb("번호 목록", <TextNumberListLtrRegular />,
          () => editor?.chain().focus().toggleOrderedList().run(),
          editor?.isActive("orderedList") ?? false)}
        {tb("할 일 목록", <TaskListLtrRegular />,
          () => editor?.chain().focus().toggleTaskList().run(),
          editor?.isActive("taskList") ?? false)}
        {tb("인용문", <TextQuoteOpeningRegular />,
          () => editor?.chain().focus().toggleBlockquote().run(),
          editor?.isActive("blockquote") ?? false)}
        {tb("구분선", <LineHorizontal1Regular />,
          () => editor?.chain().focus().setHorizontalRule().run(),
          false)}
        {tb("코드 블록", <CodeBlockRegular />,
          () => editor?.chain().focus().toggleCodeBlock().run(),
          editor?.isActive("codeBlock") ?? false)}

        <Divider vertical className={styles.divider} />

        {tb("이미지 삽입", <ImageAddRegular />,
          () => {
            const url = window.prompt("이미지 URL");
            if (url) editor?.chain().focus().setImage({ src: url }).run();
          },
          false)}

        <div className={styles.spacer} />

        {tb("실행취소 (Ctrl+Z)", <ArrowUndoRegular />,
          () => editor?.chain().focus().undo().run(),
          false)}
        {tb("다시실행 (Ctrl+Y)", <ArrowRedoRegular />,
          () => editor?.chain().focus().redo().run(),
          false)}
      </div>
    </div>
  );
}
