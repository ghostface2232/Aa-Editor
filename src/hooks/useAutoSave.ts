import { useEffect, useRef } from "react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { NoteDoc } from "./useNotesLoader";
import { saveManifest } from "./useNotesLoader";
import { getCurrentMarkdown } from "./useFileSystem";
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
  // ref로 최신 값을 캡처하여 stale closure 방지
  const stateRef = useRef({ state, tiptapRef, docs, activeIndex });
  stateRef.current = { state, tiptapRef, docs, activeIndex };

  useEffect(() => {
    if (!state.isDirty) return;

    const doc = docs[activeIndex];
    if (!doc?.filePath) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const { state: s, tiptapRef: ref, docs: latestDocs, activeIndex: idx } = stateRef.current;
      const target = latestDocs[idx];
      if (!target?.filePath) return;

      const content = getCurrentMarkdown(s, ref);

      try {
        await writeTextFile(target.filePath, content);

        setDocs((prev) => {
          const updated = [...prev];
          const i = updated.findIndex((d) => d.id === target.id);
          if (i >= 0) {
            updated[i] = { ...updated[i], content, isDirty: false, updatedAt: Date.now() };
          }
          // 매니페스트도 최신 docs 기반으로 저장
          saveManifest(updated, target.id).catch(() => {});
          return updated;
        });

        s.setIsDirty(false);
        s.setTiptapDirty(false);
      } catch (err) {
        console.warn("Auto-save failed:", err);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.isDirty, state.markdown, state.tiptapDirty, docs, activeIndex, setDocs]);
}
