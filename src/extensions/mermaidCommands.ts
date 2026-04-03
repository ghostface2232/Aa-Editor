import type { Editor } from "@tiptap/core";

export const DEFAULT_MERMAID_SNIPPET = "flowchart TD\n  A[Start] --> B[End]";

function isEmptyParentBlock(editor: Editor): boolean {
  if (!editor.state.selection.empty) {
    return false;
  }

  return editor.state.selection.$from.parent.textContent.trim().length === 0;
}

export function insertMermaidCodeBlock(editor: Editor) {
  const shouldInsertTemplate = isEmptyParentBlock(editor);

  if (editor.isActive("codeBlock")) {
    const chain = editor.chain().focus().updateAttributes("codeBlock", { language: "mermaid" });
    if (shouldInsertTemplate) {
      chain.insertContent(DEFAULT_MERMAID_SNIPPET);
    }
    chain.run();
    return;
  }

  const chain = editor.chain().focus().setCodeBlock({ language: "mermaid" });
  if (shouldInsertTemplate) {
    chain.insertContent(DEFAULT_MERMAID_SNIPPET);
  }
  chain.run();
}
