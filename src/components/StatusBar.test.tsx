import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor as ReactEditor } from "@tiptap/react";
import { StatusBar } from "./StatusBar";

let active: Editor | null = null;

afterEach(() => {
  cleanup();
  active?.destroy();
  active = null;
});

function makeEditor() {
  const editor = new Editor({
    extensions: [StarterKit],
    content: "<p>alpha</p><p>beta</p>",
  });
  active = editor;
  return editor;
}

function status(editor: Editor, hidden = false) {
  return (
    <FluentProvider theme={webLightTheme}>
      <StatusBar editor={editor as unknown as ReactEditor} hidden={hidden} locale="en" />
    </FluentProvider>
  );
}

describe("StatusBar subscriptions and document work", () => {
  it("does not subscribe while hidden and refreshes when shown", async () => {
    const editor = makeEditor();
    const onSpy = vi.spyOn(editor, "on");
    const offSpy = vi.spyOn(editor, "off");
    const view = render(status(editor, true));

    expect(onSpy).not.toHaveBeenCalledWith("transaction", expect.any(Function));

    view.rerender(status(editor, false));
    await waitFor(() => expect(screen.getByText(/9/)).toBeTruthy());
    expect(onSpy).toHaveBeenCalledWith("transaction", expect.any(Function));

    view.rerender(status(editor, true));
    expect(offSpy).toHaveBeenCalledWith("transaction", expect.any(Function));
  });

  it("reuses document-wide counts for a selection-only transaction", async () => {
    const editor = makeEditor();
    render(status(editor));
    await waitFor(() => expect(screen.getByText(/9/)).toBeTruthy());

    const doc = editor.state.doc;
    const textContentSpy = vi.spyOn(doc, "textContent", "get");

    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)),
      );
    });

    await waitFor(() => expect(screen.getByText(/Line 2/)).toBeTruthy());
    expect(textContentSpy).not.toHaveBeenCalled();
  });

  it("recomputes document-wide counts after a content change", async () => {
    const editor = makeEditor();
    render(status(editor));
    await waitFor(() => expect(screen.getByText(/9/)).toBeTruthy());

    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("!", 6));
    });

    await waitFor(() => expect(screen.getByText(/10/)).toBeTruthy());
  });
});
