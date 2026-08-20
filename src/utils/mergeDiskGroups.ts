// Clock-based merge of on-disk group state into the current in-memory groups.
//
// The watcher's reloadGroupsFromDisk used to commit the disk-derived array
// absolutely. Its reads take seconds on a cloud placeholder, and both local
// mutations (useNoteGroups.persist) and peer `groups-updated` deltas commit to
// the canonical store synchronously in that window — an absolute commit erased
// them. Worse, the erasure was durable in one ordering: syncGroupsSnapshotFromDisk
// resets the write snapshot to disk state first, so the enqueued persist found
// the reverted store snapshot-equal and skipped the write, and a reload racing
// a local delete resurrected the group and cancelled its pending tombstone.
//
// This module applies the disk state through the same per-field clock rules
// `mergeGroupEntries` uses on disk and the `groups-updated` receiver uses for
// peer deltas: name via `updatedAt`, order via `orderKey`+`orderUpdatedAt`,
// `createdAt` min, deletedAt never un-set. It is pure and Tauri-free so it can
// run inside a functional store updater — the commit is then computed against
// the store's live `prev` at commit time, and there is no drift window at all.
//
// Limit: membership carries no local clock to defend with (name/order do), so
// the pending-intent shield covers only UNCONSUMED intents. A sidecar read
// that went stale during the multi-second readAllMeta can revert a membership
// change whose intent a persist consumed between the read and this commit.
// That revert is transient, not durable: persist-time resolution prefers the
// disk sidecar (which already holds the new value), and the next reconcile
// re-converges.
import type { NoteGroup } from "./noteTypes";
import type { SharedGroupEntry } from "./groupsIO";
import type { NoteMeta } from "./metadataIO";

export interface DiskGroupsMergeInput {
  /** Raw `.groups.json` entries, INCLUDING tombstoned ones. The tombstone /
   *  absent distinction is load-bearing: a tombstoned entry removes the local
   *  group (delete wins), while an entry merely absent from disk keeps it (a
   *  locally created or peer-delta group whose persist hasn't landed yet). */
  entries: Readonly<Record<string, SharedGroupEntry>>;
  /** Every per-note sidecar on disk; membership + its clock live here. */
  metaById: ReadonlyMap<string, NoteMeta>;
  /** Per-machine collapsed ui-state, used only when inserting a disk group
   *  this window doesn't know yet. Existing groups keep their own flag. */
  collapsedByGroup: Readonly<Record<string, boolean>>;
  /** Groups deleted locally whose tombstone hasn't been persisted yet
   *  (persistState.pendingTombstones). A naive merge would resurrect them
   *  from the still-alive disk entry — and the resurrection would then
   *  cancel the pending tombstone at persist time. */
  pendingTombstoneIds: ReadonlySet<string>;
  /** Local membership intents not yet written to sidecars
   *  (persistState.pendingGroupMembership). They win over disk, matching the
   *  persist layer's own resolution order. */
  pendingMembership: ReadonlyMap<string, { groupId: string | null; updatedAt: number }>;
  /** Ids of docs currently live in the canonical store. A prev member with no
   *  sidecar on disk keeps its in-memory membership only while its doc is
   *  live (mid-creation grace, mirroring hydrateGroupMembershipFromMeta). */
  liveDocIds: ReadonlySet<string>;
}

function sameNoteIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Merge disk group state into `prev`. Returns the SAME `prev` array instance
 * when nothing changed so the store adapter can skip the commit.
 */
