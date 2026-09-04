import bundledChangelog from "../../changelog.json";
import type { Locale } from "../hooks/useSettings";

/**
 * Per-locale release highlights. The bundled copy describes the running build;
 * the same JSON also travels in the updater manifest's `notes` field, so the
 * About tab can show the *next* version's highlights before installing it.
 */
export interface Changelog {
  ko: string[];
  en: string[];
}

const BUNDLED: Changelog = bundledChangelog;

/**
 * Caps for notes arriving over the network. latest.json is not covered by the
 * update payload's signature, so anyone who can write to the release endpoint
 * can put arbitrary text here without holding the signing key; these bounds keep
 * that from turning into a hung renderer.
 */
const MAX_LINES = 20;
const MAX_LINE_LENGTH = 300;

export function getBundledChangelog(): Changelog {
  return BUNDLED;
}

function isLineArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_LINES &&
    value.every((line) => typeof line === "string" && line.trim() !== "" && line.length <= MAX_LINE_LENGTH)
  );
}

/**
 * Parses updater notes carrying a changelog. Returns null for anything else —
 * releases published before this format, hand-written plain-text notes, or a
 * changelog whose shape or size is off — so callers can fall back to rendering
 * the raw body. An empty locale is a miss, not an empty changelog: otherwise a
 * mistyped release would render a blank panel with no fallback.
 */
export function parseChangelogNotes(notes: string | null | undefined): Changelog | null {
  if (!notes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(notes);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { ko, en } = parsed as Record<string, unknown>;
  if (!isLineArray(ko) || !isLineArray(en)) return null;
  return { ko, en };
}

export function changelogLines(changelog: Changelog, locale: Locale): string[] {
  return locale === "ko" ? changelog.ko : changelog.en;
}
