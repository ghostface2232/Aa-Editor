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
