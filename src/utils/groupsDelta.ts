import type { NoteGroup } from "./noteTypes";

export type GroupUpsert = Omit<NoteGroup, "collapsed" | "noteIds">;

export interface GroupMembershipOp {
  noteId: string;
  /** Target group, or null for "removed from every group". */
  groupId: string | null;
  at: number;
}

export interface GroupsDelta {
  upserted: GroupUpsert[];
  removedIds: string[];
  membership: GroupMembershipOp[];
}

/**
 * Computes the delta between an updater's own `prev` argument and the array it
 * committed. Value-diff on the shared meta fields (never reference-diff — the
 * store adapter clones every entry before the updater, so references over-
 * flag) plus a containment diff for membership, so an intra-group reorder
 * (order is not shared state) produces an empty delta.
 */
type GroupLike = Omit<NoteGroup, "noteIds"> & { noteIds: readonly string[] };

export function diffGroupsDelta(
  prev: readonly GroupLike[],
  next: readonly GroupLike[],
  at = Date.now(),
): GroupsDelta {
  const prevById = new Map(prev.map((g) => [g.id, g]));
  const nextIds = new Set(next.map((g) => g.id));
  const removedIds = prev.filter((g) => !nextIds.has(g.id)).map((g) => g.id);
  const upserted: GroupUpsert[] = [];
  for (const g of next) {
    const p = prevById.get(g.id);
    if (
      !p
      || p.name !== g.name
      || p.createdAt !== g.createdAt
      || p.orderKey !== g.orderKey
      || p.orderUpdatedAt !== g.orderUpdatedAt
      || p.updatedAt !== g.updatedAt
    ) {
      upserted.push({
        id: g.id,
        name: g.name,
        createdAt: g.createdAt,
        orderKey: g.orderKey,
        orderUpdatedAt: g.orderUpdatedAt,
        updatedAt: g.updatedAt,
      });
    }
  }
  const groupOf = (groups: readonly GroupLike[]) => {
    const map = new Map<string, string>();
    for (const g of groups) for (const noteId of g.noteIds) map.set(noteId, g.id);
    return map;
  };
  const prevGroupOf = groupOf(prev);
  const nextGroupOf = groupOf(next);
  const membership: GroupMembershipOp[] = [];
  for (const noteId of new Set([...prevGroupOf.keys(), ...nextGroupOf.keys()])) {
    const before = prevGroupOf.get(noteId) ?? null;
    const after = nextGroupOf.get(noteId) ?? null;
    if (before !== after) membership.push({ noteId, groupId: after, at });
  }
  return { upserted, removedIds, membership };
}
