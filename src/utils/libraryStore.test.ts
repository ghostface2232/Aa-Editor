import { describe, expect, it, vi } from "vitest";
import { createLibraryStore, type LibraryData } from "./libraryStore";
import type { NoteDoc } from "./noteTypes";

function doc(id: string): NoteDoc {
  return {
    id,
    filePath: `/notes/${id}.md`,
    fileName: `Note ${id}`,
    content: "",
    isDirty: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function data(docs: NoteDoc[], activeNoteId: string | null): LibraryData {
  return { docs, groups: [], trashedNotes: [], activeNoteId };
}

describe("libraryStore", () => {
  it("commits related library fields atomically under one revision", () => {
    const store = createLibraryStore();
    const a = doc("a");
    const b = doc("b");
    store.seedDirectory("C:/notes", data([a, b], "a"));
    const before = store.getSnapshot();
    const trashed = [{
      id: "a",
      fileName: a.fileName,
      originalFilePath: a.filePath,
      trashFilePath: "C:/notes/.trash/a.md",
      trashedAt: 10,
      groupId: null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }];

    const committed = store.commit({
      docs: [b],
      groups: [],
      trashedNotes: trashed,
      activeNoteId: "b",
    }, "local");

    expect(committed).toMatchObject({
      revision: before.revision + 1,
      docs: [b],
      trashedNotes: trashed,
      activeNoteId: "b",
      origin: "local",
    });
  });

  it("runs functional commits against the latest committed snapshot", () => {
    const store = createLibraryStore();
    const a = doc("a");
    store.seedDirectory("C:/notes", data([a], "a"));
    store.commit({ docs: [a, doc("b")] }, "remote");

    const committed = store.commit((current) => ({
      docs: current.docs.map((entry) => entry.id === "a"
        ? { ...entry, fileName: "Latest" }
        : entry),
    }), "local");

    expect(committed.docs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(committed.docs[0].fileName).toBe("Latest");
  });

  it("preserves unchanged entity identity across a one-note commit", () => {
    const store = createLibraryStore();
    store.seedDirectory("C:/notes", data([doc("a"), doc("b")], "a"));
    const before = store.getSnapshot();

    const committed = store.commit((current) => ({
      docs: current.docs.map((entry) => entry.id === "a"
        ? { ...entry, fileName: "Changed" }
        : entry),
    }), "local");

    expect(committed.docs).not.toBe(before.docs);
    expect(committed.docs[0]).not.toBe(before.docs[0]);
    expect(committed.docs[1]).toBe(before.docs[1]);
  });

  it("accepts readonly snapshot groups in a functional patch", () => {
    const store = createLibraryStore();
    store.seedDirectory("C:/notes", {
      ...data([doc("a")], "a"),
      groups: [{
        id: "g",
        name: "Group",
        noteIds: ["a"],
        collapsed: false,
        createdAt: 1,
      }],
    });

    const committed = store.commit((current) => ({
      groups: current.groups.map((group) => group.id === "g"
        ? { ...group, name: "Renamed" }
        : group),
    }), "local");

    expect(committed.groups[0].name).toBe("Renamed");
  });

  it("does not advance the revision or notify for a referential no-op", () => {
    const store = createLibraryStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    const after = store.commit(() => ({ docs: before.docs }), "local");

    expect(after).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("increments the directory generation for every hydration epoch", () => {
    const store = createLibraryStore();
    const first = store.seedDirectory("C:/notes-a", data([doc("a")], "a"));
    const reload = store.seedDirectory("C:/notes-a", data([doc("a")], "a"));
    const switched = store.seedDirectory("D:/notes-b", data([doc("b")], "b"));

    expect(first.directoryGeneration).toBe(1);
    expect(reload.directoryGeneration).toBe(2);
    expect(switched.directoryGeneration).toBe(3);
    expect(switched.revision).toBe(reload.revision + 1);
  });

  it("keeps active identity stable when the docs projection is reordered", () => {
    const store = createLibraryStore();
    const a = doc("a");
    const b = doc("b");
    store.seedDirectory("C:/notes", data([a, b], "b"));

    const committed = store.commit({ docs: [b, a] }, "local");

    expect(committed.activeNoteId).toBe("b");
    expect(committed.docs.findIndex((entry) => entry.id === committed.activeNoteId)).toBe(0);
  });

  it("normalizes a dangling active id when its document is removed", () => {
    const store = createLibraryStore();
    const a = doc("a");
    const b = doc("b");
    store.seedDirectory("C:/notes", data([a, b], "a"));

    const committed = store.commit({ docs: [b] }, "remote");

    expect(committed.activeNoteId).toBe("b");
  });

  it("owns immutable copies of input arrays, entities, and group membership", () => {
    const store = createLibraryStore();
    const a = doc("a");
    const docs = [a];
    const groups = [{
      id: "g",
      name: "Group",
      noteIds: ["a"],
      collapsed: false,
      createdAt: 1,
    }];
    store.seedDirectory("C:/notes", {
      docs,
      groups,
      trashedNotes: [],
      activeNoteId: "a",
    });

    a.fileName = "Mutated outside";
    docs.push(doc("b"));
    groups[0].noteIds.push("b");

    const snapshot = store.getSnapshot();
    expect(snapshot.docs).toHaveLength(1);
    expect(snapshot.docs[0].fileName).toBe("Note a");
    expect(snapshot.groups[0].noteIds).toEqual(["a"]);
    expect(() => (snapshot.docs as NoteDoc[]).push(doc("c"))).toThrow();
    expect(() => { (snapshot.docs[0] as NoteDoc).fileName = "Illegal"; }).toThrow();
    expect(() => (snapshot.groups[0].noteIds as string[]).push("c")).toThrow();
  });

  it("does not share mutable empty arrays between store instances", () => {
    const first = createLibraryStore();
    const second = createLibraryStore();

    expect(first.getSnapshot().docs).not.toBe(second.getSnapshot().docs);
    expect(first.getSnapshot().groups).not.toBe(second.getSnapshot().groups);
    expect(first.getSnapshot().trashedNotes).not.toBe(second.getSnapshot().trashedNotes);
  });

  it("returns the initiating snapshot when a listener commits reentrantly", () => {
    const store = createLibraryStore();
    let nested = false;
    store.subscribe(() => {
      if (nested) return;
      nested = true;
      store.commit({ groups: [] }, "remote");
    });

    const outer = store.commit({ docs: [doc("a")] }, "local");

    expect(outer).toMatchObject({ revision: 1, origin: "local" });
    expect(store.getSnapshot()).toMatchObject({ revision: 2, origin: "remote" });
  });

  it("rejects a reentrant mutation before either commit can change state", () => {
    const store = createLibraryStore();

    expect(() => store.commit(() => {
      store.commit({ docs: [doc("nested")] }, "remote");
      return { docs: [doc("outer")] };
    }, "local")).toThrow("must not mutate the store reentrantly");
    expect(store.getSnapshot()).toMatchObject({ revision: 0, docs: [] });

    expect(() => store.commit(() => {
      store.clearDirectory();
      return null;
    }, "local")).toThrow("must not mutate the store reentrantly");
    expect(store.getSnapshot().revision).toBe(0);

    expect(store.commit({ docs: [doc("after-error")] }, "local").revision).toBe(1);
  });

  it("rejects an explicit undefined patch instead of corrupting canonical state", () => {
    const store = createLibraryStore();

    expect(() => store.commit({ docs: undefined } as unknown as { docs: NoteDoc[] }, "local"))
      .toThrow("docs cannot be undefined");
    expect(store.getSnapshot().docs).toEqual([]);
  });

  it("rejects a stale async commit after another revision or hydration epoch", () => {
    const store = createLibraryStore();
    store.seedDirectory("C:/notes-a", data([doc("a")], "a"));
    const stale = store.getToken();
    store.seedDirectory("D:/notes-b", data([doc("b")], "b"));

    const result = store.commitIfCurrent(stale, { docs: [doc("stale")] }, "local");

    expect(result).toBeNull();
    expect(store.getSnapshot().docs.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("lets generation-scoped work compose with newer commits in the same hydration epoch", () => {
    const store = createLibraryStore();
    const seeded = store.seedDirectory("C:/notes", data([doc("a")], "a"));
    store.commit({ groups: [] }, "local");

    const committed = store.commitForGeneration(seeded.directoryGeneration, (current) => ({
      docs: [...current.docs, doc("b")],
    }), "reconcile");

    expect(committed?.docs.map((entry) => entry.id)).toEqual(["a", "b"]);
    store.clearDirectory();
    expect(store.commitForGeneration(
      seeded.directoryGeneration,
      { docs: [doc("stale")] },
      "reconcile",
    )).toBeNull();
  });
});