export function mergeDiskGroups(
  prev: NoteGroup[],
  input: DiskGroupsMergeInput,
): NoteGroup[] {
  let groups: NoteGroup[] = [...prev];
  let changed = false;
  let orderDirty = false;

  // 1. Removals — a disk tombstone wins over everything (deletedAt is never
  //    un-set), same as the receiver's removedIds step.
  const tombstoned = new Set<string>();
  for (const entry of Object.values(input.entries)) {
    if (entry.deletedAt != null) tombstoned.add(entry.id);
  }
  if (tombstoned.size > 0 && groups.some((g) => tombstoned.has(g.id))) {
    groups = groups.filter((g) => !tombstoned.has(g.id));
    changed = true;
  }

  // 2. Upserts — per-field clocks, exactly mergeGroupEntries' rules. A disk
  //    entry for a group deleted locally but not yet persisted is skipped:
  //    resurrecting it would also cancel the pending tombstone at persist
  //    time, silently undoing the delete.
  for (const entry of Object.values(input.entries)) {
    if (entry.deletedAt != null) continue;
    if (input.pendingTombstoneIds.has(entry.id)) continue;
    const idx = groups.findIndex((g) => g.id === entry.id);
    if (idx < 0) {
      groups = [...groups, {
        id: entry.id,
        name: entry.name,
        noteIds: [],
        collapsed: !!input.collapsedByGroup[entry.id],
        createdAt: entry.createdAt,
        orderKey: entry.orderKey,
        orderUpdatedAt: entry.orderUpdatedAt,
        updatedAt: entry.updatedAt,
      }];
      changed = true;
      orderDirty = true;
      continue;
    }
    const local = groups[idx];
    let next = local;
    if (entry.updatedAt > (local.updatedAt ?? 0)) {
      next = { ...next, name: entry.name, updatedAt: entry.updatedAt };
    }
    if (entry.orderUpdatedAt > (local.orderUpdatedAt ?? 0)) {
      next = { ...next, orderKey: entry.orderKey, orderUpdatedAt: entry.orderUpdatedAt };
      orderDirty = true;
    }
    if (entry.createdAt < next.createdAt) {
      // createdAt is the comparator's tiebreaker, so adopting the older
      // creation time can change the group's position too.
      next = { ...next, createdAt: entry.createdAt };
      orderDirty = true;
    }
    if (next !== local) {
      groups = groups.map((g, i) => (i === idx ? next : g));
      changed = true;
    }
  }
  // Groups in `prev` with no disk entry at all are passed through untouched:
  // they are locally created (or peer-delta) groups whose persist hasn't
  // landed yet — dropping them was the create-loss half of the old bug.

  // 3. Membership — resolve one target group per note. Resolution order
  //    mirrors the persist layer (decomposedState's group snapshot), with the
  //    remote-trash check hoisted ahead of it: a trashed sidecar ungroups,
  //    then a pending local intent wins over disk, then the sidecar decides;
  //    a live doc with no sidecar yet keeps its in-memory spot.
  const prevGroupByNote = new Map<string, string>();
  for (const g of groups) {
    for (const id of g.noteIds) {
      if (!prevGroupByNote.has(id)) prevGroupByNote.set(id, g.id);
    }
  }
  const targetByNote = new Map<string, string | null>();
  const universe = new Set<string>(prevGroupByNote.keys());
  for (const [id, meta] of input.metaById) {
    if (meta.trashedAt == null && meta.groupId) universe.add(id);
  }
  for (const id of input.pendingMembership.keys()) universe.add(id);
  for (const noteId of universe) {
    const meta = input.metaById.get(noteId);
    // A remote trash ungroups ahead of any pending intent — the same
    // precedence applyMetaChange and hydrateGroupMembershipFromMeta apply, so
    // a meta event and a .groups.json event can't disagree about the note.
    if (meta?.trashedAt != null) {
      targetByNote.set(noteId, null);
      continue;
    }
    const pending = input.pendingMembership.get(noteId);
    if (pending) {
      targetByNote.set(noteId, pending.groupId);
      continue;
    }
    if (meta) {
      targetByNote.set(noteId, meta.groupId ?? null);
      continue;
    }
    targetByNote.set(
      noteId,
      input.liveDocIds.has(noteId) ? (prevGroupByNote.get(noteId) ?? null) : null,
    );
  }

  const withMembership = groups.map((g) => {
    const kept = g.noteIds.filter((id) => targetByNote.get(id) === g.id);
    const added: string[] = [];
    for (const [id, target] of targetByNote) {
      if (target === g.id && !g.noteIds.includes(id)) added.push(id);
    }
    const noteIds = added.length > 0 ? [...kept, ...added] : kept;
    return sameNoteIds(g.noteIds, noteIds) ? g : { ...g, noteIds };
  });
  if (withMembership.some((g, i) => g !== groups[i])) {
    groups = withMembership;
    changed = true;
  }

  if (!changed) return prev;
  // Array order IS the render order; an insert or an adopted orderKey /
  // createdAt re-sorts with the same comparator buildGroupsFromShared uses.
  if (orderDirty) {
    groups = [...groups].sort((a, b) => {
      const ak = a.orderKey ?? "";
      const bk = b.orderKey ?? "";
      if (ak === bk) return a.createdAt - b.createdAt;
      return ak < bk ? -1 : 1;
    });
  }
  return groups;
}
