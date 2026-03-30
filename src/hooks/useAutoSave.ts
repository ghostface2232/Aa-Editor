import { useCallback, useEffect, useRef } from "react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { NoteDoc } from "./useNotesLoader";
import { deriveTitle, saveManifest, sortNotes } from "./useNotesLoader";
import { getCurrentMarkdown } from "./useFileSystem";
import type { TiptapEditorHandle } from "../components/TiptapEditor";
import type { MarkdownState } from "./useMarkdownState";
import type { Locale, NotesSortOrder } from "./useSettings";
import { getDefaultDocumentTitle } from "../utils/documentTitle";
import { emitDocUpdated } from "./useWindowSync";
import { markOwnWrite } from "./ownWriteTracker";

const DEBOUNCE_MS = 1000;

interface SaveSnapshot {
  docId: string;
  filePath: string;
  content: string;
  revision: number;
}

export function useAutoSave(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  docs: NoteDoc[],
  setDocs: React.Dispatch<React.SetStateAction<NoteDoc[]>>,
  activeIndex: number,
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>,
  locale: Locale,
  notesSortOrder: NotesSortOrder,
) {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingSnapshotsRef = useRef(new Map<string, SaveSnapshot>());
  const latestRevisionByDocRef = useRef(new Map<string, number>());
  const stateRef = useRef({
    state,
    tiptapRef,
    docs,
    activeIndex,
    locale,
    notesSortOrder,
    setDocs,
    setActiveIndex,
  });
  stateRef.current = {
    state,
    tiptapRef,
    docs,
    activeIndex,
    locale,
    notesSortOrder,
    setDocs,
    setActiveIndex,
  };

  const createSnapshot = useCallback((): SaveSnapshot | null => {
    const {
      state: latestState,
      tiptapRef: latestEditorRef,
      docs: latestDocs,
      activeIndex: latestActiveIndex,
    } = stateRef.current;

    const target = latestDocs[latestActiveIndex];
    if (!target?.filePath) return null;

    const content = getCurrentMarkdown(latestState, latestEditorRef);
    const revision = (latestRevisionByDocRef.current.get(target.id) ?? 0) + 1;
    latestRevisionByDocRef.current.set(target.id, revision);

    return {
      docId: target.id,
      filePath: target.filePath,
      content,
      revision,
    };
  }, []);

  const doSave = useCallback(async (snapshot: SaveSnapshot) => {
    const {
      locale: latestLocale,
      notesSortOrder: latestSortOrder,
      setDocs: latestSetDocs,
      setActiveIndex: latestSetActiveIndex,
    } = stateRef.current;

    try {
      markOwnWrite(snapshot.filePath);
      await writeTextFile(snapshot.filePath, snapshot.content);

      if ((latestRevisionByDocRef.current.get(snapshot.docId) ?? 0) !== snapshot.revision) {
        return;
      }

      const live = stateRef.current;
      const currentActiveId = live.docs[live.activeIndex]?.id ?? null;
      const currentMarkdown = currentActiveId === snapshot.docId
        ? getCurrentMarkdown(live.state, live.tiptapRef)
        : null;
      const activeDocStillMatches = currentActiveId === snapshot.docId
        ? currentMarkdown === snapshot.content
        : false;

      let savedDocStillExists = false;
      const nextDocs = live.docs.map((docEntry) => {
        if (docEntry.id !== snapshot.docId) return docEntry;
        savedDocStillExists = true;

        const autoTitle = docEntry.customName
          ? docEntry.fileName
          : deriveTitle(snapshot.content) || docEntry.fileName || getDefaultDocumentTitle(latestLocale, live.docs.map((d) => d.fileName));
        return {
          ...docEntry,
          content: snapshot.content,
          isDirty: currentActiveId === snapshot.docId ? !activeDocStillMatches : false,
          updatedAt: Date.now(),
          fileName: autoTitle,
        };
      });

      if (!savedDocStillExists) {
        return;
      }

      const sortedDocs = sortNotes(nextDocs, latestSortOrder);
      const nextIndex = currentActiveId
        ? Math.max(sortedDocs.findIndex((docEntry) => docEntry.id === currentActiveId), 0)
        : 0;

      latestSetDocs(sortedDocs);
      latestSetActiveIndex(nextIndex);
      void saveManifest(sortedDocs, currentActiveId).catch(() => {});

      const saved = sortedDocs.find((d) => d.id === snapshot.docId);
      if (saved) emitDocUpdated(saved.id, snapshot.content, saved.fileName);

      if (activeDocStillMatches) {
        live.state.setIsDirty(false);
        live.state.setTiptapDirty(false);
      }
    } catch (err) {
      console.warn("Auto-save failed:", err);
    }
  }, []);

  const flushAutoSave = useCallback((): Promise<void> => {
    const pendingEntries = Array.from(pendingSnapshotsRef.current.values());
    pendingSnapshotsRef.current.clear();

    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();

    if (pendingEntries.length === 0) return Promise.resolve();

    return (async () => {
      for (const snapshot of pendingEntries) {
        await doSave(snapshot);
      }
    })();
  }, [doSave]);

  const scheduleAutoSave = useCallback(() => {
    const snapshot = createSnapshot();
    if (!snapshot) return;

    pendingSnapshotsRef.current.set(snapshot.docId, snapshot);

    const existingTimer = timersRef.current.get(snapshot.docId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      timersRef.current.delete(snapshot.docId);
      const pending = pendingSnapshotsRef.current.get(snapshot.docId);
      pendingSnapshotsRef.current.delete(snapshot.docId);
      if (pending) {
        void doSave(pending);
      }
    }, DEBOUNCE_MS);

    timersRef.current.set(snapshot.docId, timer);
  }, [createSnapshot, doSave]);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      const pendingEntries = Array.from(pendingSnapshotsRef.current.values());
      pendingSnapshotsRef.current.clear();

      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();

      for (const snapshot of pendingEntries) {
        void doSave(snapshot);
      }
    };
  }, [doSave]);

  return { scheduleAutoSave, flushAutoSave };
}
