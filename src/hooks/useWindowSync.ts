import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { sortNotes, type NoteDoc, type NoteGroup, type TrashedNote } from "./useNotesLoader";
import type { TiptapEditorHandle } from "../components/TiptapEditor";
import { syncGroupsSnapshotFromDisk, getNotesDir } from "./useNotesLoader";
import type { LibrarySnapshot, LibraryUpdater } from "../utils/libraryStore";
import type { Locale, NotesSortOrder } from "./useSettings";
import type { NoteColorId } from "../utils/noteColors";

interface DocUpdatedPayload {
  sourceWindow: string;
  docId: string;
  content: string;
  updatedAt: number;
}

interface DocRenamedPayload {
  sourceWindow: string;
  docId: string;
  oldFilePath: string;
  newFilePath: string;
  newFileName: string;
}

interface DocDeletedPayload {
  sourceWindow: string;
  docId: string;
}

interface DocCreatedPayload {
  sourceWindow: string;
  doc: Omit<NoteDoc, "isDirty">;
}

interface NotePinnedUpdatedPayload {
  sourceWindow: string;
  docId: string;
  pinned: boolean;
}

interface NoteColorUpdatedPayload {
  sourceWindow: string;
  docId: string;
  color: NoteColorId | null;
}

interface GroupsUpdatedPayload {
  sourceWindow: string;
  groups: NoteGroup[];
}

interface TrashUpdatedPayload {
  sourceWindow: string;
  trashedNotes: TrashedNote[];
}

const WINDOW_LABEL = getCurrentWindow().label;

export function emitDocUpdated(docId: string, content: string, updatedAt: number) {
  emit("doc-updated", {
    sourceWindow: WINDOW_LABEL, docId, content, updatedAt,
  } satisfies DocUpdatedPayload).catch(() => {});
}

export function emitDocRenamed(docId: string, oldFilePath: string, newFilePath: string, newFileName: string) {
  emit("doc-renamed", {
    sourceWindow: WINDOW_LABEL, docId, oldFilePath, newFilePath, newFileName,
  } satisfies DocRenamedPayload).catch(() => {});
}

export function emitDocDeleted(docId: string) {
  emit("doc-deleted", {
    sourceWindow: WINDOW_LABEL, docId,
  } satisfies DocDeletedPayload).catch(() => {});
}

export function emitDocCreated(doc: NoteDoc) {
  const { isDirty: _, ...rest } = doc;
  emit("doc-created", {
    sourceWindow: WINDOW_LABEL, doc: rest,
  } satisfies DocCreatedPayload).catch(() => {});
}

export function emitNotePinnedUpdated(docId: string, pinned: boolean) {
  emit("note-pinned-updated", {
    sourceWindow: WINDOW_LABEL, docId, pinned,
  } satisfies NotePinnedUpdatedPayload).catch(() => {});
}

export function emitNoteColorUpdated(docId: string, color: NoteColorId | null) {
  emit("note-color-updated", {
    sourceWindow: WINDOW_LABEL, docId, color,
  } satisfies NoteColorUpdatedPayload).catch(() => {});
}

export function emitGroupsUpdated(groups: NoteGroup[]) {
  emit("groups-updated", {
    sourceWindow: WINDOW_LABEL, groups,
  } satisfies GroupsUpdatedPayload).catch(() => {});
}

export function emitTrashUpdated(trashedNotes: TrashedNote[]) {
  emit("trash-updated", {
    sourceWindow: WINDOW_LABEL, trashedNotes,
  } satisfies TrashUpdatedPayload).catch(() => {});
}

