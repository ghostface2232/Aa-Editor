import { describe, expect, it } from "vitest";
import { diffGroupsDelta } from "./groupsDelta";
import type { NoteGroup } from "./noteTypes";

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

describe("diffGroupsDelta", () => {
  it("is empty for value-identical clones (never reference-diffs)", () => {
    const prev = [group("g1", { noteIds: ["a"] })];
    const next = prev.map((g) => ({ ...g, noteIds: [...g.noteIds] }));
    const delta = diffGroupsDelta(prev, next);
    expect(delta).toEqual({ upserted: [], removedIds: [], membership: [] });
  });

  it("emits one upsert for a rename, without noteIds or collapsed", () => {
    const prev = [group("g1", { noteIds: ["a"], collapsed: true })];
    const next = [{ ...prev[0], name: "New", updatedAt: 2000 }];
    const delta = diffGroupsDelta(prev, next);
    expect(delta.upserted).toEqual([{
      id: "g1", name: "New", createdAt: 1000, orderKey: "m", orderUpdatedAt: 1000, updatedAt: 2000,
    }]);
    expect(delta.membership).toEqual([]);
    expect(delta.removedIds).toEqual([]);
  });

  it("reports deletions as removedIds", () => {
    const delta = diffGroupsDelta([group("g1"), group("g2")], [group("g2")]);
    expect(delta.removedIds).toEqual(["g1"]);
    expect(delta.upserted).toEqual([]);
  });

  it("reports membership as containment ops, not arrays", () => {
    const prev = [group("g1", { noteIds: ["a", "b"] }), group("g2")];
    const next = [
      { ...prev[0], noteIds: ["a"] },
      { ...prev[1], noteIds: ["b", "c"] },
    ];
    const delta = diffGroupsDelta(prev, next, 7777);
    expect(delta.membership).toEqual(expect.arrayContaining([
      { noteId: "b", groupId: "g2", at: 7777 },
      { noteId: "c", groupId: "g2", at: 7777 },
    ]));
    expect(delta.membership).toHaveLength(2);
    expect(delta.upserted).toEqual([]);
  });

  it("an intra-group reorder produces an empty delta (order is not shared state)", () => {
    const prev = [group("g1", { noteIds: ["a", "b"] })];
    const next = [{ ...prev[0], noteIds: ["b", "a"] }];
    expect(diffGroupsDelta(prev, next)).toEqual({ upserted: [], removedIds: [], membership: [] });
  });

  it("a deleted group's notes become ungrouped ops", () => {
    const prev = [group("g1", { noteIds: ["a"] })];
    const delta = diffGroupsDelta(prev, [], 5);
    expect(delta.removedIds).toEqual(["g1"]);
    expect(delta.membership).toEqual([{ noteId: "a", groupId: null, at: 5 }]);
  });
});
