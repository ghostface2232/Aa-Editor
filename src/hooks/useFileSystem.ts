import { useCallback, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { mkdir, readTextFile, writeTextFile, remove, copyFile } from "@tauri-apps/plugin-fs";
import { tauriFileSystem } from "../utils/fs";
import { atomicWriteText } from "../utils/atomicWrite";
import {
  getNotesDir,
  saveManifest,
  runPersistenceTransaction,
  type PersistenceTransactionContext,
  deriveTitle,
  sortNotes,
  getFileBaseName,
  getTrashedNotesCache,
  markGroupAsDeleted,
  markNoteTitleChanged,
  markNotesPinnedChanged,
  markNotesColorChanged,
  type NoteDoc,
  type NoteGroup,
  type TrashedNote,
} from "./useNotesLoader";
import type { MarkdownState } from "./useMarkdownState";
import type { TiptapEditorHandle } from "../components/TiptapEditor";
import type { Locale, NotesSortOrder } from "./useSettings";
import { getDefaultDocumentTitle } from "../utils/documentTitle";
import { normalizeNoteTitle } from "../utils/noteText";
import { duplicateNoteAssets, removeNoteAssetDir } from "../utils/imageAssetUtils";
import { emitDocCreated, emitDocDeleted, emitDocRenamed, emitGroupsUpdated, emitNoteColorUpdated, emitNotePinnedUpdated, emitTrashUpdated } from "./useWindowSync";
import type { NoteColorId } from "../utils/noteColors";
import { markOwnWrite } from "./ownWriteTracker";
import { setKnownDiskContent } from "../utils/conflictBackup";
import { removeMeta as removeMetaFile, type NoteMeta } from "../utils/metadataIO";
import { logNotenError } from "../utils/crashLog";
import { NotenError } from "../utils/notenError";
import { t } from "../i18n";
import { libraryStore, type LibrarySnapshot, type LibraryUpdater } from "../utils/libraryStore";
import { blockNoteLifecycle } from "./noteLifecycleGate";

export type { NoteDoc } from "./useNotesLoader";

const MD_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }];

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || "untitled.md";
}

