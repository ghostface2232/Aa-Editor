import type { NoteDoc, NoteGroup, TrashedNote } from "./noteTypes";

export type LibraryCommitOrigin = "hydrate" | "local" | "remote" | "reconcile";

type StoredDoc = Readonly<NoteDoc>;
type StoredGroup = Readonly<Omit<NoteGroup, "noteIds">> & {
  readonly noteIds: readonly string[];
};
type StoredTrashedNote = Readonly<TrashedNote>;

export interface LibraryData {
  readonly docs: readonly StoredDoc[];
  readonly groups: readonly StoredGroup[];
  readonly trashedNotes: readonly StoredTrashedNote[];
  readonly activeNoteId: string | null;
}

export interface LibrarySnapshot extends LibraryData {
  readonly revision: number;
  /** Hydration epoch. Reloading or resetting the same path also increments it. */
  readonly directoryGeneration: number;
  readonly notesDirectory: string | null;
  readonly origin: LibraryCommitOrigin;
}

export interface LibraryCommitToken {
  readonly revision: number;
  readonly directoryGeneration: number;
}

export interface LibraryPatch {
  readonly docs?: LibraryData["docs"];
  readonly groups?: LibraryData["groups"];
  readonly trashedNotes?: LibraryData["trashedNotes"];
  readonly activeNoteId?: string | null;
}

export type LibraryUpdater = (current: LibrarySnapshot) => LibraryPatch | null;

export interface LibraryStore {
  getSnapshot(): LibrarySnapshot;
  getToken(): LibraryCommitToken;
  commit(update: LibraryPatch | LibraryUpdater, origin: LibraryCommitOrigin): LibrarySnapshot;
  commitIfCurrent(
    token: LibraryCommitToken,
    update: LibraryPatch | LibraryUpdater,
    origin: LibraryCommitOrigin,
  ): LibrarySnapshot | null;
  commitForGeneration(
    directoryGeneration: number,
    update: LibraryPatch | LibraryUpdater,
    origin: LibraryCommitOrigin,
  ): LibrarySnapshot | null;
  seedDirectory(
    notesDirectory: string,
    data: LibraryData,
    origin?: LibraryCommitOrigin,
  ): LibrarySnapshot;
  clearDirectory(origin?: LibraryCommitOrigin): LibrarySnapshot;
  subscribe(listener: () => void): () => void;
}

