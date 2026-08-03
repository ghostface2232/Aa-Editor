import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteDoc } from "../utils/noteTypes";
import type { TiptapEditorHandle } from "../components/TiptapEditor";

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

import { useWindowSync } from "./useWindowSync";

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
    const [docs, setDocs] = useState(initialDocs);
    const [activeIndex, setActiveIndex] = useState(0);
    useWindowSync(
      setDocs,
      activeIndex,
      docs[activeIndex]?.id ?? null,
      tiptapRef,
      setActiveIndex,
      undefined,
      undefined,
      onActiveDocChanged,
      "updated-desc",
      "en",
      settleRemoteDeletedDoc,
    );
    return { docs, activeIndex };
  });
  return { ...hook, openDocument, onActiveDocChanged };
}

beforeEach(() => {
  refs.handlers.clear();
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
