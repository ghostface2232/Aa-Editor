import type { NoteDoc } from "./noteTypes";

/**
 * Cheap change-detector for "could the sidebar order have moved?".
 *
 * The re-sort effect in App.tsx runs on every `docs` change, including the one
 * every autosave commit produces. Building a delimited string of the sort-
 * relevant fields allocated a fresh multi-hundred-kilobyte string per commit on
 * a large library, purely to be thrown away. Two independent 32-bit FNV-1a
 * accumulators over the same fields answer the same question with no
 * per-document allocation; the pair plus the document count makes an accidental
 * collision (which would only delay a re-sort until the next change, never lose
 * data) not a practical concern.
 */
export function sortSignature(
  docs: readonly NoteDoc[],
  notesSortOrder: string,
  locale: string,
): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  const mix = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 0x01000193);
      h2 = Math.imul(h2 + code, 0x85ebca6b) ^ (h2 >>> 13);
    }
    // Field separator, so "ab"+"c" and "a"+"bc" cannot collide.
    h1 = Math.imul(h1 ^ 0x1f, 0x01000193);
    h2 = Math.imul(h2 + 0x1f, 0x85ebca6b) ^ (h2 >>> 13);
  };

  const mixNumber = (value: number): void => {
    h1 = Math.imul(h1 ^ (value | 0), 0x01000193);
    h1 = Math.imul(h1 ^ Math.floor(value / 0x100000000), 0x01000193);
    h2 = Math.imul(h2 + (value | 0), 0x85ebca6b) ^ (h2 >>> 13);
  };

  mix(notesSortOrder);
  mix(locale);
  for (const doc of docs) {
    mix(doc.id);
    mix(doc.fileName);
    mixNumber(doc.updatedAt);
    mixNumber(doc.createdAt);
    mixNumber(doc.pinned ? 1 : 0);
  }

  return `${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}:${docs.length}`;
}
