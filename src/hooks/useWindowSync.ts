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

/**
 * A trash CHANGE, not a trash snapshot. Broadcasting the sender's whole array
 * made every receiver adopt that window's view of the trash wholesale, so a
 * concurrent trash/restore/purge in the receiving window was silently undone
 * (and an out-of-order event resurrected entries whose files were already
 * gone). Describing only what the sender moved keeps disjoint operations
 * commutative: each window applies the delta to its own list.
 */
interface TrashUpdatedPayload {
  sourceWindow: string;
  /** Entries the sender moved INTO trash. */
  added: TrashedNote[];
  /**
   * Entries the sender took OUT of trash, by restore or by permanent delete.
   * Carries `trashedAt` because the id alone names the note, not the trash
   * incarnation: the same note can be restored and trashed again, and a
   * removal that reaches a window after the newer re-trash must not delete it.
   */
  removed: TrashRemoval[];
}

export interface TrashRemoval {
  id: string;
  /** `trashedAt` of the entry the sender removed. */
  trashedAt: number;
}

const WINDOW_LABEL = getCurrentWindow().label;

// Newest body revision this window has seen on the doc-updated channel, per
// doc: our own persisted saves plus every peer body we accepted. A doc's own
// `updatedAt` cannot serve as this clock — renames and pin/color writes bump it
// without touching the body, which is exactly why applying a remote body keeps
// max(updatedAt) instead of the event's value. Without a body-specific clock,
// a doc-updated that lost the race (two peers saving the same note, or an
// event delayed behind its own disk I/O past our newer save) silently replaces
// a newer body with an older one while the timestamp keeps reading newer — and
// the next local save writes that stale body back over the newer one.
const lastBodyAtByDoc = new Map<string, number>();

/** Drops one doc's body clock. Called when the note is deleted. */
function forgetDocBodyClock(docId: string) {
  lastBodyAtByDoc.delete(docId);
}

/** Clears every body clock. Exists so tests start from a known state. */
export function resetDocBodyClocks() {
  lastBodyAtByDoc.clear();
}

export function emitDocUpdated(docId: string, content: string, updatedAt: number) {
  // Our own write is the newest body we know of, so a peer event that predates
  // it is stale even though this window skips its own broadcasts.
  noteBodyRevision(docId, updatedAt);
  emit("doc-updated", {
    sourceWindow: WINDOW_LABEL, docId, content, updatedAt,
  } satisfies DocUpdatedPayload).catch(() => {});
}

function noteBodyRevision(docId: string, updatedAt: number) {
  const seen = lastBodyAtByDoc.get(docId);
  if (seen == null || updatedAt > seen) lastBodyAtByDoc.set(docId, updatedAt);
}

/** True when this body event predates one already applied for the same doc. */
function isStaleBodyEvent(docId: string, updatedAt: number): boolean {
  const seen = lastBodyAtByDoc.get(docId);
  return seen != null && updatedAt < seen;
}

export function emitDocRenamed(docId: string, oldFilePath: string, newFilePath: string, newFileName: string) {
  emit("doc-renamed", {
    sourceWindow: WINDOW_LABEL, docId, oldFilePath, newFilePath, newFileName,
  } satisfies DocRenamedPayload).catch(() => {});
}

export function emitDocDeleted(docId: string) {
  // A restore reuses the id, so the deleted note's body clock must not outlive
  // it and reject the restored body.
  forgetDocBodyClock(docId);
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

export function emitTrashUpdated(change: { added?: TrashedNote[]; removed?: TrashRemoval[] }) {
  const added = change.added ?? [];
  const removed = change.removed ?? [];
  if (added.length === 0 && removed.length === 0) return;
  emit("trash-updated", {
    sourceWindow: WINDOW_LABEL, added, removed,
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
        // Event delivery is not ordered across source windows, and a body
        // event can arrive after this window has already saved a newer body.
        if (isStaleBodyEvent(docId, updatedAt)) return;
        // Recorded even when the commit below declines (locally dirty): the
        // body still lost to something newer, and only strictly older events
        // are dropped, so a later peer body still applies.
        noteBodyRevision(docId, updatedAt);

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
        forgetDocBodyClock(docId);

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
        const { sourceWindow, added, removed } = event.payload;
        if (sourceWindow === WINDOW_LABEL) return;

        commitRemote((current) => {
          const removedAt = new Map(removed.map((entry) => [entry.id, entry.trashedAt]));
          const incoming = new Map(added.map((note) => [note.id, note]));
          let changed = false;
          // Re-trashing an entry this window already holds keeps the newer
          // trashedAt, mirroring the local publish rule in deleteNotes.
          const kept: TrashedNote[] = [];
          for (const note of current.trashedNotes) {
            // A removal only retires the incarnation it named. A note restored
            // and trashed again is a NEWER entry, and the late removal of the
            // older one must leave it alone.
            const retiredAt = removedAt.get(note.id);
            if (retiredAt != null && note.trashedAt <= retiredAt) { changed = true; continue; }
            const update = incoming.get(note.id);
            incoming.delete(note.id);
            if (update && update.trashedAt > note.trashedAt) {
              kept.push(update);
              changed = true;
            } else {
              kept.push(note);
            }
          }
          // Entries this window has not seen trashed yet go on the end, where
          // a local trash would have put them.
          for (const note of added) {
            if (!incoming.has(note.id)) continue;
            kept.push(note);
            changed = true;
          }
          return changed ? { trashedNotes: kept } : null;
        });
      }),
    ]).then((fns) => {
      if (!mounted) { fns.forEach((fn) => fn()); return; }
      unlisteners = fns;
    });

    return () => { mounted = false; unlisteners.forEach((fn) => fn()); };
  }, [commitRemote, getRoutedActiveDocId, showInEditor, notesSortOrder, locale, settleRemoteDeletedDoc]);
}
