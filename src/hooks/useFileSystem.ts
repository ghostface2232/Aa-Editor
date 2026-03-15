import { useCallback } from "react";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { MarkdownState } from "./useMarkdownState";
import type { TiptapEditorHandle } from "../components/TiptapEditor";

export interface OpenDocument {
  filePath: string;
  fileName: string;
  isDirty: boolean;
}

export interface FileSystemActions {
  openFile: () => Promise<void>;
  saveFile: () => Promise<void>;
  saveFileAs: () => Promise<void>;
  newFile: () => Promise<void>;
  switchDocument: (index: number) => void;
}

const MD_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }];

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || "untitled.md";
}

/** 현재 에디터에서 최신 마크다운 추출 */
function getCurrentMarkdown(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
): string {
  if (state.isEditing && state.editorMode === "markdown") {
    return state.markdown;
  }
  const editor = tiptapRef.current?.getEditor();
  return editor ? editor.getMarkdown() : state.markdown;
}

/** Tiptap에 마크다운 로드 (ReadonlyGuard bypass는 handle 내부에서 처리) */
function loadIntoEditor(
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  content: string,
) {
  tiptapRef.current?.setContent(content);
}

/** 문서 state 일괄 리셋 */
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

/** isDirty 시 저장 확인. true=계속 진행, false=취소 */
async function confirmDirty(
  state: MarkdownState,
  doSave: () => Promise<void>,
): Promise<boolean> {
  if (!state.isDirty) return true;
  const result = await confirm(
    "저장되지 않은 변경사항이 있습니다. 저장하시겠습니까?",
    { title: "Markdown Studio", kind: "warning", okLabel: "저장", cancelLabel: "저장하지 않음" },
  );
  if (result) await doSave();
  return true;
}

/** 파일에 저장하고 문서 목록 업데이트 */
async function writeAndUpdate(
  path: string,
  content: string,
  state: MarkdownState,
  activeDocIndex: number,
  setOpenDocuments: React.Dispatch<React.SetStateAction<OpenDocument[]>>,
) {
  await writeTextFile(path, content);
  state.setFilePath(path);
  state.setIsDirty(false);
  state.setTiptapDirty(false);
  const fileName = getFileName(path);
  setOpenDocuments((docs) => {
    const updated = [...docs];
    if (updated[activeDocIndex]) {
      updated[activeDocIndex] = { filePath: path, fileName, isDirty: false };
    }
    return updated;
  });
}

export function useFileSystem(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  openDocuments: OpenDocument[],
  setOpenDocuments: React.Dispatch<React.SetStateAction<OpenDocument[]>>,
  activeDocIndex: number,
  setActiveDocIndex: React.Dispatch<React.SetStateAction<number>>,
): FileSystemActions {

  const saveFile = useCallback(async () => {
    const md = getCurrentMarkdown(state, tiptapRef);
    let path = state.filePath;
    if (!path) {
      const selected = await save({ filters: MD_FILTERS, defaultPath: "untitled.md" });
      if (!selected) return;
      path = selected;
    }
    await writeAndUpdate(path, md, state, activeDocIndex, setOpenDocuments);
  }, [state.filePath, state.isEditing, state.editorMode, state.markdown, activeDocIndex, setOpenDocuments]);

  const saveFileAs = useCallback(async () => {
    const md = getCurrentMarkdown(state, tiptapRef);
    const defaultName = state.filePath ? getFileName(state.filePath) : "untitled.md";
    const selected = await save({ filters: MD_FILTERS, defaultPath: defaultName });
    if (!selected) return;
    await writeAndUpdate(selected, md, state, activeDocIndex, setOpenDocuments);
  }, [state.filePath, state.isEditing, state.editorMode, state.markdown, activeDocIndex, setOpenDocuments]);

  const openFile = useCallback(async () => {
    const canProceed = await confirmDirty(state, saveFile);
    if (!canProceed) return;

    const selected = await open({ filters: MD_FILTERS, multiple: false });
    if (!selected) return;

    const path = selected as string;
    const content = await readTextFile(path);
    const fileName = getFileName(path);

    loadIntoEditor(tiptapRef, content);
    resetDocState(state, path, content);

    // 이미 열린 문서면 활성화, 아니면 추가
    setOpenDocuments((docs) => {
      const existingIdx = docs.findIndex((d) => d.filePath === path);
      if (existingIdx >= 0) {
        const updated = [...docs];
        updated[existingIdx] = { filePath: path, fileName, isDirty: false };
        setActiveDocIndex(existingIdx);
        return updated;
      }
      setActiveDocIndex(docs.length);
      return [...docs, { filePath: path, fileName, isDirty: false }];
    });
  }, [state.isDirty, state.filePath, saveFile, setOpenDocuments, setActiveDocIndex]);

  const newFile = useCallback(async () => {
    const canProceed = await confirmDirty(state, saveFile);
    if (!canProceed) return;

    loadIntoEditor(tiptapRef, "");
    resetDocState(state, null, "");

    setOpenDocuments((docs) => {
      setActiveDocIndex(docs.length);
      return [...docs, { filePath: "", fileName: "Untitled", isDirty: false }];
    });
  }, [state.isDirty, saveFile, setOpenDocuments, setActiveDocIndex]);

  const switchDocument = useCallback(
    (index: number) => {
      if (index === activeDocIndex) return;

      setOpenDocuments((docs) => {
        if (index < 0 || index >= docs.length) return docs;
        // 현재 문서 dirty 상태 저장
        const updated = [...docs];
        if (updated[activeDocIndex]) {
          updated[activeDocIndex] = { ...updated[activeDocIndex], isDirty: state.isDirty };
        }
        return updated;
      });

      // 대상 문서 로드
      const target = openDocuments[index];
      if (!target) return;

      if (target.filePath) {
        readTextFile(target.filePath).then((content) => {
          loadIntoEditor(tiptapRef, content);
          resetDocState(state, target.filePath, content);
        });
      } else {
        loadIntoEditor(tiptapRef, "");
        resetDocState(state, null, "");
      }

      setActiveDocIndex(index);
    },
    [state.isDirty, activeDocIndex, openDocuments, setOpenDocuments, setActiveDocIndex],
  );

  return { openFile, saveFile, saveFileAs, newFile, switchDocument };
}