function hasOwn<K extends keyof LibraryPatch>(patch: LibraryPatch, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function requiredPatchValue<K extends keyof LibraryPatch>(patch: LibraryPatch, key: K) {
  const value = patch[key];
  if (value === undefined) {
    throw new TypeError(`libraryStore: ${key} cannot be undefined`);
  }
  return value;
}

function normalizeActiveNoteId(
  docs: readonly StoredDoc[],
  requested: string | null,
): string | null {
  if (requested && docs.some((doc) => doc.id === requested)) return requested;
  return docs[0]?.id ?? null;
}

function freezeSnapshot(snapshot: LibrarySnapshot): LibrarySnapshot {
  return Object.freeze(snapshot);
}

export function createLibraryStore(initial: Partial<LibrarySnapshot> = {}): LibraryStore {
  const ownedDocs = new WeakSet<object>();
  const ownedGroups = new WeakSet<object>();
  const ownedTrashedNotes = new WeakSet<object>();

  const copyDocs = (docs: readonly StoredDoc[]): readonly StoredDoc[] => Object.freeze(
    docs.map((doc) => {
      if (ownedDocs.has(doc)) return doc;
      const copy = Object.freeze({ ...doc });
      ownedDocs.add(copy);
      return copy;
    }),
  );
  const copyGroups = (groups: readonly StoredGroup[]): readonly StoredGroup[] => Object.freeze(
    groups.map((group) => {
      if (ownedGroups.has(group)) return group;
      const copy = Object.freeze({
        ...group,
        noteIds: Object.freeze([...group.noteIds]),
      });
      ownedGroups.add(copy);
      return copy;
    }),
  );
  const copyTrashedNotes = (
    notes: readonly StoredTrashedNote[],
  ): readonly StoredTrashedNote[] => Object.freeze(
    notes.map((note) => {
      if (ownedTrashedNotes.has(note)) return note;
      const copy = Object.freeze({ ...note });
      ownedTrashedNotes.add(copy);
      return copy;
    }),
  );

  const initialDocs = copyDocs(initial.docs ?? []);
  let snapshot = freezeSnapshot({
    docs: initialDocs,
    groups: copyGroups(initial.groups ?? []),
    trashedNotes: copyTrashedNotes(initial.trashedNotes ?? []),
    activeNoteId: normalizeActiveNoteId(initialDocs, initial.activeNoteId ?? null),
    revision: initial.revision ?? 0,
    directoryGeneration: initial.directoryGeneration ?? 0,
    notesDirectory: initial.notesDirectory ?? null,
    origin: initial.origin ?? "hydrate",
  });
  const listeners = new Set<() => void>();
  let updaterDepth = 0;

  const assertMutationAllowed = () => {
    if (updaterDepth > 0) {
      throw new Error("libraryStore: commit updaters must not mutate the store reentrantly");
    }
  };

  const publish = (next: LibrarySnapshot): LibrarySnapshot => {
    snapshot = next;
    for (const listener of listeners) listener();
    // A listener may commit reentrantly. The initiating commit still returns
    // its own revision token; getSnapshot() exposes any later nested commit.
    return next;
  };

  const commit = (
    update: LibraryPatch | LibraryUpdater,
    origin: LibraryCommitOrigin,
  ): LibrarySnapshot => {
    assertMutationAllowed();
    const base = snapshot;
    let patch: LibraryPatch | null;
    if (typeof update === "function") {
      updaterDepth += 1;
      try {
        patch = update(base);
      } finally {
        updaterDepth -= 1;
      }
    } else {
      patch = update;
    }
    if (!patch) return snapshot;

    const docsInput = hasOwn(patch, "docs")
      ? requiredPatchValue(patch, "docs")
      : snapshot.docs;
    const groupsInput = hasOwn(patch, "groups")
      ? requiredPatchValue(patch, "groups")
      : snapshot.groups;
    const trashedInput = hasOwn(patch, "trashedNotes")
      ? requiredPatchValue(patch, "trashedNotes")
      : snapshot.trashedNotes;
    const requestedActive = hasOwn(patch, "activeNoteId")
      ? requiredPatchValue(patch, "activeNoteId")
      : snapshot.activeNoteId;
    const normalizedActive = normalizeActiveNoteId(docsInput, requestedActive);
    if (
      docsInput === snapshot.docs
      && groupsInput === snapshot.groups
      && trashedInput === snapshot.trashedNotes
      && normalizedActive === snapshot.activeNoteId
    ) {
      return snapshot;
    }

    return publish(freezeSnapshot({
      ...snapshot,
      docs: docsInput === snapshot.docs ? snapshot.docs : copyDocs(docsInput),
      groups: groupsInput === snapshot.groups ? snapshot.groups : copyGroups(groupsInput),
      trashedNotes: trashedInput === snapshot.trashedNotes
        ? snapshot.trashedNotes
        : copyTrashedNotes(trashedInput),
      activeNoteId: normalizedActive,
      revision: snapshot.revision + 1,
      origin,
    }));
  };

  return {
    getSnapshot: () => snapshot,
    getToken: () => ({
      revision: snapshot.revision,
      directoryGeneration: snapshot.directoryGeneration,
    }),
    commit,

    commitIfCurrent(token, update, origin) {
      assertMutationAllowed();
      if (
        token.revision !== snapshot.revision
        || token.directoryGeneration !== snapshot.directoryGeneration
      ) {
        return null;
      }
      return commit(update, origin);
    },

    commitForGeneration(directoryGeneration, update, origin) {
      assertMutationAllowed();
      if (directoryGeneration !== snapshot.directoryGeneration) return null;
      return commit(update, origin);
    },

    seedDirectory(notesDirectory, data, origin = "hydrate") {
      assertMutationAllowed();
      const docs = copyDocs(data.docs);
      return publish(freezeSnapshot({
        docs,
        groups: copyGroups(data.groups),
        trashedNotes: copyTrashedNotes(data.trashedNotes),
        activeNoteId: normalizeActiveNoteId(docs, data.activeNoteId),
        revision: snapshot.revision + 1,
        directoryGeneration: snapshot.directoryGeneration + 1,
        notesDirectory,
        origin,
      }));
    },

    clearDirectory(origin = "hydrate") {
      assertMutationAllowed();
      return publish(freezeSnapshot({
        docs: Object.freeze([]),
        groups: Object.freeze([]),
        trashedNotes: Object.freeze([]),
        activeNoteId: null,
        revision: snapshot.revision + 1,
        directoryGeneration: snapshot.directoryGeneration + 1,
        notesDirectory: null,
        origin,
      }));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const libraryStore = createLibraryStore();
