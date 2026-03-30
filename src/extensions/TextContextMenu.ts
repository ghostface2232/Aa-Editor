import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";
import { clampMenuToViewport } from "../utils/clampMenuPosition";
import { closeContextMenu, registerContextMenu } from "../utils/contextMenuRegistry";


function isDarkTheme(): boolean {
  return document.querySelector("[data-theme='dark']") !== null;
}

function createMenuItem(
  label: string,
  shortcut: string | null,
  opts: { danger?: boolean; disabled?: boolean; isDark: boolean },
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.disabled = !!opts.disabled;

  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);

  if (shortcut) {
    const keySpan = document.createElement("span");
    keySpan.textContent = shortcut;
    keySpan.style.cssText = "margin-left:auto;font-size:12px;opacity:0.45;padding-left:24px;";
    btn.appendChild(keySpan);
  }

  const textColor = opts.disabled
    ? (opts.isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)")
    : opts.danger
      ? (opts.isDark ? "#f87171" : "#c42b1c")
      : (opts.isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.88)");

  btn.style.cssText = `
    display:flex;align-items:center;width:100%;text-align:left;border:none;
    border-radius:4px;font-size:13px;min-height:32px;padding:0 12px 0 8px;
    background:transparent;cursor:${opts.disabled ? "default" : "pointer"};
    font-family:inherit;color:${textColor};
  `;

  if (!opts.disabled) {
    btn.addEventListener("mouseenter", () => {
      btn.style.backgroundColor = opts.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.backgroundColor = "transparent";
    });
  }

  return btn;
}

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
  closeContextMenu();
  const isDark = isDarkTheme();
  const i = (key: Parameters<typeof t>[0]) => t(key, ctx.locale);

  // Overlay
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:999;";
  overlay.addEventListener("mousedown", (e) => { e.preventDefault(); closeContextMenu(); });
  document.body.appendChild(overlay);

  // Menu
  const menu = document.createElement("div");
  menu.style.cssText = `
    position:fixed;z-index:1000;
    background:${isDark ? "var(--colorNeutralBackground1, #2b2b2b)" : "var(--colorNeutralBackground1, #fff)"};
    border:1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"};
    box-shadow:${isDark ? "0 8px 32px rgba(0,0,0,0.5),0 2px 8px rgba(0,0,0,0.3)" : "0 8px 32px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.06)"};
    border-radius:8px;padding:4px;min-width:200px;
  `;
  menu.style.left = `${pos.x}px`;
  menu.style.top = `${pos.y}px`;

  const items: { label: string; shortcut: string | null; disabled?: boolean; separator?: boolean; action: () => void }[] = [
    {
      label: i("ctx.cut"),
      shortcut: "Ctrl+X",
      disabled: !ctx.hasSelection || !ctx.isEditable,
      action: () => { closeContextMenu(); ctx.cut(); },
    },
    {
      label: i("ctx.copy"),
      shortcut: "Ctrl+C",
      disabled: !ctx.hasSelection,
      action: () => { closeContextMenu(); ctx.copy(); },
    },
    {
      label: i("ctx.paste"),
      shortcut: "Ctrl+V",
      disabled: !ctx.isEditable,
      action: () => { closeContextMenu(); ctx.paste(false); },
    },
    {
      label: i("ctx.pasteNoFormat"),
      shortcut: "Ctrl+Shift+V",
      disabled: !ctx.isEditable,
      action: () => { closeContextMenu(); ctx.paste(true); },
    },
    {
      label: i("ctx.selectAll"),
      shortcut: "Ctrl+A",
      separator: true,
      action: () => { closeContextMenu(); ctx.selectAll(); },
    },
    {
      label: i("ctx.emoji"),
      shortcut: "Win+.",
      disabled: !ctx.isEditable,
      separator: true,
      action: () => {
        closeContextMenu();
        ctx.focus();
        try {
          const evt = new KeyboardEvent("keydown", {
            key: ".", code: "Period", keyCode: 190,
            bubbles: true, cancelable: true, metaKey: true,
          });
          document.dispatchEvent(evt);
        } catch { /* ignore */ }
      },
    },
  ];

  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.style.cssText = `height:1px;margin:4px 8px;background:${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"};`;
      menu.appendChild(sep);
    }
    const btn = createMenuItem(item.label, item.shortcut, { disabled: item.disabled, isDark });
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (!item.disabled) item.action(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  registerContextMenu(menu, overlay);
  requestAnimationFrame(() => clampMenuToViewport(menu));
}

function tiptapContext(editor: Editor): TextContextMenuContext {
  const { from, to } = editor.state.selection;
  return {
    hasSelection: from !== to,
    isEditable: editor.isEditable,
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