export function useWindowSync(
  commitRemote: (update: LibraryUpdater) => LibrarySnapshot | null,
  activeDocId: string | null,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  onActiveDocChanged?: (doc: { filePath: string; content: string }) => void,
  notesSortOrder: NotesSortOrder = "updated-desc",
  locale: Locale = "en",
  settleRemoteDeletedDoc?: (docId: string) => Promise<boolean>,
) {
  const activeDocIdRef = useRef(activeDocId);
  activeDocIdRef.current = activeDocId;
  const onActiveDocChangedRef = useRef(onActiveDocChanged);
  onActiveDocChangedRef.current = onActiveDocChanged;
  const getRoutedActiveDocId = useCallback(() => {
    const editorDocId = tiptapRef.current?.getEditor?.()?.storage.documentContext.noteId ?? null;
    return editorDocId ?? activeDocIdRef.current;
  }, [tiptapRef]);
  const showInEditor = useCallback((doc: NoteDoc) => {
    tiptapRef.current?.openDocument?.({
      noteId: doc.id,
      filePath: doc.filePath,
      markdown: doc.content,
      reason: "window-sync",
    });
    onActiveDocChangedRef.current?.({ filePath: doc.filePath, content: doc.content });
  }, [tiptapRef]);

  useEffect(() => {
    let mounted = true;
    let unlisteners: (() => void)[] = [];
    const deletingDocIds = new Set<string>();

    Promise.all([
      listen<DocUpdatedPayload>("doc-updated", (event) => {
        const { sourceWindow, docId, content, updatedAt } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;

        const committed = commitRemote((current) => {
          const idx = current.docs.findIndex((d) => d.id === docId);
          if (idx < 0) return null;
          // Mirror useFileWatcher's guard: a locally-dirty doc means the
          // user is actively editing here, so refuse to overwrite content
          // and keep the dirty flag. Last-write-wins on the disk side
          // (our own autosave) resolves conflicts, not remote events.
          if (current.docs[idx].isDirty) return null;
          const docs = [...current.docs];
          // Titles are sidecar/rename metadata. A delayed body notification
          // must not roll a newer rename back in the receiving window.
          docs[idx] = {
            ...docs[idx],
            content,
            updatedAt: Math.max(docs[idx].updatedAt, updatedAt),
            isDirty: false,
          };
          return { docs };
        });
        if (!committed || docId !== getRoutedActiveDocId()) return;
        const updated = committed.docs.find((d) => d.id === docId);
        if (updated) showInEditor(updated);
      }),

      listen<DocRenamedPayload>("doc-renamed", (event) => {
        const { sourceWindow, docId, newFilePath, newFileName } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;

        commitRemote((current) => {
          const idx = current.docs.findIndex((d) => d.id === docId);
          if (idx < 0) return null;
          const docs = [...current.docs];
          docs[idx] = { ...docs[idx], filePath: newFilePath, fileName: newFileName };
          return { docs };
        });
      }),

      listen<DocDeletedPayload>("doc-deleted", (event) => {
        const { sourceWindow, docId } = event.payload;
        if (sourceWindow === WINDOW_LABEL || deletingDocIds.has(docId)) return;
        deletingDocIds.add(docId);

        void (async () => {
          try {
            // settleRemoteDeletedDoc captures and quarantines the local body
            // synchronously before its promise reaches the first await. Remove
            // the live editor immediately afterwards so the user cannot keep
            // typing into a document whose deletion already committed.
            let settlement: Promise<boolean> | null = null;
            if (settleRemoteDeletedDoc) {
              try { settlement = settleRemoteDeletedDoc(docId); } catch { /* deletion remains authoritative */ }
            }

            // Active identity is stored by id, so removing a doc before the
            // active one needs no index shuffling; only a deleted active doc
            // hands off to its neighbour, in the same commit as the removal.
            let deletedActiveDoc = false;
            const committed = commitRemote((current) => {
              const idx = current.docs.findIndex((d) => d.id === docId);
              if (idx < 0) return null;
              const docs = current.docs.filter((d) => d.id !== docId);
              deletedActiveDoc = current.activeNoteId === docId || getRoutedActiveDocId() === docId;
              if (!deletedActiveDoc) return { docs };
              return { docs, activeNoteId: docs[Math.min(idx, docs.length - 1)]?.id ?? null };
            });
            if (committed && deletedActiveDoc && committed.activeNoteId) {
              const next = committed.docs.find((d) => d.id === committed.activeNoteId);
              if (next) showInEditor(next);
            }
            // Preservation is best-effort and is also tracked by the autosave
            // close/migration drain. The originating window already committed
            // the delete, so failure must not put the document back in state.
            if (settlement) {
              try { await settlement; } catch { /* deletion remains authoritative */ }
            }
          } finally {
            deletingDocIds.delete(docId);
          }
        })();
      }),

      listen<DocCreatedPayload>("doc-created", (event) => {
        const { sourceWindow, doc } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;

        // Deletion and creation are separate Tauri events, so the replacement
        // may arrive after the peer has already removed its last document.
        let shouldActivate = false;
        const committed = commitRemote((current) => {
          if (current.docs.some((d) => d.id === doc.id || d.filePath === doc.filePath)) return null;
          shouldActivate = current.docs.length === 0;
          const docs = [...current.docs, { ...doc, isDirty: false }];
          return shouldActivate ? { docs, activeNoteId: doc.id } : { docs };
        });
        if (committed && shouldActivate) showInEditor({ ...doc, isDirty: false });
      }),

      listen<NotePinnedUpdatedPayload>("note-pinned-updated", (event) => {
        const { sourceWindow, docId, pinned } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;

        commitRemote((current) => {
          const idx = current.docs.findIndex((d) => d.id === docId);
          if (idx < 0) return null;
          const docs = [...current.docs];
          docs[idx] = { ...docs[idx], pinned };
          return { docs: sortNotes(docs, notesSortOrder, locale) };
        });
      }),

      listen<NoteColorUpdatedPayload>("note-color-updated", (event) => {
        const { sourceWindow, docId, color } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;

        commitRemote((current) => {
          const idx = current.docs.findIndex((d) => d.id === docId);
          if (idx < 0 || current.docs[idx].color === (color ?? undefined)) return null;
          const docs = [...current.docs];
          docs[idx] = { ...docs[idx], color: color ?? undefined };
          return { docs };
        });
      }),

      listen<GroupsUpdatedPayload>("groups-updated", (event) => {
        const { sourceWindow, groups } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;
        commitRemote(() => ({ groups }));
        // Keep saveManifest's deletion-detection snapshot aligned with what
        // the other window just observed on disk; otherwise deleting a group
        // here would silently fail to emit a tombstone.
        void getNotesDir().then((dir) => syncGroupsSnapshotFromDisk(dir)).catch(() => {});
      }),

      listen<TrashUpdatedPayload>("trash-updated", (event) => {
        const { sourceWindow, trashedNotes } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;
        commitRemote(() => ({ trashedNotes }));
      }),
    ]).then((fns) => {
      if (!mounted) { fns.forEach((fn) => fn()); return; }
      unlisteners = fns;
    });

    return () => { mounted = false; unlisteners.forEach((fn) => fn()); };
  }, [commitRemote, getRoutedActiveDocId, showInEditor, notesSortOrder, locale, settleRemoteDeletedDoc]);
}
