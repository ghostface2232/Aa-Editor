import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";
import { closeContextMenu, createMenuShell, createMenuItem, createMenuSeparator } from "../utils/contextMenuRegistry";

export interface TextContextMenuContext {
  hasSelection: boolean;
  isEditable: boolean;
  locale: Locale;
  cut: () => void;
  copy: () => void;
  paste: (plain?: boolean) => void;
  selectAll: () => void;
  focus: () => void;
}

export function showGenericContextMenu(pos: { x: number; y: number }, ctx: TextContextMenuContext) {
  const i = (key: Parameters<typeof t>[0]) => t(key, ctx.locale);
  const { menu } = createMenuShell(pos, 200);

  // Fluent UI 20px regular icons
  const iconCut = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M5.5 9a2.5 2.5 0 100 5 2.5 2.5 0 000-5zm-1.5 2.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM14.5 9a2.5 2.5 0 100 5 2.5 2.5 0 000-5zm-1.5 2.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM12.15 8.54l1.7 1.7a.5.5 0 01-.7.71l-3.14-3.14-3.15 3.14a.5.5 0 01-.7-.7l3.5-3.5a.5.5 0 01.35-.15H10V3.5a.5.5 0 011 0V7.5h-.01l1.16 1.04z"/></svg>';
  const iconCopy = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8 2a2 2 0 00-2 2v10a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2H8zM7 4a1 1 0 011-1h6a1 1 0 011 1v10a1 1 0 01-1 1H8a1 1 0 01-1-1V4zM4 6a2 2 0 011-1.73V14.5A2.5 2.5 0 007.5 17h6.23A2 2 0 0112 18H7.5A3.5 3.5 0 014 14.5V6z"/></svg>';
  const iconPaste = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M7.09 3A2.5 2.5 0 019.5 1c1.08 0 2 .69 2.35 1.65l.06.18A1.5 1.5 0 0113.5 4h.5a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h.5c.65 0 1.2-.42 1.41-1h-.82zM9.5 2a1.5 1.5 0 00-1.42 1.01A.5.5 0 018.56 3H6a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6a1 1 0 00-1-1h-2.56a.5.5 0 01-.48-.36A1.5 1.5 0 009.5 2z"/></svg>';
  const iconPastePlain = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M7.09 3A2.5 2.5 0 019.5 1c1.08 0 2 .69 2.35 1.65l.06.18A1.5 1.5 0 0113.5 4h.5a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h.5c.65 0 1.2-.42 1.41-1h-.82zM9.5 2a1.5 1.5 0 00-1.42 1.01A.5.5 0 018.56 3H6a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6a1 1 0 00-1-1h-2.56a.5.5 0 01-.48-.36A1.5 1.5 0 009.5 2zM7 8.5a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5zm0 3a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5z"/></svg>';
  const iconSelectAll = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 6a3 3 0 013-3h8a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3V6zm3-2a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6zm1.5 3a.5.5 0 000 1h5a.5.5 0 000-1h-5zM7 10.5a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5zm.5 2.5a.5.5 0 000 1h3a.5.5 0 000-1h-3z"/></svg>';
  const iconEmoji = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-7 8a7 7 0 1114 0 7 7 0 01-14 0zm4.5-1.5a1 1 0 112 0 1 1 0 01-2 0zm4 0a1 1 0 112 0 1 1 0 01-2 0zm-5.46 3.17a.5.5 0 01.7-.04c.52.46 1.4 1.12 2.76 1.12s2.24-.66 2.76-1.12a.5.5 0 01.66.74C11.34 12.9 10.3 13.75 9.5 13.75c-.8 0-1.84-.85-2.42-1.38a.5.5 0 01-.04-.7z"/></svg>';

  const items: { label: string; shortcut: string | null; icon: string; disabled?: boolean; separator?: boolean; action: () => void }[] = [
    {
      label: i("ctx.cut"), shortcut: "Ctrl+X", icon: iconCut,
      disabled: !ctx.hasSelection || !ctx.isEditable,
      action: () => { closeContextMenu(); ctx.cut(); },
    },
    {
      label: i("ctx.copy"), shortcut: "Ctrl+C", icon: iconCopy,
      disabled: !ctx.hasSelection,
      action: () => { closeContextMenu(); ctx.copy(); },
    },
    {
      label: i("ctx.paste"), shortcut: "Ctrl+V", icon: iconPaste,
      disabled: !ctx.isEditable,
      action: () => { closeContextMenu(); ctx.paste(false); },
    },
    {
      label: i("ctx.pasteNoFormat"), shortcut: "Ctrl+Shift+V", icon: iconPastePlain,
      disabled: !ctx.isEditable,
      action: () => { closeContextMenu(); ctx.paste(true); },
    },
    {
      label: i("ctx.selectAll"), shortcut: "Ctrl+A", icon: iconSelectAll, separator: true,
      action: () => { closeContextMenu(); ctx.selectAll(); },
    },
    {
      label: i("ctx.emoji"), shortcut: "Win+.", icon: iconEmoji, separator: true,
      disabled: !ctx.isEditable,
      action: () => {
        closeContextMenu();
        ctx.focus();
        try {
          document.dispatchEvent(new KeyboardEvent("keydown", {
            key: ".", code: "Period", keyCode: 190,
            bubbles: true, cancelable: true, metaKey: true,
          }));
        } catch { /* ignore */ }
      },
    },
  ];

  items.forEach((item) => {
    if (item.separator) menu.appendChild(createMenuSeparator());
    const btn = createMenuItem(item.label, item.shortcut, { disabled: item.disabled, icon: item.icon });
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (!item.disabled) item.action(); });
    menu.appendChild(btn);
  });
}

function tiptapContext(editor: Editor): TextContextMenuContext {
  const { from, to } = editor.state.selection;
  return {
    hasSelection: from !== to,
    isEditable: !editor.storage.readonlyGuard?.readonly,
    locale: (editor.storage.slashCommands?.locale ?? "en") as Locale,
    cut: () => document.execCommand("cut"),
    copy: () => document.execCommand("copy"),
    paste: async (plain) => {
      try {
        if (plain) {
          const text = await navigator.clipboard.readText();
          editor.chain().focus().insertContent(text).run();
        } else {
          const items = await navigator.clipboard.read();
          const htmlItem = items[0]?.types.includes("text/html") ? items[0] : null;
          if (htmlItem) {
            const blob = await htmlItem.getType("text/html");
            const html = await blob.text();
            editor.chain().focus().insertContent(html).run();
          } else {
            const text = await navigator.clipboard.readText();
            editor.chain().focus().insertContent(text).run();
          }
        }
      } catch { document.execCommand("paste"); }
    },
    selectAll: () => editor.chain().focus().selectAll().run(),
    focus: () => editor.commands.focus(),
  };
}

const TextContextMenu = Extension.create({
  name: "textContextMenu",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("textContextMenu"),
        props: {
          handleDOMEvents: {
            contextmenu(_view, event) {
              const target = event.target as HTMLElement;
              if (target.tagName === "IMG" || target.closest("img")) return false;

              event.preventDefault();
              showGenericContextMenu(
                { x: event.clientX, y: event.clientY },
                tiptapContext(editor),
              );
              return true;
            },
          },
        },
      }),
    ];
  },
});

export default TextContextMenu;
