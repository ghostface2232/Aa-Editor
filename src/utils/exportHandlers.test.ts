import { describe, it, expect } from "vitest";
import { cloneEditorContentForExport } from "./exportHandlers";

function editorWith(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "ProseMirror";
  el.innerHTML = html;
  return el;
}

describe("cloneEditorContentForExport", () => {
  it("unwraps search-match decorations but keeps their text", () => {
    const el = editorWith(
      '<p>find <span class="search-match">needle</span> and <span class="search-match-active">needle</span></p>',
    );
    const clone = cloneEditorContentForExport(el);

    expect(clone.querySelector(".search-match")).toBeNull();
    expect(clone.querySelector(".search-match-active")).toBeNull();
    expect(clone.textContent).toBe("find needle and needle");
  });

  it("keeps document markup and inline marks intact", () => {
    const el = editorWith(
      '<h1>Title</h1><p><strong>bold</strong> <em><span class="search-match">hit</span></em></p>',
    );
    const clone = cloneEditorContentForExport(el);

    expect(clone.querySelector("h1")?.textContent).toBe("Title");
    expect(clone.querySelector("strong")?.textContent).toBe("bold");
    expect(clone.querySelector("em")?.textContent).toBe("hit");
    expect(clone.querySelector(".search-match")).toBeNull();
  });

  it("unwraps nested decoration spans", () => {
    const el = editorWith(
      '<p><span class="search-match">outer <span class="search-match-active">inner</span></span></p>',
    );
    const clone = cloneEditorContentForExport(el);

    expect(clone.querySelectorAll("span").length).toBe(0);
    expect(clone.textContent).toBe("outer inner");
  });

  it("does not mutate the live editor DOM", () => {
    const el = editorWith('<p><span class="search-match">hit</span></p>');
    cloneEditorContentForExport(el);

    expect(el.querySelector(".search-match")).not.toBeNull();
  });
});
