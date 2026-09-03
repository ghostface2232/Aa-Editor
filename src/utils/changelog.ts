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

export function getBundledChangelog(): Changelog {
  return BUNDLED;
}

function isLineArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((line) => typeof line === "string" && line.trim() !== "");
}

/**
 * Parses updater notes carrying a changelog. Returns null for anything else —
 * releases published before this format, or hand-written plain-text notes —
 * so callers can fall back to rendering the raw body.
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