function escapeRegexForRename(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A sidecar that exists but cannot be read or parsed (cloud placeholder, AV
// lock, truncated peer write) must not block a lifecycle transition; the
// transition rebuilds it from canonical state, as the pre-transaction code
// did. `unreadable` lets a rollback repair such a sidecar from canonical
// state instead of removing it as if it had never existed.
async function readPreviousMeta(
  context: Pick<PersistenceTransactionContext, "readNoteMeta" | "assertCurrent">,
  noteId: string,
  stage: string,
): Promise<{ meta: NoteMeta | null; unreadable: boolean }> {
  try {
    return { meta: await context.readNoteMeta(noteId), unreadable: false };
  } catch (error) {
    // A generation change surfaces as a throw too; let that one propagate.
    context.assertCurrent();
    void logNotenError(new NotenError(
      "META_READ_FAILED",
      "recoverable",
      error instanceof Error ? error.message : String(error),
      { context: { stage, noteId }, cause: error },
    ));
    return { meta: null, unreadable: true };
  }
}

function sortAndPersistDocs(
  nextDocs: NoteDoc[],
  activeId: string | null,
  notesSortOrder: NotesSortOrder,
  locale: Locale,
  setDocs: React.Dispatch<React.SetStateAction<NoteDoc[]>>,
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>,
  groups?: NoteGroup[],
) {
  const sortedDocs = sortNotes(nextDocs, notesSortOrder, locale);
  const nextActiveIndex = activeId
    ? Math.max(sortedDocs.findIndex((doc) => doc.id === activeId), 0)
    : 0;

  setDocs(sortedDocs);
  setActiveIndex(nextActiveIndex);
  // Ordering + PERSIST_FAILED logging are handled inside saveManifest's
  // own persistChain; callers just enqueue and stay non-blocking. The source
  // tag travels through to the crashLog so the failure is still traceable
  // to this entry point.
  void saveManifest(sortedDocs, activeId, groups, "sortAndPersistDocs").catch(() => {});
}

export interface RenameNoteResult {
  renamed: boolean;
  /**
   * The title being replaced was shared by more than one note, so `[[Old]]`
   * links were left alone — they cannot be attributed to a single target.
   */
  linkRewriteSkipped: boolean;
}

export function getCurrentMarkdown(
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
): string {
  const editor = tiptapRef.current?.getEditor();
  return editor ? editor.getMarkdown() : "";
}

// Standard "create a new note file" recipe (notes-dir resolve, mkdir,
// markOwnWrite, writeTextFile) with the SAVE_FAILED logging that every caller
// repeated. Returns the would-be filePath and whether the write landed, so a
// caller can either abort on `!ok` or commit a dirty doc pointing at the path.
export async function provisionNoteFile(
  id: string,
  content: string,
  stage: string,
  extraContext: Record<string, unknown> = {},
  targetDir?: string,
): Promise<{ filePath: string; ok: boolean }> {
  let filePath = "";
  try {
    const notesDir = targetDir ?? await getNotesDir();
    await mkdir(notesDir, { recursive: true }).catch(() => {});
    filePath = `${notesDir}/${id}.md`;
    markOwnWrite(filePath, content);
    await atomicWriteText(tauriFileSystem, filePath, content, { failClosed: true });
    return { filePath, ok: true };
  } catch (error) {
    void logNotenError(new NotenError(
      "SAVE_FAILED",
      "fatal",
      error instanceof Error ? error.message : String(error),
      {
        context: { stage, noteId: id, filePath, ...extraContext },
        cause: error,
      },
    ));
    return { filePath, ok: false };
  }
}

// Same SAVE_FAILED contract for writes to an existing note file (rename
// rewrites). Returns whether the write landed so callers can gate the
// in-memory commit on disk success.
async function rewriteNoteFile(
  filePath: string,
  content: string,
  stage: string,
  noteId: string,
): Promise<boolean> {
  try {
    markOwnWrite(filePath, content);
    await atomicWriteText(tauriFileSystem, filePath, content, { failClosed: true });
    // Keep the conflict-backup baseline in sync, or the next autosave of this
    // doc would treat our own rewrite as an unseen remote write and back it
    // up to .conflicts.
    setKnownDiskContent(filePath, content);
    return true;
  } catch (error) {
    void logNotenError(new NotenError(
      "SAVE_FAILED",
      "fatal",
      error instanceof Error ? error.message : String(error),
      {
        context: { stage, noteId, filePath },
        cause: error,
      },
    ));
    return false;
  }
}

function resetDocState(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  docId: string | null,
  filePath: string | null,
  content: string,
  reason: "init" | "switch" | "window-sync" | "file-watch" = "switch",
) {
  tiptapRef.current?.openDocument({
    noteId: docId,
    filePath,
    markdown: content,
    reason,
  });
  state.primeMarkdown(content);
  state.setFilePath(filePath);
  state.setIsDirty(false);
}

function focusEditor(tiptapRef: React.RefObject<TiptapEditorHandle | null>) {
  tiptapRef.current?.focus?.();
}

export interface FileSystemActions {
  importFile: () => Promise<void>;
  importFiles: (paths: string[]) => Promise<void>;
  saveFile: () => Promise<void>;
  saveFileAs: () => Promise<void>;
  newNote: () => Promise<void>;
  createNoteWithTitle: (title: string) => Promise<string | null>;
  switchDocument: (index: number) => Promise<void>;
  /** Both return the ids actually moved to .trash, so callers can offer undo. */
  deleteNote: (index: number) => Promise<string[]>;
  deleteNotes: (noteIds: string[]) => Promise<string[]>;
  duplicateNote: (index: number) => Promise<void>;
  exportNote: (index: number) => Promise<void>;
  /** Resolves with whether wiki-link rewriting was skipped, so the caller can say so. */
  renameNote: (index: number, newName: string) => Promise<RenameNoteResult>;
  toggleNotePinned: (index: number) => void;
  setNotesPinned: (noteIds: string[], pinned: boolean) => void;
  setNoteColor: (index: number, color: NoteColorId | null) => void;
  setNotesColor: (noteIds: string[], color: NoteColorId | null) => void;
  restoreNote: (trashedNoteId: string) => Promise<void>;
  permanentlyDeleteNote: (trashedNoteId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

export function useFileSystem(
  state: MarkdownState,
  tiptapRef: React.RefObject<TiptapEditorHandle | null>,
  docs: NoteDoc[],
  setDocs: React.Dispatch<React.SetStateAction<NoteDoc[]>>,
  activeIndex: number,
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>,
  locale: Locale,
  notesSortOrder: NotesSortOrder,
  groups?: NoteGroup[],
  setGroups?: React.Dispatch<React.SetStateAction<NoteGroup[]>>,
  _getGroupForNote?: (noteId: string) => NoteGroup | null,
  trashedNotes?: TrashedNote[],
  setTrashedNotes?: (updater: TrashedNote[] | ((prev: TrashedNote[]) => TrashedNote[])) => void,
  flushAutoSaveRef?: React.RefObject<(() => Promise<boolean>) | null>,
  notifyActiveDocRef?: React.RefObject<((id: string, filePath: string) => void) | null>,
  cancelDocSaveRef?: React.RefObject<((docId: string) => void) | null>,
  captureAndQueueSaveRef?: React.RefObject<(() => void) | null>,
  flushDocSaveRef?: React.RefObject<((docId: string) => Promise<boolean>) | null>,
  commitLibraryForGeneration?: (
    directoryGeneration: number,
    update: LibraryUpdater,
  ) => LibrarySnapshot | null,
): FileSystemActions {
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const trashedNotesRef = useRef(trashedNotes);
  trashedNotesRef.current = trashedNotes;
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const newNoteInFlightRef = useRef(false);

  const leaveCurrentDoc = useCallback(async () => {
    if (!flushAutoSaveRef?.current) return !state.isDirty;
    return flushAutoSaveRef.current();
  }, [flushAutoSaveRef, state.isDirty]);

  const getLiveDocsSnapshot = useCallback((baseDocs: NoteDoc[] = docsRef.current) => {
    const currentActiveIndex = activeIndexRef.current;
    const activeDoc = baseDocs[currentActiveIndex];
    if (!activeDoc) {
      return { docs: baseDocs, activeDocId: null as string | null, activeIndex: currentActiveIndex };
    }

    // Avoid parse/serialize churn from stamping updatedAt on clean documents.
    if (!state.isDirty) {
      return { docs: baseDocs, activeDocId: activeDoc.id, activeIndex: currentActiveIndex };
    }

    const content = getCurrentMarkdown(tiptapRef);
    const fileName = activeDoc.customName
      ? activeDoc.fileName
      : deriveTitle(content) || activeDoc.fileName || getDefaultDocumentTitle(locale, baseDocs.map((doc) => doc.fileName));
    const contentChanged = activeDoc.content !== content;
    const titleChanged = activeDoc.fileName !== fileName;

    if (!contentChanged && !titleChanged) {
      return { docs: baseDocs, activeDocId: activeDoc.id, activeIndex: currentActiveIndex };
    }

    const nextDocs = [...baseDocs];
    nextDocs[currentActiveIndex] = {
      ...activeDoc,
      content,
      fileName,
      updatedAt: Date.now(),
      isDirty: state.isDirty,
    };

    return { docs: nextDocs, activeDocId: activeDoc.id, activeIndex: currentActiveIndex };
  }, [locale, state, tiptapRef]);

  const markDocClean = useCallback((baseDocs: NoteDoc[], docId: string | null) => {
    if (!docId) return baseDocs;
    return baseDocs.map((doc) => (
      doc.id === docId
        ? { ...doc, isDirty: false }
        : doc
    ));
  }, []);

  const pruneEmptyCurrentDoc = useCallback(async (baseDocs: NoteDoc[], leavingDocId: string | null, preserveGroupId: string | null = null): Promise<{ docs: NoteDoc[]; groups: NoteGroup[] }> => {
    const currentGroups = groupsRef.current ?? [];
    if (!leavingDocId) return { docs: baseDocs, groups: currentGroups };
    const leaving = baseDocs.find((d) => d.id === leavingDocId);
    if (!leaving) return { docs: baseDocs, groups: currentGroups };
    const currentContent = leaving.content.trim();
    // The docs list can lag the live editor: autosave just committed (isDirty
    // false) but the user typed once more before triggering the switch. Every
    // caller passes the doc the editor is still showing at this point, so
    // consult the editor directly — pruning on the stale list alone would
    // remove the file while a queued background save for it exists, and the
    // cancelDocSave below would then drop that save, losing the input.
    const liveContent = getCurrentMarkdown(tiptapRef).trim();
    if (currentContent || liveContent || leaving.customName || baseDocs.length <= 1) {
      return { docs: baseDocs, groups: currentGroups };
    }

    // Order matters: remove the .md BEFORE the .meta. The reverse order
    // (meta gone, body still present) is the dangerous one — the watcher's
    // reconcileFolder treats a body without a sidecar as an unmanaged file
    // and re-ingests it as a fresh doc with groupId: null, which surfaces as
    // "the deleted note reappeared outside its group". Awaiting both also
    // serializes them against the upcoming saveManifest's readAllMeta, which
    // was racing the fire-and-forget removeMeta and surfacing as
    // PERSIST_FAILED / RECONCILE_FAILED "os error 2" on .meta/<id>.json.
    if (leaving.filePath) {
      try { markOwnWrite(leaving.filePath); await remove(leaving.filePath); } catch { /* already gone or locked; reconcile recovers */ }
    }
    const leavingId = leaving.id;
    try {
      const dir = await getNotesDir();
      await removeMetaFile(tauriFileSystem, dir, leavingId);
    } catch { /* ignore — already gone or unreachable */ }

    // Compute the pruned groups SYNCHRONOUSLY from the current ref and hand them
    // back to the caller, rather than mutating via a setGroups(prev => ...)
    // updater. The updater form defers markGroupAsDeleted to the next render, so
    // a caller that persists groupsRef.current before that render passes a
    // pre-delete array in which the emptied group still looks alive; persist
    // then reads that as a resurrection of the just-tombstoned group and cancels
    // the tombstone, so deletedAt is never written and the group reappears on
    // reload/sync. Returning the post-prune array keeps every caller's
    // saveManifest consistent with the tombstone we record here. Mirrors
    // newNote.willReplace, which already computes groups synchronously.
    const stripped = currentGroups.map((g) =>
      g.noteIds.includes(leavingId)
        ? { ...g, noteIds: g.noteIds.filter((id) => id !== leavingId) }
        : g,
    );
    // Keep preserveGroupId alive even when it empties: a caller that is about to
    // add notes to the inherited group (importFiles) must not have it filtered
    // out or tombstoned mid-flow — mirrors newNote.willReplace.
    const keptGroups = stripped.filter((g) => g.noteIds.length > 0 || g.id === preserveGroupId);
    const groupsChanged = keptGroups.length !== currentGroups.length
      || stripped.some((g, i) => g !== currentGroups[i]);
    if (groupsChanged) {
      const keptIds = new Set(keptGroups.map((g) => g.id));
      for (const g of stripped) if (!keptIds.has(g.id)) markGroupAsDeleted(g.id);
      setGroups?.(keptGroups);
    }

    cancelDocSaveRef?.current?.(leavingId);
    tiptapRef.current?.invalidateDocumentSession?.(leavingId, leaving.filePath);

    const pruned = baseDocs.filter((d) => d.id !== leavingDocId);
    setDocs(pruned);
    return { docs: pruned, groups: groupsChanged ? keptGroups : currentGroups };
  }, [cancelDocSaveRef, setDocs, setGroups, tiptapRef]);

  const saveFile = useCallback(async () => {
    const doc = docs[activeIndex];
    if (!doc) return;

    const markdown = getCurrentMarkdown(tiptapRef);

    let targetPath = doc.filePath;
    if (!targetPath) {
      const selected = await save({ title: t("dialog.save", locale), filters: MD_FILTERS, defaultPath: `${doc.fileName}.md` });
      if (!selected) return;
      targetPath = selected;
    }

    markOwnWrite(targetPath, markdown);
    try {
      await atomicWriteText(tauriFileSystem, targetPath, markdown, { failClosed: true });
    } catch (error) {
      // Fail-closed: the body could not be written atomically. Leave the doc
      // dirty (do NOT mark clean below) so the change is not silently lost.
      void logNotenError(new NotenError(
        "SAVE_FAILED",
        "fatal",
        error instanceof Error ? error.message : String(error),
        { context: { stage: "saveFile", noteId: doc.id, filePath: targetPath }, cause: error },
      ));
      return;
    }

    const nextDocs = docs.map((entry, index) => {
      if (index !== activeIndex) return entry;

      const title = entry.customName
        ? entry.fileName
        : deriveTitle(markdown) || entry.fileName || getDefaultDocumentTitle(locale);
      return {
        ...entry,
        filePath: targetPath,
        content: markdown,
        isDirty: false,
        updatedAt: Date.now(),
        fileName: title,
      };
    });

    markNoteTitleChanged(doc.id);
    sortAndPersistDocs(nextDocs, doc.id, notesSortOrder, locale, setDocs, setActiveIndex, groupsRef.current);
    state.setIsDirty(false);
    state.primeMarkdown(markdown);
  }, [activeIndex, docs, locale, notesSortOrder, setActiveIndex, setDocs, state, tiptapRef]);

  const saveFileAs = useCallback(async () => {
    const markdown = getCurrentMarkdown(tiptapRef);
    const doc = docs[activeIndex];
    const defaultName = doc?.filePath ? getFileName(doc.filePath) : "untitled.md";
    const selected = await save({ title: t("dialog.export", locale), filters: MD_FILTERS, defaultPath: defaultName });
    if (!selected) return;
    markOwnWrite(selected, markdown);
    await writeTextFile(selected, markdown);
  }, [activeIndex, docs, locale, tiptapRef]);

  const importFiles = useCallback(async (paths: string[]) => {
    const sourcePaths = paths.filter(Boolean);
    if (sourcePaths.length === 0) return;

    const { docs: liveDocs, activeDocId } = getLiveDocsSnapshot();
    const didPersistCurrentDoc = await leaveCurrentDoc();
    const baseDocs = didPersistCurrentDoc ? markDocClean(liveDocs, activeDocId) : liveDocs;

    const existingNames = new Set(baseDocs.map((d) => d.fileName));
    const importedDocs: NoteDoc[] = [];

    for (const sourcePath of sourcePaths) {
      let content: string;
      try {
        content = await readTextFile(sourcePath);
      } catch (error) {
        // A transient read failure on a single source file must not abort
        // the whole batch: any files already written above would then be on
        // disk without a manifest entry until next reload reconciles. Log,
        // skip this file, keep importing the rest.
        void logNotenError(new NotenError(
          "BODY_READ_FAILED",
          "recoverable",
          error instanceof Error ? error.message : String(error),
          {
            context: { stage: "importFiles", sourcePath },
            cause: error,
          },
        ));
        continue;
      }
      const rawName = getFileName(sourcePath).replace(/\.(md|markdown|mdx|txt)$/i, "");
      const baseName = rawName || "Imported";

      let finalName = baseName;
      if (existingNames.has(finalName)) {
        let counter = 1;
        while (existingNames.has(`${baseName} (${counter})`)) counter++;
        finalName = `${baseName} (${counter})`;
      }

      const id = crypto.randomUUID();
      const timestamp = Date.now();

      // Skip rather than pushing a ghost doc that points at a nonexistent
      // file. The source file is still on disk so the user can retry.
      const { filePath, ok } = await provisionNoteFile(id, content, "importFiles", { sourcePath, finalName });
      if (!ok) continue;

      existingNames.add(finalName);
      importedDocs.push({
        id,
        filePath,
        fileName: finalName,
        isDirty: false,
        content,
        customName: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    if (importedDocs.length === 0) return;

    const lastImported = importedDocs[importedDocs.length - 1];
    const importedIds = importedDocs.map((d) => d.id);

    // Inherit the active document's group so an import lands in the group the
    // user is currently viewing, mirroring newNote's group-inheritance.
    const inheritedGroupId = activeDocId
      ? (groupsRef.current?.find((g) => g.noteIds.includes(activeDocId))?.id ?? null)
      : null;

    // Pass inheritedGroupId so the prune keeps that group alive even if the
    // active doc was its only (empty placeholder) member — the imports below
    // are about to join it.
    const { docs: prunedDocs, groups: prunedGroups } = await pruneEmptyCurrentDoc(baseDocs, activeDocId, inheritedGroupId);
    const nextDocs = [...prunedDocs, ...importedDocs];

    // Build the persisted groups on the post-prune array pruneEmptyCurrentDoc
    // returned (activeDoc already stripped, inheritedGroupId preserved) so the
    // imports' new membership and any prune tombstone stay consistent.
    let nextGroups = prunedGroups;
    if (inheritedGroupId && prunedGroups.some((g) => g.id === inheritedGroupId)) {
      nextGroups = prunedGroups.map((g) =>
        g.id === inheritedGroupId
          ? { ...g, noteIds: [...g.noteIds, ...importedIds.filter((nid) => !g.noteIds.includes(nid))] }
          : g,
      );
      setGroups?.(nextGroups);
      emitGroupsUpdated(nextGroups);
    }

    sortAndPersistDocs(nextDocs, lastImported.id, notesSortOrder, locale, setDocs, setActiveIndex, nextGroups);
    importedDocs.forEach((doc) => emitDocCreated(doc));

    resetDocState(state, tiptapRef, lastImported.id, lastImported.filePath, lastImported.content);
    notifyActiveDocRef?.current?.(lastImported.id, lastImported.filePath);
  }, [getLiveDocsSnapshot, leaveCurrentDoc, markDocClean, notesSortOrder, setActiveIndex, setDocs, setGroups, state, tiptapRef, pruneEmptyCurrentDoc]);

  const importFile = useCallback(async () => {
    const selected = await open({ filters: MD_FILTERS, multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    await importFiles(paths as string[]);
  }, [importFiles]);

  const newNote = useCallback(async () => {
    if (newNoteInFlightRef.current) return;
    newNoteInFlightRef.current = true;
    try {
      // Click-handler sync portion MUST stay minimal — Chrome's "click handler
      // took Xms" violation measures everything until the first macrotask
      // yield, and editor.getMarkdown() can be 100–150ms on docs with custom
      // NodeViews (Mermaid, WikiLink, ImageView). So:
      //   - skip getLiveDocsSnapshot here (it calls getMarkdown when isDirty)
      //   - defer captureAndQueueSave to after the first await (the snapshot
      //     it captures is still correct as long as resetDocState hasn't run)
      //   - read baseDocs/groups straight from refs
      const baseDocs = docsRef.current;
      const currentActiveIndex = activeIndexRef.current;
      const currentDoc = baseDocs[currentActiveIndex] ?? null;
      const activeDocId = currentDoc?.id ?? null;

      // willReplace check: only consult the editor when the stored content is
      // empty AND state is dirty (i.e. user may have typed since last
      // autosave). Otherwise the stored .content already tells us non-empty,
      // and we can skip the serialization.
      let willReplace = false;
      if (currentDoc && !currentDoc.customName && currentDoc.content.trim() === "") {
        const liveContent = state.isDirty ? getCurrentMarkdown(tiptapRef).trim() : "";
        willReplace = liveContent === "";
      }

      const id = crypto.randomUUID();
      const timestamp = Date.now();
      // Provision the new file BEFORE any destructive state changes — first
      // await of the function, also the macrotask yield that closes the click
      // handler's sync portion. If the write fails the previous doc is left
      // untouched.
      const { filePath, ok } = await provisionNoteFile(id, "", "newNote");
      if (!ok) return;

      // captureAndQueueSave runs AFTER provisionNoteFile so its getMarkdown
      // call lands in a continuation microtask instead of the click handler's
      // sync portion. The editor still points at the leaving doc here
      // (resetDocState below hasn't run yet), so the snapshot captures the
      // right content. willReplace skips this entirely — the leaving body is
      // empty and is about to be deleted.
      if (!willReplace) {
        if (captureAndQueueSaveRef?.current) {
          captureAndQueueSaveRef.current();
        } else {
          // Fallback for environments where the ref wasn't wired (tests).
          await leaveCurrentDoc();
        }
      } else if (currentDoc) {
        cancelDocSaveRef?.current?.(currentDoc.id);
      }

      const inheritedGroupId = activeDocId
        ? (groupsRef.current?.find((g) => g.noteIds.includes(activeDocId))?.id ?? null)
        : null;

      let prunedDocs = baseDocs;
      let workingGroups: NoteGroup[] | undefined = groupsRef.current;
      if (willReplace && currentDoc) {
        const leavingId = currentDoc.id;
        const beforePrune = workingGroups
          ?.map((g) => ({ ...g, noteIds: g.noteIds.filter((noteId) => noteId !== leavingId) }));
        workingGroups = beforePrune
          ?.filter((g) => g.id === inheritedGroupId || g.noteIds.length > 0);
        if (beforePrune && workingGroups && beforePrune.length !== workingGroups.length) {
          const keptIds = new Set(workingGroups.map((g) => g.id));
          for (const g of beforePrune) if (!keptIds.has(g.id)) markGroupAsDeleted(g.id);
        }
        prunedDocs = baseDocs.filter((d) => d.id !== currentDoc.id);
      }

      const newDoc: NoteDoc = {
        id,
        filePath,
        fileName: getDefaultDocumentTitle(locale, prunedDocs.map((d) => d.fileName)),
        isDirty: false,
        content: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const nextDocs = [...prunedDocs, newDoc];
      let nextGroups = workingGroups;
      if (inheritedGroupId && nextGroups) {
        const targetExists = nextGroups.some((g) => g.id === inheritedGroupId);
        if (targetExists) {
          nextGroups = nextGroups.map((g) =>
            g.id === inheritedGroupId && !g.noteIds.includes(id)
              ? { ...g, noteIds: [...g.noteIds, id] }
              : g,
          );
        }
      }
      // Commit groups in ONE setGroups so willReplace's prune and the new
      // doc's add land in the same React commit (previously two separate
      // setGroups calls produced a brief "no group" frame mid-flow).
      if (nextGroups !== groupsRef.current) {
        setGroups?.(nextGroups ?? []);
        emitGroupsUpdated(nextGroups ?? []);
      }
      sortAndPersistDocs(nextDocs, newDoc.id, notesSortOrder, locale, setDocs, setActiveIndex, nextGroups);
      emitDocCreated(newDoc);
      resetDocState(state, tiptapRef, id, filePath, "");
      notifyActiveDocRef?.current?.(id, filePath);
      focusEditor(tiptapRef);

      // willReplace disk cleanup runs AFTER state commits, fire-and-forget.
      // Safe to not await because:
      //   - readAllMeta is TOCTOU-tolerant (metadataIO.ts), so a saveManifest
      //     racing this removeMeta no longer surfaces PERSIST_FAILED
      //   - hydrateGroupMembershipFromMeta preserves in-memory grouping for
      //     live docs without on-disk meta, so a watcher reconcile firing
      //     mid-cleanup can't yank the new doc out of its group
      //   - .md is removed before .meta, so the bodyless-meta path in
      //     reconcileFolder (with its 2-pass grace) absorbs any orphan
      // Cancellation of the leaving doc's autosave already happened above.
      if (willReplace && currentDoc?.filePath) {
        const leavingFilePath = currentDoc.filePath;
        const leavingId = currentDoc.id;
        void (async () => {
          try { markOwnWrite(leavingFilePath); await remove(leavingFilePath); } catch { /* already gone or locked; reconcile recovers */ }
          try {
            const dir = await getNotesDir();
            await removeMetaFile(tauriFileSystem, dir, leavingId);
          } catch { /* ignore — already gone or unreachable */ }
        })();
      }
    } finally {
      newNoteInFlightRef.current = false;
    }
  }, [cancelDocSaveRef, captureAndQueueSaveRef, leaveCurrentDoc, locale, notesSortOrder, setActiveIndex, setDocs, setGroups, state, tiptapRef]);

  // Wiki-link creation path: provision a titled note without switching focus.
  const createNoteWithTitle = useCallback(async (rawTitle: string): Promise<string | null> => {
    const title = rawTitle.trim();
    if (!title) return null;

    const existing = docsRef.current.find(
      (doc) => doc.fileName.normalize("NFC").toLowerCase() === title.normalize("NFC").toLowerCase(),
    );
    if (existing) return existing.id;

    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const { filePath, ok } = await provisionNoteFile(id, "", "createNoteWithTitle", { title });
    if (!ok) return null;

    const newDoc: NoteDoc = {
      id,
      filePath,
      fileName: title,
      isDirty: false,
      content: "",
      customName: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const { docs: liveDocs, activeDocId } = getLiveDocsSnapshot();
    const nextDocs = [...liveDocs, newDoc];
    sortAndPersistDocs(
      nextDocs,
      activeDocId,
      notesSortOrder,
      locale,
      setDocs,
      setActiveIndex,
      groupsRef.current,
    );
    emitDocCreated(newDoc);
    return id;
  }, [getLiveDocsSnapshot, locale, notesSortOrder, setActiveIndex, setDocs]);

  const switchDocument = useCallback(async (index: number) => {
    const { docs: liveDocs, activeDocId, activeIndex: currentActiveIndex } = getLiveDocsSnapshot();
    if (index === currentActiveIndex) return;
    if (index < 0 || index >= liveDocs.length) return;

    // Fast path: the leaving doc is non-empty (or pinned by customName), so
    // pruneEmptyCurrentDoc below will not race the autosave. Fire the save
    // synchronously (snapshot is captured in-band, doSave runs in background)
    // and switch immediately. doSave gates each write on the live docs list
    // and activeDocRef, so writing after the switch still hits the correct
    // path; window close awaits in-flight saves via flushAutoSave.
    //
    // Slow path: the leaving doc is empty + auto-titled. pruneEmptyCurrentDoc
    // will remove its file, so we must serialize the save BEFORE the prune to
    // avoid a "save resurrects a deleted file" race.
    //
    // Emptiness MUST be checked against the live editor — leaving.content in
    // liveDocs can lag the editor when state.isDirty is false (autosave just
    // committed) but the user has typed one more char before clicking. Trusting
    // the stale liveDocs would mis-route to the fast path, queue a background
    // save with the real (non-empty) content, and pruneEmptyCurrentDoc would
    // simultaneously delete the file — a guaranteed race.
    const leavingDoc = liveDocs[currentActiveIndex];
    const leavingHasContent = !!leavingDoc
      && (
        leavingDoc.content.trim() !== ""
        || getCurrentMarkdown(tiptapRef).trim() !== ""
      );
    const isPruneCandidate = !!leavingDoc
      && !leavingHasContent
      && !leavingDoc.customName
      && liveDocs.length > 1;

    // Slow path absorbs both (a) prune candidates that need save-before-delete
    // serialization and (b) the defensive case where the capture ref hasn't
    // been wired yet (shouldn't happen in App.tsx — the ref is assigned every
    // render — but the optional chain keeps this resilient to future refactors).
    let baseDocs: NoteDoc[];
    if (isPruneCandidate || !captureAndQueueSaveRef?.current) {
      const didPersistCurrentDoc = await leaveCurrentDoc();
      baseDocs = didPersistCurrentDoc ? markDocClean(liveDocs, activeDocId) : liveDocs;
    } else {
      captureAndQueueSaveRef.current();
      baseDocs = liveDocs;
    }

    const targetDoc = baseDocs[index];
    const { docs: nextDocs, groups: nextGroups } = await pruneEmptyCurrentDoc(baseDocs, activeDocId);
    let targetIndex = nextDocs.findIndex((d) => d.id === targetDoc.id);
    if (targetIndex < 0) targetIndex = 0;

    const target = nextDocs[targetIndex];
    setDocs(nextDocs);
    resetDocState(state, tiptapRef, target.id, target.filePath, target.content);
    notifyActiveDocRef?.current?.(target.id, target.filePath);
    setActiveIndex(targetIndex);
    // Persist the post-prune groups the pruner returned, not groupsRef.current:
    // the ref still holds the pre-delete array until the next render, which
    // would cancel the freshly recorded tombstone (P2 follow-up to P0-4).
    void saveManifest(nextDocs, target.id, nextGroups).catch(() => {});
  }, [captureAndQueueSaveRef, getLiveDocsSnapshot, leaveCurrentDoc, markDocClean, setActiveIndex, setDocs, state, tiptapRef, pruneEmptyCurrentDoc]);

  // Batch delete core. The per-note trash I/O runs sequentially, but the doc
  // list / groups / trash list / active-doc handoff commit exactly ONCE at the
  // end. Firing N independent deleteNote calls without awaiting (the old bulk
  // path) let every call snapshot the same stale docs array in the same
  // microtask; last-writer-wins setDocs then resurrected N-1 ghost rows whose
  // files were already in .trash.
  //
  // Returns the ids that actually landed in the trash, so the caller can offer
  // an undo. Notes whose autosave flush or trash copy failed are skipped (not
  // deleted) rather than aborting the rest of the batch.
  const deleteNotes = useCallback(async (noteIds: string[]): Promise<string[]> => {
    const requested: NoteDoc[] = [];
    const seen = new Set<string>();
    for (const id of noteIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const doc = docsRef.current.find((d) => d.id === id);
      if (doc) requested.push(doc);
    }
    if (requested.length === 0) return [];

    // Flush in-flight saves first; a failed flush means the on-disk body may
    // be stale, so trashing it would lose the unsaved edits.
    const flushed: NoteDoc[] = [];
    for (const doc of requested) {
      const didFlush = await flushDocSaveRef?.current?.(doc.id);
      if (didFlush === false) continue;
      flushed.push(doc);
    }
    if (flushed.length === 0) return [];

    const { docs: liveDocs } = getLiveDocsSnapshot();
    let targetIds = flushed
      .map((d) => d.id)
      .filter((id) => liveDocs.some((entry) => entry.id === id));
    if (targetIds.length === 0 || !commitLibraryForGeneration) return [];

    // The active note can change while a cloud-backed flush is awaiting I/O.
    // Re-check until the same active identity survives an awaited capture.
    while (true) {
      const beforeActiveId = docsRef.current[activeIndexRef.current]?.id ?? null;
      if (beforeActiveId && targetIds.includes(beforeActiveId)) {
        if (!(await leaveCurrentDoc())) {
          targetIds = targetIds.filter((id) => id !== beforeActiveId);
        }
      }
      const afterActiveId = docsRef.current[activeIndexRef.current]?.id ?? null;
      if (afterActiveId === beforeActiveId) break;
    }
    if (targetIds.length === 0) return [];

    const blockedTargetIds = [...targetIds];
    const releaseLifecycleBlock = blockNoteLifecycle(blockedTargetIds);
    const committedDeletedIds = new Set<string>();
    try {
      // Await any body write that passed the gate before quarantine. A target
      // with newer blocked work is kept live and retried after the gate lifts.
      const safelyDrained: string[] = [];
      for (const id of targetIds) {
        const didDrain = await flushDocSaveRef?.current?.(id);
        if (didDrain !== false) safelyDrained.push(id);
      }
      targetIds = safelyDrained;
      if (targetIds.length === 0) return [];
      for (const id of targetIds) cancelDocSaveRef?.current?.(id);

      const published: {
        snapshot: LibrarySnapshot | null;
        activeBeforePublish: string | null;
      } = { snapshot: null, activeBeforePublish: null };
      const transaction = await runPersistenceTransaction(
        "deleteNotes",
        targetIds,
        async ({
          notesDirectory,
          snapshot,
          assertCurrent,
          readNoteMeta,
          mergeNoteMeta,
          writeNoteMeta,
          removeNoteMeta,
          finalizeNoteMeta,
          discardNoteIntents,
        }) => {
        const requestedIds = new Set(targetIds);
        const targets = snapshot.docs.filter((doc) => requestedIds.has(doc.id));
        const moved: TrashedNote[] = [];
        const deletedIds = new Set<string>();
        const trashDir = `${notesDirectory}/.trash`;
        assertCurrent();
        await mkdir(trashDir, { recursive: true });
        assertCurrent();

        for (const doc of targets) {
          if (!doc.filePath) {
            try {
              await removeNoteMeta(doc.id);
              discardNoteIntents(doc.id);
              deletedIds.add(doc.id);
            } catch { /* keep the pathless note when metadata removal fails */ }
            continue;
          }

          const groupId = snapshot.groups.find((group) => group.noteIds.includes(doc.id))?.id ?? null;
          const trashPath = `${trashDir}/${getFileBaseName(doc.filePath)}`;
          const trashedAt = Date.now();
          try {
            const { meta: previousMeta, unreadable: previousMetaUnreadable } = await readPreviousMeta(
              { readNoteMeta, assertCurrent },
              doc.id,
              "deleteNotes",
            );
            const mergedMeta = mergeNoteMeta(doc.id, {
              version: 2,
              id: doc.id,
              fileName: doc.fileName,
              customName: doc.customName,
              createdAt: doc.createdAt,
              updatedAt: doc.updatedAt,
              groupId,
              groupUpdatedAt: doc.updatedAt,
              pinned: doc.pinned === true,
              color: doc.color,
              trashedAt: null,
            }, previousMeta);
            const trashedMeta: NoteMeta = {
              ...mergedMeta,
              trashedAt,
              trashedFromPath: doc.filePath,
            };
            await writeNoteMeta(trashedMeta);

            markOwnWrite(doc.filePath);
            assertCurrent();
            let bodyCopied = false;
            try {
              await copyFile(doc.filePath, trashPath);
              assertCurrent();
              bodyCopied = true;
            } catch (copyError) {
              let rolledBack = false;
              try {
                // A peer may have trashed this note itself meanwhile (its
                // trash-updated already landed here); rewriting the live
                // sidecar would resurrect a note it just deleted.
                const peerTrashed = libraryStore.getSnapshot().trashedNotes.some((note) => note.id === doc.id);
                if (peerTrashed) { /* keep the tombstone; deletion wins */ }
                else if (previousMeta) await writeNoteMeta(previousMeta);
                else if (previousMetaUnreadable) await writeNoteMeta(mergedMeta);
                else await removeNoteMeta(doc.id);
                rolledBack = !peerTrashed;
              } catch (rollbackError) {
                void logNotenError(new NotenError(
                  "PERSIST_FAILED",
                  "fatal",
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                  { context: { stage: "deleteNotes.rollback", noteId: doc.id }, cause: rollbackError },
                ));
              }
              if (rolledBack) continue;
              // The tombstone is durable but rollback failed. Deletion wins;
              // reconcile will finish moving the still-rooted body to trash.
              if (import.meta.env.DEV) console.warn("Delete rollback failed; keeping tombstone:", copyError);
            }

            if (bodyCopied) {
              try {
                assertCurrent();
                await remove(doc.filePath);
                assertCurrent();
              } catch { /* tombstone arbitration removes any surviving root copy */ }
            }

            finalizeNoteMeta(doc.id, {
              acknowledgeFields: { title: true, pinned: true, color: true },
              acknowledgeGroupMembership: true,
            });
            moved.push({
              id: doc.id,
              fileName: trashedMeta.fileName,
              originalFilePath: doc.filePath,
              trashFilePath: trashPath,
              trashedAt,
              groupId: trashedMeta.groupId ?? null,
              createdAt: trashedMeta.createdAt,
              updatedAt: trashedMeta.updatedAt,
              customName: trashedMeta.customName,
              pinned: trashedMeta.pinned === true,
              color: trashedMeta.color,
            });
            deletedIds.add(doc.id);
          } catch (error) {
            if (import.meta.env.DEV) console.warn("Failed to move note to trash:", error);
          }
        }

        let replacement: { doc: NoteDoc; writeOk: boolean } | null = null;
        if (deletedIds.size > 0) {
          const id = crypto.randomUUID();
          const timestamp = Date.now();
          const expectsEmptyLibrary = snapshot.docs.every((doc) => deletedIds.has(doc.id));
          const provisioned = expectsEmptyLibrary
            ? await provisionNoteFile(id, "", "deleteNote.replacement", {}, notesDirectory)
            : { filePath: "", ok: false };
          if (expectsEmptyLibrary) assertCurrent();
          replacement = {
            writeOk: provisioned.ok,
            doc: {
              id,
              filePath: provisioned.filePath,
              fileName: getDefaultDocumentTitle(locale),
              isDirty: !provisioned.ok,
              content: "",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          };
        }
        return {
          baseSnapshot: snapshot,
          deletedIds: Array.from(deletedIds),
          moved,
          previousActiveId: snapshot.activeNoteId,
          replacement,
        };
        },
        (result, directoryGeneration) => {
        if (result.deletedIds.length === 0) return result.baseSnapshot;
        const deletedIds = new Set(result.deletedIds);
        published.snapshot = commitLibraryForGeneration(directoryGeneration, (current) => {
          published.activeBeforePublish = current.activeNoteId;
          const previousActiveIndex = current.activeNoteId
            ? current.docs.findIndex((doc) => doc.id === current.activeNoteId)
            : 0;
          let nextDocs = current.docs.filter((doc) => !deletedIds.has(doc.id));
          if (result.replacement && (result.replacement.writeOk || nextDocs.length === 0)) {
            nextDocs = [...nextDocs, result.replacement.doc];
          }
          const nextGroups = current.groups.map((group) => (
            group.noteIds.some((id) => deletedIds.has(id))
              ? { ...group, noteIds: group.noteIds.filter((id) => !deletedIds.has(id)) }
              : group
          ));
          const movedAtPublish = result.moved.map((entry) => {
            const currentTrash = current.trashedNotes.find((note) => note.id === entry.id);
            if (currentTrash && currentTrash.trashedAt >= entry.trashedAt) return currentTrash;
            const currentDoc = current.docs.find((doc) => doc.id === entry.id);
            const baseDoc = result.baseSnapshot.docs.find((doc) => doc.id === entry.id);
            if (!currentDoc || currentDoc === baseDoc) return entry;
            return {
              ...entry,
              fileName: currentDoc.fileName,
              createdAt: currentDoc.createdAt,
              updatedAt: currentDoc.updatedAt,
              customName: currentDoc.customName,
              pinned: currentDoc.pinned === true,
              color: currentDoc.color,
              groupId: current.groups.find((group) => group.noteIds.includes(entry.id))?.id ?? null,
            };
          });
          const movedIds = new Set(movedAtPublish.map((entry) => entry.id));
          const nextTrash = [
            ...current.trashedNotes.filter((entry) => !movedIds.has(entry.id)),
            ...movedAtPublish,
          ];
          let nextActiveId = current.activeNoteId;
          if (!nextActiveId || deletedIds.has(nextActiveId)) {
            const bounded = Math.min(Math.max(previousActiveIndex, 0), Math.max(nextDocs.length - 1, 0));
            nextActiveId = nextDocs[bounded]?.id ?? null;
          }
          return {
            docs: sortNotes([...nextDocs], notesSortOrder, locale),
            groups: nextGroups,
            trashedNotes: nextTrash,
            activeNoteId: nextActiveId,
          };
        });
        return published.snapshot;
        },
        (result, committed) => {
          if (!published.activeBeforePublish || !result.deletedIds.includes(published.activeBeforePublish)) {
            return undefined;
          }
          const nextActive = committed.activeNoteId
            ? committed.docs.find((doc) => doc.id === committed.activeNoteId)
            : undefined;
          if (!nextActive) return undefined;
          resetDocState(state, tiptapRef, nextActive.id, nextActive.filePath, nextActive.content);
          notifyActiveDocRef?.current?.(nextActive.id, nextActive.filePath);
          if (result.replacement?.doc.id === nextActive.id) state.setIsDirty(!result.replacement.writeOk);
          return undefined;
        },
      );

      const committedSnapshot = published.snapshot;
      if (transaction.status !== "committed" || committedSnapshot == null) return [];
      const { deletedIds } = transaction.value;
      const replacement = transaction.value.replacement;
      if (deletedIds.length === 0) return [];
      const latest = libraryStore.getSnapshot();
      const deletedSet = new Set(deletedIds.filter((id) => !latest.docs.some((doc) => doc.id === id)));
      for (const id of deletedSet) committedDeletedIds.add(id);
      for (const doc of liveDocs) {
        if (!deletedSet.has(doc.id)) continue;
        tiptapRef.current?.invalidateDocumentSession?.(doc.id, doc.filePath);
        emitDocDeleted(doc.id);
      }
      emitGroupsUpdated(latest.groups.map((group) => ({
        ...group,
        noteIds: [...group.noteIds],
      })));
      emitTrashUpdated([...latest.trashedNotes]);
      if (replacement && replacement.writeOk && latest.docs.some((doc) => doc.id === replacement.doc.id)) {
        emitDocCreated(replacement.doc);
      }
      return Array.from(deletedSet);
    } catch {
      return [];
    } finally {
      for (const id of committedDeletedIds) cancelDocSaveRef?.current?.(id);
      releaseLifecycleBlock();
      for (const id of blockedTargetIds) {
        if (!committedDeletedIds.has(id)) await flushDocSaveRef?.current?.(id);
      }
    }
  }, [cancelDocSaveRef, commitLibraryForGeneration, flushDocSaveRef, getLiveDocsSnapshot, leaveCurrentDoc, locale, notesSortOrder, state, tiptapRef]);

  const deleteNote = useCallback(async (index: number): Promise<string[]> => {
    const doc = docsRef.current[index];
    if (!doc) return [];
    return deleteNotes([doc.id]);
  }, [deleteNotes]);

  const duplicateNote = useCallback(async (index: number) => {
    const { docs: liveDocs, activeDocId } = getLiveDocsSnapshot();
    const doc = liveDocs[index];
    if (!doc) return;

    const didPersistCurrentDoc = await leaveCurrentDoc();
    const baseDocs = didPersistCurrentDoc ? markDocClean(liveDocs, activeDocId) : liveDocs;
    const sourceDoc = baseDocs[index];
    if (!sourceDoc) return;

    const id = crypto.randomUUID();
    const timestamp = Date.now();
    // Copy the source's image assets into the duplicate's own asset dir and
    // rewrite `.assets/<sourceId>/` references to the new id, so deleting the
    // source later does not break the duplicate's images.
    const notesDir = await getNotesDir();
    const content = await duplicateNoteAssets(notesDir, sourceDoc.id, id, sourceDoc.content);
    // Abort rather than committing a clean duplicate that lies about being
    // persisted. The source doc is unaffected, so the user can retry.
    const { filePath, ok } = await provisionNoteFile(id, content, "duplicateNote", { sourceId: sourceDoc.id });
    if (!ok) return;

    const newDoc: NoteDoc = {
      id,
      filePath,
      fileName: sourceDoc.fileName,
      isDirty: false,
      content,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const { docs: prunedDocs, groups: prunedGroups } = await pruneEmptyCurrentDoc(baseDocs, activeDocId);
    const nextDocs = [...prunedDocs, newDoc];
    // Persist the pruner's post-delete groups, not groupsRef.current (stale
    // until the next render), so a prune tombstone is not cancelled.
    sortAndPersistDocs(nextDocs, newDoc.id, notesSortOrder, locale, setDocs, setActiveIndex, prunedGroups);
    resetDocState(state, tiptapRef, newDoc.id, filePath, content);
    notifyActiveDocRef?.current?.(newDoc.id, filePath);
  }, [getLiveDocsSnapshot, leaveCurrentDoc, markDocClean, notesSortOrder, setActiveIndex, setDocs, state, tiptapRef, pruneEmptyCurrentDoc]);

  const exportNote = useCallback(async (index: number) => {
    const doc = docs[index];
    if (!doc) return;

    const defaultName = doc.filePath ? getFileName(doc.filePath) : `${doc.fileName}.md`;
    const selected = await save({ title: t("dialog.export", locale), filters: MD_FILTERS, defaultPath: defaultName });
    if (!selected) return;

    const content = index === activeIndex ? getCurrentMarkdown(tiptapRef) : doc.content;
    await writeTextFile(selected, content);
  }, [activeIndex, docs, locale, tiptapRef]);

  const renameNote = useCallback(async (index: number, newName: string): Promise<RenameNoteResult> => {
    const { docs: liveDocs, activeDocId, activeIndex: currentActiveIndex } = getLiveDocsSnapshot();
    const doc = liveDocs[index];
    if (!doc) return { renamed: false, linkRewriteSkipped: false };

    const trimmed = newName.trim();
    if (!trimmed || trimmed === doc.fileName) return { renamed: false, linkRewriteSkipped: false };

    const oldName = doc.fileName;
    // `[[OldTitle]]` identifies its target by title alone, so when two notes
    // share the old title there is no way to tell which one any given link
    // meant. Rewriting them all would silently re-point links that belonged to
    // the OTHER note, so the rename proceeds but the bodies are left untouched
    // and the caller surfaces a notice. Wrong links beat corrupted ones.
    const oldTitleKey = normalizeNoteTitle(oldName);
    const oldTitleIsAmbiguous = oldTitleKey !== ""
      && liveDocs.filter((entry) => normalizeNoteTitle(entry.fileName) === oldTitleKey).length > 1;

    // Case-insensitive match — bracketed form `[[OldTitle]]` is the fenced
    // delimiter, so we don't need word boundaries. Case-insensitive so
    // `[[foo]]`, `[[Foo]]`, `[[FOO]]` all update together, and the new
    // casing from `trimmed` replaces whatever was matched.
    const rewritePattern = new RegExp(
      `\\[\\[${escapeRegexForRename(oldName)}\\]\\]`,
      "gi",
    );
    const replacement = `[[${trimmed}]]`;
    const now = Date.now();

    // Settle the autosave machine for every doc we may rewrite BEFORE touching
    // disk: an in-flight or stranded doSave landing after the rewrite would
    // overwrite it with pre-rename content while memory keeps the rewritten
    // body (isDirty false), silently splitting memory from disk. For the
    // active doc, captureAndQueueSave also disarms the debounce timer so it
    // can't fire mid-rename with the pre-rewrite editor content.
    const candidates = oldTitleIsAmbiguous ? [] : liveDocs.filter(
      (entry) => entry.id !== doc.id && entry.content.includes("[["),
    );
    const flushFailed = new Set<string>();
    for (const entry of candidates) {
      if (entry.id === activeDocId) captureAndQueueSaveRef?.current?.();
      const flushed = await flushDocSaveRef?.current?.(entry.id);
      if (flushed === false) flushFailed.add(entry.id);
    }

    // Compute proposed rewrites without mutating memory yet; we only commit a
    // rewrite to the in-memory doc once its disk write lands, so memory stays
    // in sync with disk if a write fails.
    interface ProposedRewrite { docId: string; updated: string; filePath: string | null; isActive: boolean; }
    const proposed: ProposedRewrite[] = [];
    for (const entry of candidates) {
      // A failed flush means this doc has unsaved content we could not land;
      // rewriting its file now would be undone by the close-time retry of the
      // stranded snapshot. Leave both disk and memory untouched.
      if (flushFailed.has(entry.id)) continue;
      const isActive = entry.id === activeDocId;
      // The active doc's truth is the live editor (already folded into
      // entry.content by getLiveDocsSnapshot). For background docs the just-
      // flushed save can be newer than entry.content (React hasn't committed
      // doSave's setDocs yet), so rewrite what is actually on disk. If the
      // body can't be read back, skip the doc — rewriting from the stale
      // in-memory copy could regress its latest save.
      let base = entry.content;
      if (!isActive && entry.filePath) {
        try {
          base = await readTextFile(entry.filePath);
        } catch {
          continue;
        }
      }
      const updated = base.replace(rewritePattern, replacement);
      if (updated === base) continue;
      proposed.push({
        docId: entry.id,
        updated,
        filePath: entry.filePath || null,
        isActive,
      });
    }

    const committed = new Set<string>();

    await Promise.all(proposed.map(async (rw) => {
      if (rw.isActive) return; // active doc handled below
      if (!rw.filePath) {
        // Memory-only doc — no disk to diverge from, safe to commit.
        committed.add(rw.docId);
        return;
      }
      if (await rewriteNoteFile(rw.filePath, rw.updated, "renameNote.rewrite", rw.docId)) {
        committed.add(rw.docId);
      }
    }));

    const activeRewrite = proposed.find((rw) => rw.isActive) ?? null;
    let activeWriteOk = false;
    if (activeRewrite) {
      const activeDoc = liveDocs[currentActiveIndex];
      if (activeDoc?.filePath) {
        activeWriteOk = await rewriteNoteFile(
          activeDoc.filePath,
          activeRewrite.updated,
          "renameNote.rewrite.active",
          activeDoc.id,
        );
      } else {
        // No file path on the active doc — memory only.
        activeWriteOk = true;
      }
      if (activeWriteOk) committed.add(activeRewrite.docId);
    }

    const proposedById = new Map(proposed.map((rw) => [rw.docId, rw]));
    const nextDocs = liveDocs.map((entry, i) => {
      if (i === index) {
        return { ...entry, fileName: trimmed, updatedAt: now, customName: true };
      }
      const rw = proposedById.get(entry.id);
      if (!rw || !committed.has(entry.id)) return entry;
      return { ...entry, content: rw.updated, updatedAt: now };
    });

    // Flip the editor only if the active doc's rewrite actually landed on
    // disk. Clearing isDirty when the write failed would mask the loss; an
    // unchanged editor + dirty flag lets autosave retry.
    if (activeRewrite && activeWriteOk) {
      const activeDoc = liveDocs[currentActiveIndex];
      tiptapRef.current?.openDocument?.({
        noteId: activeDoc?.id ?? null,
        filePath: activeDoc?.filePath ?? null,
        markdown: activeRewrite.updated,
        reason: "file-watch",
      });
      state.primeMarkdown(activeRewrite.updated);
      state.setIsDirty(false);
    }

    markNoteTitleChanged(doc.id);
    sortAndPersistDocs(nextDocs, doc.id, notesSortOrder, locale, setDocs, setActiveIndex, groupsRef.current);
    emitDocRenamed(doc.id, doc.filePath, doc.filePath, trimmed);
    return { renamed: true, linkRewriteSkipped: oldTitleIsAmbiguous };
  }, [captureAndQueueSaveRef, flushDocSaveRef, getLiveDocsSnapshot, notesSortOrder, setActiveIndex, setDocs, state, tiptapRef]);

  const toggleNotePinned = useCallback((index: number) => {
    const doc = docsRef.current[index];
    if (!doc) return;

    const activeId = docsRef.current[activeIndexRef.current]?.id ?? null;
    const nextPinned = !doc.pinned;
    const nextDocs = docsRef.current.map((entry, i) => (
      i === index ? { ...entry, pinned: nextPinned } : entry
    ));

    markNotesPinnedChanged([doc.id]);
    sortAndPersistDocs(nextDocs, activeId, notesSortOrder, locale, setDocs, setActiveIndex, groupsRef.current);
    emitNotePinnedUpdated(doc.id, nextPinned);
  }, [locale, notesSortOrder, setActiveIndex, setDocs]);

  const setNotesPinned = useCallback((noteIds: string[], pinned: boolean) => {
    const idSet = new Set(noteIds);
    if (!docsRef.current.some((d) => idSet.has(d.id) && (d.pinned === true) !== pinned)) return;

    const activeId = docsRef.current[activeIndexRef.current]?.id ?? null;
    const nextDocs = docsRef.current.map((entry) => (
      idSet.has(entry.id) ? { ...entry, pinned } : entry
    ));

    markNotesPinnedChanged(Array.from(idSet));
    sortAndPersistDocs(nextDocs, activeId, notesSortOrder, locale, setDocs, setActiveIndex, groupsRef.current);
    for (const id of idSet) emitNotePinnedUpdated(id, pinned);
  }, [locale, notesSortOrder, setActiveIndex, setDocs]);

  // Color labels sync through meta without changing body updatedAt.
  const setNoteColor = useCallback((index: number, color: NoteColorId | null) => {
    const doc = docsRef.current[index];
    if (!doc || doc.color === (color ?? undefined)) return;

    const activeId = docsRef.current[activeIndexRef.current]?.id ?? null;
    const nextDocs = docsRef.current.map((entry, i) => (
      i === index ? { ...entry, color: color ?? undefined } : entry
    ));

    markNotesColorChanged([doc.id]);
    sortAndPersistDocs(nextDocs, activeId, notesSortOrder, locale, setDocs, setActiveIndex, groupsRef.current);
    emitNoteColorUpdated(doc.id, color);
  }, [locale, notesSortOrder, setActiveIndex, setDocs]);

  const setNotesColor = useCallback((noteIds: string[], color: NoteColorId | null) => {
    const idSet = new Set(noteIds);
    const next = color ?? undefined;
    if (!docsRef.current.some((d) => idSet.has(d.id) && d.color !== next)) return;

    const activeId = docsRef.current[activeIndexRef.current]?.id ?? null;
    const nextDocs = docsRef.current.map((entry) => (
      idSet.has(entry.id) ? { ...entry, color: next } : entry
    ));

    markNotesColorChanged(Array.from(idSet));
    sortAndPersistDocs(nextDocs, activeId, notesSortOrder, locale, setDocs, setActiveIndex, groupsRef.current);
    for (const id of idSet) emitNoteColorUpdated(id, color);
  }, [locale, notesSortOrder, setActiveIndex, setDocs]);

  // Restore runs on the shared persistence chain like deleteNotes: the sidecar
  // flips live BEFORE the body copy (Windows copyFile preserves the source
  // mtime, so a reconcile that still reads trashedAt != null would move the
  // restored body straight back to .trash), a failed copy or read-back rolls
  // the sidecar back to its tombstone, and docs/groups/trash/active publish as
  // one generation-bound commit. An empty auto-titled doc the user is leaving
  // is pruned inside the same transaction so its removal and the restore land
  // in the same commit.
  const restoreNote = useCallback(async (trashedNoteId: string) => {
    if (!trashedNotesRef.current?.some((note) => note.id === trashedNoteId)) return;
    const didPersistCurrentDoc = await leaveCurrentDoc();
    if (!didPersistCurrentDoc) return;
    if (!trashedNotesRef.current?.some((note) => note.id === trashedNoteId) || !commitLibraryForGeneration) return;

    // The prune candidate must be bound as a transaction target up front so
    // the operation may remove its sidecar; emptiness is re-checked at
    // execution time against the canonical snapshot and the live editor.
    const liveBefore = libraryStore.getSnapshot();
    const leavingBefore = liveBefore.activeNoteId
      ? liveBefore.docs.find((doc) => doc.id === liveBefore.activeNoteId)
      : undefined;
    const pruneCandidateId = leavingBefore && leavingBefore.id !== trashedNoteId && !leavingBefore.customName
      ? leavingBefore.id
      : null;

    const releaseLifecycleBlock = blockNoteLifecycle([trashedNoteId]);
    const published: {
      activeBeforePublish: string | null;
      applied: boolean;
      created: boolean;
      emptiedGroupIds: string[];
    } = { activeBeforePublish: null, applied: false, created: false, emptiedGroupIds: [] };
    let committedGeneration: number | null = null;
    try {
      const didDrain = await flushDocSaveRef?.current?.(trashedNoteId);
      if (didDrain === false) return;
      const transaction = await runPersistenceTransaction(
        "restoreNote",
        pruneCandidateId ? [trashedNoteId, pruneCandidateId] : [trashedNoteId],
        async ({
          notesDirectory,
          snapshot,
          assertCurrent,
          readNoteMeta,
          mergeNoteMeta,
          writeNoteMeta,
          removeNoteMeta,
          discardNoteIntents,
        }) => {
          const failed = { baseSnapshot: snapshot, restored: null, prunedId: null } as const;
          const trashed = snapshot.trashedNotes.find((note) => note.id === trashedNoteId);
          if (!trashed) return failed;

          const pruneLeavingDoc = async (): Promise<string | null> => {
            if (!pruneCandidateId || snapshot.activeNoteId !== pruneCandidateId) return null;
            const leaving = snapshot.docs.find((doc) => doc.id === pruneCandidateId);
            if (!leaving || leaving.customName || snapshot.docs.length <= 1) return null;
            // The editor can hold input newer than the canonical content.
            if (leaving.content.trim() !== "" || getCurrentMarkdown(tiptapRef).trim() !== "") return null;
            cancelDocSaveRef?.current?.(leaving.id);
            // Body before sidecar: a body without a sidecar would be re-ingested
            // by reconcile as a fresh ungrouped doc.
            if (leaving.filePath) {
              markOwnWrite(leaving.filePath);
              try { await remove(leaving.filePath); } catch { /* already gone or locked; reconcile recovers */ }
            }
            try { await removeNoteMeta(leaving.id); } catch { /* already gone or unreachable */ }
            discardNoteIntents(leaving.id);
            tiptapRef.current?.invalidateDocumentSession?.(leaving.id, leaving.filePath);
            return leaving.id;
          };

          const alreadyLive = snapshot.docs.find((doc) => doc.id === trashedNoteId);
          if (alreadyLive) {
            return {
              baseSnapshot: snapshot,
              restored: {
                doc: alreadyLive,
                groupId: snapshot.groups.find((group) => group.noteIds.includes(trashedNoteId))?.id ?? null,
              },
              prunedId: await pruneLeavingDoc(),
            };
          }

          const trashPath = `${notesDirectory}/.trash/${trashed.id}.md`;
          const restoredPath = `${notesDirectory}/${trashed.id}.md`;
          const { meta: previousMeta, unreadable: previousMetaUnreadable } = await readPreviousMeta(
            { readNoteMeta, assertCurrent },
            trashed.id,
            "restoreNote",
          );
          const groupId = trashed.groupId && snapshot.groups.some((group) => group.id === trashed.groupId)
            ? trashed.groupId
            : null;
          const mergedMeta = mergeNoteMeta(trashed.id, {
            version: 2,
            id: trashed.id,
            fileName: trashed.fileName,
            customName: trashed.customName,
            createdAt: trashed.createdAt,
            updatedAt: trashed.updatedAt,
            groupId,
            groupUpdatedAt: previousMeta?.groupUpdatedAt ?? trashed.updatedAt,
            pinned: trashed.pinned === true,
            color: trashed.color,
            trashedAt: trashed.trashedAt,
            trashedFromPath: trashed.originalFilePath,
          }, previousMeta);
          const restoredMeta: NoteMeta = {
            ...mergedMeta,
            groupId,
            trashedAt: null,
            trashedFromPath: null,
          };
          await writeNoteMeta(restoredMeta);

          const rollbackMeta = async () => {
            // A peer may have restored this note itself while we were mid-way
            // (its doc-created already landed here); rewriting our tombstone
            // would clobber the sidecar it just made live and re-trash it.
            if (libraryStore.getSnapshot().docs.some((doc) => doc.id === trashed.id)) return;
            try {
              if (previousMeta) await writeNoteMeta(previousMeta);
              else if (previousMetaUnreadable) await writeNoteMeta(mergedMeta);
              else await removeNoteMeta(trashed.id);
            } catch (error) {
              void logNotenError(new NotenError(
                "PERSIST_FAILED",
                "fatal",
                error instanceof Error ? error.message : String(error),
                { context: { stage: "restoreNote.rollback", noteId: trashed.id }, cause: error },
              ));
            }
          };

          markOwnWrite(restoredPath);
          try {
            assertCurrent();
            // Re-check by value, not identity: a peer's trash-updated event
            // rebuilds every trash entry object, and that must not read as
            // "the entry changed". Only a vanished entry (permanent delete /
            // empty trash), a re-trash with a newer trashedAt, or a doc that
            // already became live means the transition no longer applies.
            const beforeCopy = libraryStore.getSnapshot();
            const trashNow = beforeCopy.trashedNotes.find((note) => note.id === trashedNoteId);
            if (
              beforeCopy.docs.some((doc) => doc.id === trashedNoteId)
              || !trashNow
              || trashNow.trashedAt !== trashed.trashedAt
            ) {
              await rollbackMeta();
              return failed;
            }
            await copyFile(trashPath, restoredPath);
            assertCurrent();
          } catch (error) {
            await rollbackMeta();
            if (import.meta.env.DEV) console.warn("Failed to restore note from trash:", error);
            return failed;
          }

          let content: string;
          try {
            assertCurrent();
            content = await readTextFile(restoredPath);
            assertCurrent();
          } catch (error) {
            await rollbackMeta();
            markOwnWrite(restoredPath);
            await remove(restoredPath).catch(() => {});
            void logNotenError(new NotenError(
              "BODY_READ_FAILED",
              "recoverable",
              error instanceof Error ? error.message : String(error),
              { context: { stage: "restoreNote", noteId: trashedNoteId, filePath: restoredPath }, cause: error },
            ));
            return failed;
          }
          // The restore is durable from here on. The trash copy is only cruft
          // now, and reconcile never sweeps .trash, so it would linger forever.
          markOwnWrite(trashPath);
          await remove(trashPath).catch(() => {});

          return {
            baseSnapshot: snapshot,
            restored: {
              doc: {
                id: trashed.id,
                filePath: restoredPath,
                fileName: restoredMeta.fileName,
                customName: restoredMeta.customName,
                isDirty: false,
                content,
                createdAt: restoredMeta.createdAt,
                updatedAt: restoredMeta.updatedAt,
                pinned: restoredMeta.pinned === true,
                color: restoredMeta.color,
              } satisfies NoteDoc,
              groupId,
            },
            prunedId: await pruneLeavingDoc(),
          };
        },
        (result, directoryGeneration) => {
          if (!result.restored) return result.baseSnapshot;
          const { restored, prunedId } = result;
          // The disk transition is durable, so publish it against whatever the
          // store holds now rather than refusing on a rebuilt trash entry.
          const committed = commitLibraryForGeneration(directoryGeneration, (current) => {
            published.applied = true;
            published.activeBeforePublish = current.activeNoteId;
            const existing = current.docs.find((doc) => doc.id === trashedNoteId);
            published.created = existing == null;
            const nextDocs = [
              ...current.docs.filter((doc) => doc.id !== trashedNoteId && doc.id !== prunedId),
              existing ?? restored.doc,
            ];
            const emptied: string[] = [];
            const nextGroups = current.groups.flatMap((group) => {
              const without = group.noteIds.filter((id) => id !== trashedNoteId && id !== prunedId);
              if (group.id === restored.groupId) return [{ ...group, noteIds: [...without, trashedNoteId] }];
              if (without.length === group.noteIds.length) return [group];
              // A group the prune emptied is tombstoned, as pruneEmptyCurrentDoc does.
              if (without.length === 0 && prunedId && group.noteIds.includes(prunedId)) {
                emptied.push(group.id);
                return [];
              }
              return [{ ...group, noteIds: without }];
            });
            published.emptiedGroupIds = emptied;
            return {
              docs: sortNotes(nextDocs, notesSortOrder, locale),
              groups: nextGroups,
              trashedNotes: current.trashedNotes.filter((note) => note.id !== trashedNoteId),
              activeNoteId: trashedNoteId,
            };
          });
          if (committed) {
            for (const groupId of published.emptiedGroupIds) markGroupAsDeleted(groupId);
          }
          return committed;
        },
        (result, committed) => {
          if (!result.restored || !published.applied || published.activeBeforePublish === trashedNoteId) return undefined;
          const restoredDoc = committed.docs.find((doc) => doc.id === trashedNoteId);
          if (!restoredDoc) return undefined;
          // Capture input typed into the leaving doc after leaveCurrentDoc
          // flushed it, unless that doc was just pruned.
          if (published.activeBeforePublish !== result.prunedId) captureAndQueueSaveRef?.current?.();
          resetDocState(state, tiptapRef, restoredDoc.id, restoredDoc.filePath, restoredDoc.content);
          notifyActiveDocRef?.current?.(restoredDoc.id, restoredDoc.filePath);
          return undefined;
        },
      );
      if (transaction.status !== "committed" || !transaction.value.restored || !published.applied) return;
      committedGeneration = transaction.value.baseSnapshot.directoryGeneration;
      const latest = libraryStore.getSnapshot();
      if (latest.directoryGeneration !== committedGeneration) return;
      const restoredDoc = latest.docs.find((doc) => doc.id === trashedNoteId);
      if (!restoredDoc) return;
      emitTrashUpdated([...latest.trashedNotes]);
      emitGroupsUpdated(latest.groups.map((group) => ({ ...group, noteIds: [...group.noteIds] })));
      if (published.created) emitDocCreated(restoredDoc);
    } catch {
      // The transaction already logged the failure; the trash entry stays.
    } finally {
      releaseLifecycleBlock();
      const latest = libraryStore.getSnapshot();
      if (
        committedGeneration != null
        && latest.directoryGeneration === committedGeneration
        && latest.docs.some((doc) => doc.id === trashedNoteId)
      ) {
        await flushDocSaveRef?.current?.(trashedNoteId);
      }
    }
  }, [cancelDocSaveRef, captureAndQueueSaveRef, commitLibraryForGeneration, flushDocSaveRef, leaveCurrentDoc, locale, notesSortOrder, state, tiptapRef]);

  const permanentlyDeleteNote = useCallback(async (trashedNoteId: string) => {
    const trashed = trashedNotesRef.current?.find((n) => n.id === trashedNoteId);
    if (!trashed) return;

    try { await remove(trashed.trashFilePath); } catch { /* already gone */ }
    try {
      const notesDir = await getNotesDir();
      await removeNoteAssetDir(notesDir, trashed.id);
      await removeMetaFile(tauriFileSystem, notesDir, trashed.id);
    } catch { /* ignore */ }

    if (setTrashedNotes) {
      setTrashedNotes((prev) => prev.filter((n) => n.id !== trashedNoteId));
      emitTrashUpdated(getTrashedNotesCache());
    }
    tiptapRef.current?.invalidateDocumentSession?.(trashed.id, trashed.originalFilePath);

    void saveManifest(docsRef.current, docsRef.current[activeIndexRef.current]?.id ?? null, groupsRef.current).catch(() => {});
  }, [setTrashedNotes, tiptapRef]);

  const emptyTrash = useCallback(async () => {
    const trashedSnapshot = trashedNotesRef.current ?? [];
    let notesDir: string | null = null;
    try { notesDir = await getNotesDir(); } catch { /* ignore */ }
    for (const trashed of trashedSnapshot) {
      try { await remove(trashed.trashFilePath); } catch { /* ignore */ }
      if (notesDir) {
        await removeNoteAssetDir(notesDir, trashed.id);
        await removeMetaFile(tauriFileSystem, notesDir, trashed.id);
      }
    }

    if (setTrashedNotes) {
      setTrashedNotes([]);
      emitTrashUpdated([]);
    }

    void saveManifest(docsRef.current, docsRef.current[activeIndexRef.current]?.id ?? null, groupsRef.current).catch(() => {});
  }, [setTrashedNotes]);

  return { importFile, importFiles, saveFile, saveFileAs, newNote, createNoteWithTitle, switchDocument, deleteNote, deleteNotes, duplicateNote, exportNote, renameNote, toggleNotePinned, setNotesPinned, setNoteColor, setNotesColor, restoreNote, permanentlyDeleteNote, emptyTrash };
}
