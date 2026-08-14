const blockedNoteCounts = new Map<string, number>();

export function blockNoteLifecycle(noteIds: readonly string[]): () => void {
  const ids = Array.from(new Set(noteIds));
  for (const id of ids) blockedNoteCounts.set(id, (blockedNoteCounts.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of ids) {
      const next = (blockedNoteCounts.get(id) ?? 1) - 1;
      if (next <= 0) blockedNoteCounts.delete(id);
      else blockedNoteCounts.set(id, next);
    }
  };
}

export function isNoteLifecycleBlocked(noteId: string): boolean {
  return blockedNoteCounts.has(noteId);
}
