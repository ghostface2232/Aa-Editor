import { describe, expect, it } from "vitest";
import { mergeDiskGroups, type DiskGroupsMergeInput } from "./mergeDiskGroups";
import type { NoteGroup } from "./noteTypes";
import type { SharedGroupEntry } from "./groupsIO";
import type { NoteMeta } from "./metadataIO";

const group = (id: string, overrides: Partial<NoteGroup> = {}): NoteGroup => ({
  id,
  name: id.toUpperCase(),
  noteIds: [],
  collapsed: false,
  createdAt: 1000,
  orderKey: "m",
  orderUpdatedAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const entry = (id: string, overrides: Partial<SharedGroupEntry> = {}): SharedGroupEntry => ({
  id,
  name: id.toUpperCase(),
  orderKey: "m",
  orderUpdatedAt: 1000,
  updatedAt: 1000,
  createdAt: 1000,
  deletedAt: null,
  ...overrides,
});

const meta = (id: string, overrides: Partial<NoteMeta> = {}): NoteMeta => ({
  version: 2,
  id,
  fileName: `Note ${id}`,
  createdAt: 1000,
  updatedAt: 1000,
  groupId: null,
  trashedAt: null,
  ...overrides,
} as NoteMeta);

const input = (overrides: Partial<DiskGroupsMergeInput> = {}): DiskGroupsMergeInput => ({
  entries: {},
  metaById: new Map(),
  collapsedByGroup: {},
  pendingTombstoneIds: new Set(),
  pendingMembership: new Map(),
  liveDocIds: new Set(),
  ...overrides,
});

describe("mergeDiskGroups", () => {
  it("returns the same prev instance when disk agrees with memory", () => {
    const prev = [group("g1")];
    const out = mergeDiskGroups(prev, input({ entries: { g1: entry("g1") } }));
    expect(out).toBe(prev);
  });

  it("a concurrent local rename with a newer clock survives an older disk read", () => {
    const prev = [group("g1", { name: "Local newer", updatedAt: 2000 })];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1", { name: "Stale disk", updatedAt: 1000 }) },
    }));
    expect(out).toBe(prev);
  });

  it("adopts a newer disk rename and orderKey by their own clocks", () => {
    const prev = [
      group("g1", { name: "Old", updatedAt: 1000, orderKey: "a", orderUpdatedAt: 1000 }),
      group("g2", { orderKey: "b" }),
    ];
    const out = mergeDiskGroups(prev, input({
      entries: {
        g1: entry("g1", { name: "New", updatedAt: 2000, orderKey: "z", orderUpdatedAt: 2000 }),
        g2: entry("g2", { orderKey: "b" }),
      },
    }));
    const g1 = out.find((g) => g.id === "g1")!;
    expect(g1.name).toBe("New");
    expect(g1.orderKey).toBe("z");
    // Adopted orderKey re-sorts: g2 ("b") now precedes g1 ("z").
    expect(out.map((g) => g.id)).toEqual(["g2", "g1"]);
    // Untouched entries pass through by reference.
    expect(out.find((g) => g.id === "g2")).toBe(prev[1]);
  });

  it("keeps a local group absent from disk (unwritten create) but removes a tombstoned one", () => {
    const prev = [group("g-fresh"), group("g-deleted")];
    const out = mergeDiskGroups(prev, input({
      entries: { "g-deleted": entry("g-deleted", { deletedAt: 5000 }) },
    }));
    expect(out.map((g) => g.id)).toEqual(["g-fresh"]);
  });

  it("does not resurrect a locally deleted group whose tombstone is still pending", () => {
    const prev: NoteGroup[] = [];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1") },
      pendingTombstoneIds: new Set(["g1"]),
    }));
    expect(out).toBe(prev);
  });

  it("inserts a disk-only group with membership and ui-cached collapsed state", () => {
    const prev = [group("g1", { orderKey: "a" })];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1", { orderKey: "a" }), g2: entry("g2", { orderKey: "b" }) },
      metaById: new Map([["n1", meta("n1", { groupId: "g2" })]]),
      collapsedByGroup: { g2: true },
    }));
    expect(out.map((g) => g.id)).toEqual(["g1", "g2"]);
    const g2 = out.find((g) => g.id === "g2")!;
    expect(g2.noteIds).toEqual(["n1"]);
    expect(g2.collapsed).toBe(true);
  });

  it("keeps the local collapsed flag on an existing group (per-machine state)", () => {
    const prev = [group("g1", { collapsed: true, updatedAt: 1000 })];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1", { name: "Renamed", updatedAt: 2000 }) },
      collapsedByGroup: {},
    }));
    expect(out[0].collapsed).toBe(true);
    expect(out[0].name).toBe("Renamed");
  });

  it("a pending local membership intent wins over the disk sidecar", () => {
    const prev = [group("g1", { noteIds: [] }), group("g2", { noteIds: ["n1"] })];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1"), g2: entry("g2") },
      metaById: new Map([["n1", meta("n1", { groupId: "g1", groupUpdatedAt: 1000 })]]),
      pendingMembership: new Map([["n1", { groupId: "g2", updatedAt: 2000 }]]),
      liveDocIds: new Set(["n1"]),
    }));
    expect(out).toBe(prev);
  });

  it("adopts disk membership when there is no pending intent", () => {
    const prev = [group("g1", { noteIds: ["n1"] }), group("g2")];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1"), g2: entry("g2") },
      metaById: new Map([["n1", meta("n1", { groupId: "g2" })]]),
      liveDocIds: new Set(["n1"]),
    }));
    expect(out.find((g) => g.id === "g1")!.noteIds).toEqual([]);
    expect(out.find((g) => g.id === "g2")!.noteIds).toEqual(["n1"]);
  });

  it("a live doc with no sidecar yet keeps its in-memory membership; a gone doc is dropped", () => {
    const prev = [group("g1", { noteIds: ["mid-create", "gone"] })];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1") },
      liveDocIds: new Set(["mid-create"]),
    }));
    expect(out[0].noteIds).toEqual(["mid-create"]);
  });

  it("a trashed sidecar removes the note from its group", () => {
    const prev = [group("g1", { noteIds: ["n1"] })];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1") },
      metaById: new Map([["n1", meta("n1", { groupId: "g1", trashedAt: 5000 })]]),
      liveDocIds: new Set(["n1"]),
    }));
    expect(out[0].noteIds).toEqual([]);
  });

  it("an empty disk file deletes nothing (absent is not tombstoned)", () => {
    const prev = [group("g1", { noteIds: ["n1"] }), group("g2")];
    const out = mergeDiskGroups(prev, input({
      entries: {},
      liveDocIds: new Set(["n1"]),
    }));
    expect(out).toBe(prev);
  });

  it("is idempotent: re-running the merge over its own output is a no-op", () => {
    const prev = [group("g1", { name: "Old", updatedAt: 1000, noteIds: ["n1"] })];
    const in1 = input({
      entries: { g1: entry("g1", { name: "New", updatedAt: 2000 }), g2: entry("g2", { orderKey: "b" }) },
      metaById: new Map([["n2", meta("n2", { groupId: "g2" })]]),
      liveDocIds: new Set(["n1"]),
    });
    const once = mergeDiskGroups(prev, in1);
    expect(once).not.toBe(prev);
    expect(mergeDiskGroups(once, in1)).toBe(once);
  });

  it("a note duplicated across two groups' noteIds collapses to one membership", () => {
    const prev = [group("g1", { noteIds: ["n1"] }), group("g2", { noteIds: ["n1"] })];
    const out = mergeDiskGroups(prev, input({
      entries: { g1: entry("g1"), g2: entry("g2") },
      liveDocIds: new Set(["n1"]),
    }));
    expect(out.find((g) => g.id === "g1")!.noteIds).toEqual(["n1"]);
    expect(out.find((g) => g.id === "g2")!.noteIds).toEqual([]);
  });

  it("adopting an older disk createdAt re-sorts on the tiebreaker", () => {
    const prev = [
      group("g1", { orderKey: "m", createdAt: 2000 }),
      group("g2", { orderKey: "m", createdAt: 3000 }),
    ];
    const out = mergeDiskGroups(prev, input({
      entries: {
        g1: entry("g1", { orderKey: "m", createdAt: 2000 }),
        g2: entry("g2", { orderKey: "m", createdAt: 1000 }),
      },
    }));
    expect(out.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(out.find((g) => g.id === "g2")!.createdAt).toBe(1000);
  });
});
