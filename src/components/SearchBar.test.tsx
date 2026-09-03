import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SearchHighlight } from "../extensions/SearchHighlight";
import { SearchBar } from "./SearchBar";

let active: Editor | null = null;

afterEach(() => {
  cleanup();
  active?.destroy();
  active = null;
});

function makeEditor(content: string) {
  const editor = new Editor({ extensions: [StarterKit, SearchHighlight], content });
  active = editor;
  return editor;
}

function bar(editor: Editor, onNotice: () => void, focusNonce = 0) {
  return (
    <FluentProvider theme={webLightTheme}>
      <SearchBar
        editor={editor}
        onClose={vi.fn()}
        replaceOpen
        onToggleReplace={vi.fn()}
        locale="en"
        onNotice={onNotice}
        focusNonce={focusNonce}
      />
    </FluentProvider>
  );
}

function renderBar(content: string, onNotice = vi.fn()) {
  const editor = makeEditor(content);
  const view = render(bar(editor, onNotice));
  const [findInput, replaceInput] = screen.getAllByRole("textbox");
  return { editor, view, onNotice, findInput, replaceInput };
}

function counter() {
  // The visible counter is aria-hidden, so it is addressed by its text.
  return screen.getByText(/^\d+\/\d+$/);
}

/**
 * Griffel hashes class names, so the no-match state is detected by comparing
 * against the classes the counter wears while it has matches: the styles differ
 * by exactly the color rule.
 */
function baselineCounterClass(content: string, query: string) {
  const { findInput } = renderBar(content);
  fireEvent.change(findInput, { target: { value: query } });
  const className = counter().className;
  cleanup();
  active?.destroy();
  active = null;
  return className;
}

describe("match counter", () => {
  it("reports the active match and the total", () => {
    const { findInput } = renderBar("<p>foo bar foo</p>");
    fireEvent.change(findInput, { target: { value: "foo" } });

    expect(counter().textContent).toBe("1/2");
    expect(screen.getByRole("status").textContent).toBe("Match 1 of 2");
  });

  it("wraps backwards from the first match to the last", () => {
    const { findInput } = renderBar("<p>foo bar foo</p>");
    fireEvent.change(findInput, { target: { value: "foo" } });
    fireEvent.keyDown(findInput, { key: "Enter", shiftKey: true });

    expect(counter().textContent).toBe("2/2");
  });

  it("marks a query that matches nothing", () => {
    const baseline = baselineCounterClass("<p>foo bar foo</p>", "foo");
    const { findInput } = renderBar("<p>foo bar</p>");
    fireEvent.change(findInput, { target: { value: "zzz" } });

    expect(counter().textContent).toBe("0/0");
    expect(screen.getByRole("status").textContent).toBe("No matches");
    expect(counter().className).not.toBe(baseline);
  });

  it("does not mark a replace that consumed every match", () => {
    const baseline = baselineCounterClass("<p>foo bar foo</p>", "foo");
    const { findInput, replaceInput } = renderBar("<p>foo bar foo</p>");
    fireEvent.change(findInput, { target: { value: "foo" } });
    fireEvent.change(replaceInput, { target: { value: "baz" } });
    fireEvent.keyDown(replaceInput, { key: "Enter", ctrlKey: true });

    expect(counter().textContent).toBe("0/0");
    expect(counter().className).toBe(baseline);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("marks a miss again once the query changes after a replace", () => {
    const baseline = baselineCounterClass("<p>foo bar foo</p>", "foo");
    const { findInput, replaceInput } = renderBar("<p>foo bar foo</p>");
    fireEvent.change(findInput, { target: { value: "foo" } });
    fireEvent.change(replaceInput, { target: { value: "baz" } });
    fireEvent.keyDown(replaceInput, { key: "Enter", ctrlKey: true });
    fireEvent.change(findInput, { target: { value: "zzz" } });

    expect(counter().className).not.toBe(baseline);
    expect(screen.getByRole("status").textContent).toBe("No matches");
  });
});

describe("replace all", () => {
  it("reports how many matches it replaced", () => {
    const { onNotice, editor, findInput, replaceInput } = renderBar("<p>foo bar foo</p>");
    fireEvent.change(findInput, { target: { value: "foo" } });
    fireEvent.change(replaceInput, { target: { value: "baz" } });
    fireEvent.keyDown(replaceInput, { key: "Enter", ctrlKey: true });

    expect(onNotice).toHaveBeenCalledWith("Replaced 2 matches");
    expect(editor.state.doc.textContent).toBe("baz bar baz");
  });

  it("counts overlapping matches only as often as it replaces them", () => {
    const { onNotice, editor, findInput, replaceInput } = renderBar("<p>aaaa</p>");
    fireEvent.change(findInput, { target: { value: "aa" } });
    fireEvent.change(replaceInput, { target: { value: "b" } });
    fireEvent.keyDown(replaceInput, { key: "Enter", ctrlKey: true });

    expect(onNotice).toHaveBeenCalledWith("Replaced 2 matches");
    expect(editor.state.doc.textContent).toBe("bb");
  });
});

describe("controls", () => {
  it("names every button and reports the replace row as expanded", () => {
    renderBar("<p>foo</p>");

    expect(screen.getByLabelText("Previous match")).toBeTruthy();
    expect(screen.getByLabelText("Next match")).toBeTruthy();
    expect(screen.getByLabelText("Close find")).toBeTruthy();
    expect(screen.getByLabelText("Replace").getAttribute("aria-expanded")).toBe("true");
  });

  it("takes focus back and selects the query when asked", () => {
    const { editor, view, onNotice, findInput, replaceInput } = renderBar("<p>foo</p>");
    fireEvent.change(findInput, { target: { value: "foo" } });
    replaceInput.focus();
    expect(document.activeElement).toBe(replaceInput);

    view.rerender(bar(editor, onNotice, 1));

    expect(document.activeElement).toBe(findInput);
    expect((findInput as HTMLInputElement).selectionStart).toBe(0);
    expect((findInput as HTMLInputElement).selectionEnd).toBe(3);
  });

  it("toggles match case from the input with Alt+C", () => {
    const { findInput } = renderBar("<p>Foo foo</p>");
    fireEvent.change(findInput, { target: { value: "foo" } });
    expect(counter().textContent).toBe("1/2");

    fireEvent.keyDown(findInput, { key: "c", altKey: true });

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(counter().textContent).toBe("1/1");
  });
});
