import { useCallback, useMemo, useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteDoc } from "../utils/noteTypes";
import type { TiptapEditorHandle } from "../components/TiptapEditor";
import { createLibraryStore, type LibrarySnapshot, type LibraryUpdater } from "../utils/libraryStore";

const refs = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "window-a" }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    refs.handlers.set(name, handler);
    return () => refs.handlers.delete(name);
  }),
}));

vi.mock("./useNotesLoader", () => ({
  sortNotes: <T,>(docs: T[]) => docs,
  setTrashedNotesCache: vi.fn(),
  syncGroupsSnapshotFromDisk: vi.fn(async () => {}),
  getNotesDir: vi.fn(async () => "/notes"),
}));

import { useWindowSync, emitDocUpdated, resetDocBodyClocks } from "./useWindowSync";

function makeDoc(id: string): NoteDoc {
  return {
    id,
    filePath: `/notes/${id}.md`,
    fileName: `Note ${id}`,
    content: id,
    isDirty: id === "a",
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderWindowSync(
  settleRemoteDeletedDoc: (docId: string) => Promise<boolean>,
  initialDocs: NoteDoc[] = [makeDoc("a"), makeDoc("b")],
) {
  const openDocument = vi.fn();
  const onActiveDocChanged = vi.fn();
  const tiptapRef = {
    current: {
      getEditor: () => ({ storage: { documentContext: { noteId: "a" } } }),
      openDocument,
    } as unknown as TiptapEditorHandle,
  };

  const hook = renderHook(() => {
    // A private canonical store stands in for useNotesLoader's adapter: the
    // hook must express every remote change as one store updater.
    const store = useMemo(() => createLibraryStore({
      docs: initialDocs,
      activeNoteId: initialDocs[0]?.id ?? null,
      notesDirectory: "/notes",
    }), []);
    const [snapshot, setSnapshot] = useState<LibrarySnapshot>(() => store.getSnapshot());
    const commitRemote = useCallback((update: LibraryUpdater) => {
      const before = store.getSnapshot();
      const committed = store.commit(update, "remote");
      if (committed === before) return null;
      setSnapshot(committed);
      return committed;
    }, [store]);
    const docs = snapshot.docs as NoteDoc[];
    const activeIndex = snapshot.activeNoteId
      ? Math.max(docs.findIndex((doc) => doc.id === snapshot.activeNoteId), 0)
      : 0;
    useWindowSync(
      commitRemote,
      docs[activeIndex]?.id ?? null,
      tiptapRef,
      onActiveDocChanged,
      "updated-desc",
      "en",
      settleRemoteDeletedDoc,
    );
    return { docs, activeIndex, snapshot };
  });
  return { ...hook, openDocument, onActiveDocChanged };
}

beforeEach(() => {
  refs.handlers.clear();
  resetDocBodyClocks();
});

describe("useWindowSync — remote body update", () => {
  it("updates content without letting a delayed body event overwrite the title", async () => {
    const newerMetadata = {
      ...makeDoc("b"),
      fileName: "Newest sidecar title",
      updatedAt: 10_000,
    };
    const { result } = renderWindowSync(async () => true, [makeDoc("a"), newerMetadata]);
    await waitFor(() => expect(refs.handlers.has("doc-updated")).toBe(true));

    act(() => {
      refs.handlers.get("doc-updated")?.({
        payload: {
          sourceWindow: "window-b",
          docId: "b",
          content: "remote body",
          updatedAt: 9000,
          // Older app versions included a title in this event. It must remain
          // outside the body event's ownership even when present on the wire.
          fileName: "Stale event title",
        },
      });
    });

    expect(result.current.docs.find((doc) => doc.id === "b")).toMatchObject({
      content: "remote body",
      fileName: "Newest sidecar title",
      updatedAt: 10_000,
    });
  });
  it("ignores a body event that predates a body this window already saved", async () => {
    const { result } = renderWindowSync(async () => true, [makeDoc("a"), makeDoc("b")]);
    await waitFor(() => expect(refs.handlers.has("doc-updated")).toBe(true));

    // This window persisted "b" at 9000 and broadcast it. The doc's own
    // updatedAt is not the guard here — a peer body from BEFORE that save
    // arriving late must not roll our newer body back.
    act(() => { emitDocUpdated("b", "our newer body", 9000); });
    act(() => {
      refs.handlers.get("doc-updated")?.({
        payload: { sourceWindow: "window-b", docId: "b", content: "older peer body", updatedAt: 8000 },
      });
    });

    expect(result.current.docs.find((doc) => doc.id === "b")).toMatchObject({ content: "b" });
  });

  it("ignores a body event delivered out of order after a newer peer body", async () => {
    const { result } = renderWindowSync(async () => true, [makeDoc("a"), makeDoc("b")]);
    await waitFor(() => expect(refs.handlers.has("doc-updated")).toBe(true));

    // Two peers saved the same note; their events reach this window in the
    // wrong order. Applying the loser would leave content and updatedAt
    // describing different revisions, and the next local save would write the
    // older body back over the newer one.
    act(() => {
      refs.handlers.get("doc-updated")?.({
        payload: { sourceWindow: "window-c", docId: "b", content: "newest body", updatedAt: 5000 },
      });
    });
    act(() => {
      refs.handlers.get("doc-updated")?.({
        payload: { sourceWindow: "window-b", docId: "b", content: "older body", updatedAt: 4000 },
      });
    });

    expect(result.current.docs.find((doc) => doc.id === "b")).toMatchObject({
      content: "newest body",
      updatedAt: 5000,
    });
  });

  it("applies a body event that is newer than the last one seen for that doc", async () => {
    const { result } = renderWindowSync(async () => true, [makeDoc("a"), makeDoc("b")]);
    await waitFor(() => expect(refs.handlers.has("doc-updated")).toBe(true));

    act(() => {
      refs.handlers.get("doc-updated")?.({
        payload: { sourceWindow: "window-b", docId: "b", content: "first", updatedAt: 4000 },
      });
    });
    act(() => {
      refs.handlers.get("doc-updated")?.({
        payload: { sourceWindow: "window-b", docId: "b", content: "second", updatedAt: 5000 },
      });
    });

    expect(result.current.docs.find((doc) => doc.id === "b")).toMatchObject({
      content: "second",
      updatedAt: 5000,
    });
  });
});

describe("useWindowSync — remote deletion", () => {
  it("removes the live document immediately after synchronous preservation capture", async () => {
    let finish!: (value: boolean) => void;
    const settle = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { result } = renderWindowSync(settle);
    await waitFor(() => expect(refs.handlers.has("doc-deleted")).toBe(true));

    act(() => {
      refs.handlers.get("doc-deleted")?.({
        payload: { sourceWindow: "window-b", docId: "a" },
      });
    });
    expect(result.current.docs.map((doc) => doc.id)).toEqual(["b"]);
    expect(settle).toHaveBeenCalledWith("a");

    await act(async () => { finish(true); });
    await waitFor(() => expect(result.current.docs.map((doc) => doc.id)).toEqual(["b"]));
  });

  it("still applies deletion when preserving the local copy fails", async () => {
    const settle = vi.fn(async () => { throw new Error("preservation failed"); });
    const { result } = renderWindowSync(settle);
    await waitFor(() => expect(refs.handlers.has("doc-deleted")).toBe(true));

    act(() => {
      refs.handlers.get("doc-deleted")?.({
        payload: { sourceWindow: "window-b", docId: "a" },
      });
    });

    await waitFor(() => expect(settle).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(result.current.docs.map((doc) => doc.id)).toEqual(["b"]));
  });
});

describe("useWindowSync — last-note replacement", () => {
  it("activates a replacement that arrives after the peer removed its last note", async () => {
    const settle = vi.fn(async () => true);
    const { result, openDocument, onActiveDocChanged } = renderWindowSync(settle, [makeDoc("a")]);
    await waitFor(() => expect(refs.handlers.has("doc-created")).toBe(true));

    act(() => {
      refs.handlers.get("doc-deleted")?.({
        payload: { sourceWindow: "window-b", docId: "a" },
      });
    });
    expect(result.current.docs).toEqual([]);

    const replacement = makeDoc("b");
    act(() => {
      refs.handlers.get("doc-created")?.({
        payload: { sourceWindow: "window-b", doc: replacement },
      });
    });

    expect(result.current.docs.map((doc) => doc.id)).toEqual(["b"]);
    expect(result.current.activeIndex).toBe(0);
    expect(openDocument).toHaveBeenLastCalledWith({
      noteId: "b",
      filePath: replacement.filePath,
      markdown: replacement.content,
      reason: "window-sync",
    });
    expect(onActiveDocChanged).toHaveBeenLastCalledWith({
      filePath: replacement.filePath,
      content: replacement.content,
    });
  });

  it("switches to a replacement that arrives before the deletion event", async () => {
    const settle = vi.fn(async () => true);
    const { result, openDocument } = renderWindowSync(settle, [makeDoc("a")]);
    await waitFor(() => expect(refs.handlers.has("doc-created")).toBe(true));

    const replacement = makeDoc("b");
    act(() => {
      refs.handlers.get("doc-created")?.({
        payload: { sourceWindow: "window-b", doc: replacement },
      });
    });
    expect(result.current.docs.map((doc) => doc.id)).toEqual(["a", "b"]);

    act(() => {
      refs.handlers.get("doc-deleted")?.({
        payload: { sourceWindow: "window-b", docId: "a" },
      });
    });

    expect(result.current.docs.map((doc) => doc.id)).toEqual(["b"]);
    expect(result.current.activeIndex).toBe(0);
    expect(openDocument).toHaveBeenLastCalledWith({
      noteId: "b",
      filePath: replacement.filePath,
      markdown: replacement.content,
      reason: "window-sync",
    });
  });
});
