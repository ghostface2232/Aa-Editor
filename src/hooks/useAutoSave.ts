import { useEffect, useRef } from "react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { NoteDoc } from "./useNotesLoader";
import { saveManifest } from "./useNotesLoader";
import type { TiptapEditorHandle } from "../components/TiptapEditor";
import type { MarkdownState } from "./useMarkdownState";

const DEBOUNCE_MS = 1000;

export function useAutoSave(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  docs: NoteDoc[],
  setDocs: React.Dispatch<React.SetStateAction<NoteDoc[]>>,
  activeIndex: number,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ id: string; filePath: string } | null>(null);

  useEffect(() => {
    const doc = docs[activeIndex];
    if (!doc || !doc.filePath || !state.isDirty) return;

    // 저장 대상 캡처 (document switch 중 잘못된 대상에 저장 방지)
    pendingRef.current = { id: doc.id, filePath: doc.filePath };

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const target = pendingRef.current;
      if (!target) return;

      // 현재 마크다운 추출
      let content: string;
      if (state.isEditing && state.editorMode === "markdown") {
        content = state.markdown;
      } else {
        const editor = tiptapRef.current?.getEditor();
        content = editor ? editor.getMarkdown() : state.markdown;
      }

      try {
        await writeTextFile(target.filePath, content);

        setDocs((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((d) => d.id === target.id);
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
              content,
              isDirty: false,
              updatedAt: Date.now(),
            };
          }
          return updated;
        });

        state.setIsDirty(false);
        state.setTiptapDirty(false);

        // 매니페스트도 저장
        saveManifest(
          docs.map((d) => d.id === target.id ? { ...d, updatedAt: Date.now() } : d),
          target.id,
        ).catch(() => {});
      } catch (err) {
        console.warn("Auto-save failed:", err);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.isDirty, state.markdown, state.tiptapDirty]);
}
