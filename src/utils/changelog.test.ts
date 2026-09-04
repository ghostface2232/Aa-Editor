import { describe, it, expect } from "vitest";
import { changelogLines, getBundledChangelog, parseChangelogNotes } from "./changelog";

describe("parseChangelogNotes", () => {
  it("parses notes carrying both locales", () => {
    const notes = JSON.stringify({ ko: ["가"], en: ["a"] });
    expect(parseChangelogNotes(notes)).toEqual({ ko: ["가"], en: ["a"] });
  });

  it("returns null for empty, plain-text, or legacy notes", () => {
    expect(parseChangelogNotes(null)).toBeNull();
    expect(parseChangelogNotes("")).toBeNull();
    expect(parseChangelogNotes("## What's new\n- something")).toBeNull();
    expect(parseChangelogNotes("[1, 2]")).toBeNull();
  });

  it("rejects a half-translated or malformed changelog", () => {
    expect(parseChangelogNotes(JSON.stringify({ ko: ["가"] }))).toBeNull();
    expect(parseChangelogNotes(JSON.stringify({ ko: ["가"], en: [""] }))).toBeNull();
    expect(parseChangelogNotes(JSON.stringify({ ko: ["가"], en: [3] }))).toBeNull();
  });

  it("treats an empty locale as a miss so the raw body still shows", () => {
    expect(parseChangelogNotes(JSON.stringify({ ko: [], en: [] }))).toBeNull();
    expect(parseChangelogNotes(JSON.stringify({ ko: ["가"], en: [] }))).toBeNull();
  });

  it("rejects notes too large to render", () => {
    const many = Array.from({ length: 21 }, (_, n) => `line ${n}`);
    expect(parseChangelogNotes(JSON.stringify({ ko: many, en: many }))).toBeNull();
    const long = "x".repeat(301);
    expect(parseChangelogNotes(JSON.stringify({ ko: [long], en: ["a"] }))).toBeNull();
  });

  it("accepts notes at the size limits", () => {
    const twenty = Array.from({ length: 20 }, (_, n) => `line ${n}`);
    expect(parseChangelogNotes(JSON.stringify({ ko: twenty, en: twenty }))).not.toBeNull();
    const long = "x".repeat(300);
    expect(parseChangelogNotes(JSON.stringify({ ko: [long], en: [long] }))).not.toBeNull();
  });

  it("ignores a payload trying to reach the prototype", () => {
    const parsed = parseChangelogNotes('{"ko":["가"],"en":["a"],"__proto__":{"polluted":true}}');
    expect(parsed).toEqual({ ko: ["가"], en: ["a"] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("bundled changelog", () => {
  it("ships the same number of lines in both locales", () => {
    const bundled = getBundledChangelog();
    expect(bundled.ko.length).toBeGreaterThan(0);
    expect(bundled.en.length).toBe(bundled.ko.length);
  });

  it("selects lines by locale", () => {
    const changelog = { ko: ["가"], en: ["a"] };
    expect(changelogLines(changelog, "ko")).toEqual(["가"]);
    expect(changelogLines(changelog, "en")).toEqual(["a"]);
  });
});
