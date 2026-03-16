import { useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getNotesDir, saveManifest, deriveTitle, type NoteDoc } from "./useNotesLoader";
import type { MarkdownState } from "./useMarkdownState";
import type { TiptapEditorHandle } from "../components/TiptapEditor";

export type { NoteDoc } from "./useNotesLoader";

const MD_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }];

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || "untitled.md";
}

export function getCurrentMarkdown(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
): string {
  if (state.isEditing && state.editorMode === "markdown") {
    return state.markdown;
  }
  const editor = tiptapRef.current?.getEditor();
  return editor ? editor.getMarkdown() : state.markdown;
}

function loadIntoEditor(
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  content: string,
) {
  tiptapRef.current?.setContent(content);
}

function resetDocState(
  state: MarkdownState,
  filePath: string | null,
  content: string,
) {
  state.setMarkdownRaw(content);
  state.setFilePath(filePath);
  state.setIsDirty(false);
  state.setTiptapDirty(false);
}

export interface FileSystemActions {
  openFile: () => Promise<void>;
  saveFile: () => Promise<void>;
  saveFileAs: () => Promise<void>;
  newNote: () => Promise<void>;
  switchDocument: (index: number) => void;
}

export function useFileSystem(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  docs: NoteDoc[],
  setDocs: React.Dispatch<React.SetStateAction<NoteDoc[]>>,
  activeIndex: number,
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>,
): FileSystemActions {

  /** 현재 문서의 content를 캐시에 저장 */
  const cacheCurrentContent = useCallback(() => {
    const md = getCurrentMarkdown(state, tiptapRef);
    setDocs((prev) => {
      const updated = [...prev];
      if (updated[activeIndex]) {
        updated[activeIndex] = { ...updated[activeIndex], content: md };
      }
      return updated;
    });
    return md;
  }, [state.isEditing, state.editorMode, state.markdown, activeIndex, setDocs]);

  /** 즉시 저장 (Ctrl+S) */
  const saveFile = useCallback(async () => {
    const doc = docs[activeIndex];
    if (!doc) return;

    const md = getCurrentMarkdown(state, tiptapRef);

    let targetPath = doc.filePath;
    if (doc.isExternal && !targetPath) {
      const selected = await save({ filters: MD_FILTERS, defaultPath: "untitled.md" });
      if (!selected) return;
      targetPath = selected;
    }

    await writeTextFile(targetPath, md);

    setDocs((prev) => {
      const updated = [...prev];
      if (updated[activeIndex]) {
        const title = deriveTitle(md) || updated[activeIndex].fileName;
        updated[activeIndex] = {
          ...updated[activeIndex],
          filePath: targetPath,
          content: md,
          isDirty: false,
          updatedAt: Date.now(),
          fileName: doc.isExternal ? updated[activeIndex].fileName : title || "Untitled",
        };
      }
      return updated;
    });

    state.setIsDirty(false);
    state.setTiptapDirty(false);
  }, [docs, activeIndex, state.isEditing, state.editorMode, state.markdown, setDocs]);

  /** 다른 이름으로 저장 (내보내기) */
  const saveFileAs = useCallback(async () => {
    const md = getCurrentMarkdown(state, tiptapRef);
    const doc = docs[activeIndex];
    const defaultName = doc?.filePath ? getFileName(doc.filePath) : "untitled.md";
    const selected = await save({ filters: MD_FILTERS, defaultPath: defaultName });
    if (!selected) return;
    await writeTextFile(selected, md);
  }, [docs, activeIndex, state.isEditing, state.editorMode, state.markdown]);

  /** 외부 파일 열기 */
  const openFile = useCallback(async () => {
    // 현재 문서 내용 캐시
    cacheCurrentContent();

    const selected = await open({ filters: MD_FILTERS, multiple: false });
    if (!selected) return;

    const path = selected as string;

    // 이미 열려 있는지 확인
    const existingIdx = docs.findIndex((d) => d.filePath === path);
    if (existingIdx >= 0) {
      setActiveIndex(existingIdx);
      loadIntoEditor(tiptapRef, docs[existingIdx].content);
      resetDocState(state, path, docs[existingIdx].content);
      return;
    }

    const content = await readTextFile(path);
    const fileName = getFileName(path);

    // 노트 디렉토리 내부인지 확인
    let isExternal = true;
    try {
      const notesDir = await getNotesDir();
      if (path.startsWith(notesDir)) isExternal = false;
    } catch {}

    const newDoc: NoteDoc = {
      id: crypto.randomUUID(),
      filePath: path,
      fileName,
      isExternal,
      isDirty: false,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setDocs((prev) => {
      const next = [...prev, newDoc];
      setActiveIndex(next.length - 1);
      saveManifest(next, newDoc.id).catch(() => {});
      return next;
    });

    loadIntoEditor(tiptapRef, content);
    resetDocState(state, path, content);
  }, [docs, activeIndex, cacheCurrentContent, setDocs, setActiveIndex]);

  /** 새 내부 메모 생성 */
  const newNote = useCallback(async () => {
    cacheCurrentContent();

    const id = crypto.randomUUID();
    let filePath = "";
    try {
      const dir = await getNotesDir();
      filePath = `${dir}/${id}.md`;
      await writeTextFile(filePath, "");
    } catch {
      // 브라우저 환경 fallback
    }

    const newDoc: NoteDoc = {
      id,
      filePath,
      fileName: "Untitled",
      isExternal: false,
      isDirty: false,
      content: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setDocs((prev) => {
      const next = [...prev, newDoc];
      setActiveIndex(next.length - 1);
      saveManifest(next, newDoc.id).catch(() => {});
      return next;
    });

    loadIntoEditor(tiptapRef, "");
    resetDocState(state, filePath, "");
  }, [cacheCurrentContent, setDocs, setActiveIndex]);

  /** 문서 전환 */
  const switchDocument = useCallback(
    (index: number) => {
      if (index === activeIndex) return;
      if (index < 0 || index >= docs.length) return;

      // 현재 문서 내용 캐시
      cacheCurrentContent();

      const target = docs[index];
      loadIntoEditor(tiptapRef, target.content);
      resetDocState(state, target.filePath, target.content);
      setActiveIndex(index);

      saveManifest(docs, target.id).catch(() => {});
    },
    [docs, activeIndex, cacheCurrentContent, setActiveIndex],
  );

  return { openFile, saveFile, saveFileAs, newNote, switchDocument };
}
