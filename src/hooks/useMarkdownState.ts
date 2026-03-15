import { useState, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";

export type EditorMode = "richtext" | "markdown";

export interface MarkdownState {
  markdown: string;
  isEditing: boolean;
  editorMode: EditorMode;
  filePath: string | null;
  isDirty: boolean;
  tiptapDirty: boolean;
  editorRef: React.MutableRefObject<Editor | null>;
  toggleEditing: () => void;
  switchEditorMode: () => void;
  updateMarkdown: (value: string) => void;
  setTiptapDirty: (dirty: boolean) => void;
  setFilePath: (path: string | null) => void;
  setMarkdownRaw: (value: string) => void;
  setIsDirty: (dirty: boolean) => void;
}

export function useMarkdownState(): MarkdownState {
  const [markdown, setMarkdown] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("richtext");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [tiptapDirty, setTiptapDirty] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  // CodeMirror의 현재 값을 참조하기 위한 ref
  const codemirrorValueRef = useRef<string>("");

  const updateMarkdown = useCallback((value: string) => {
    setMarkdown(value);
    codemirrorValueRef.current = value;
    setIsDirty(true);
  }, []);

  const toggleEditing = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (isEditing) {
      // 편집 → 읽기
      if (editorMode === "richtext") {
        if (tiptapDirty) {
          const md = editor.getMarkdown();
          setMarkdown(md);
          setIsDirty(true);
          setTiptapDirty(false);
        }
      } else {
        // CodeMirror → 읽기: Tiptap에 마크다운 반영
        const cmValue = codemirrorValueRef.current;
        setMarkdown(cmValue);
        setIsDirty(true);
        // ReadonlyGuard를 임시로 풀어 setContent가 차단되지 않게
        editor.storage.readonlyGuard.readonly = false;
        editor.commands.setContent(cmValue, { contentType: "markdown" });
        setEditorMode("richtext");
      }
      setIsEditing(false);
    } else {
      // 읽기 → 편집 (Rich Text)
      setEditorMode("richtext");
      setIsEditing(true);
    }
  }, [isEditing, editorMode, tiptapDirty]);

  const switchEditorMode = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !isEditing) return;

    if (editorMode === "richtext") {
      // Rich Text → CodeMirror
      if (tiptapDirty) {
        const md = editor.getMarkdown();
        codemirrorValueRef.current = md;
        setMarkdown(md);
        setIsDirty(true);
        setTiptapDirty(false);
      } else {
        setMarkdown((prev) => {
          codemirrorValueRef.current = prev;
          return prev;
        });
      }
      setEditorMode("markdown");
    } else {
      // CodeMirror → Rich Text: Tiptap에 마크다운 반영
      const cmValue = codemirrorValueRef.current;
      setMarkdown(cmValue);
      setIsDirty(true);
      // ReadonlyGuard를 임시로 풀어 setContent가 차단되지 않게
      editor.storage.readonlyGuard.readonly = false;
      editor.commands.setContent(cmValue, { contentType: "markdown" });
      setEditorMode("richtext");
    }
  }, [isEditing, editorMode, tiptapDirty]);

  return {
    markdown,
    isEditing,
    editorMode,
    filePath,
    isDirty,
    tiptapDirty,
    editorRef,
    toggleEditing,
    switchEditorMode,
    updateMarkdown,
    setTiptapDirty,
    setFilePath,
    setMarkdownRaw: setMarkdown,
    setIsDirty,
  };
}
