import { type Editor } from "@tiptap/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";
import { clampMenuToViewport } from "../utils/clampMenuPosition";
import { closeContextMenu, registerContextMenu } from "../utils/contextMenuRegistry";

const HANDLE_SIZE = 10;
const HANDLE_HIT = 20;
const MIN_WIDTH = 60;

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function mimeToExt(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/(\w+)/);
  const mime = match?.[1] ?? "png";
  return mime === "jpeg" ? "jpg" : mime;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const chunkSize = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return `data:${mimeType};base64,${btoa(parts.join(""))}`;
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  };
  return map[ext.toLowerCase()] ?? "image/png";
}

interface MenuPosition { x: number; y: number }

function showContextMenu(
  pos: MenuPosition,
  editor: Editor,
  nodePos: number,
  src: string,
  locale: Locale,
) {
  closeContextMenu();

  const i = (key: Parameters<typeof t>[0]) => t(key, locale);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark"
    || document.querySelector("[data-theme='dark']") !== null;

  // Overlay
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:999;";
  overlay.addEventListener("mousedown", (e) => { e.preventDefault(); closeContextMenu(); });
  document.body.appendChild(overlay);

  // Menu container
  const menu = document.createElement("div");
  menu.style.cssText = `
    position:fixed;z-index:1000;
    background:${isDark ? "var(--colorNeutralBackground1, #2b2b2b)" : "var(--colorNeutralBackground1, #fff)"};
    border:1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"};
    box-shadow:${isDark ? "0 8px 32px rgba(0,0,0,0.5),0 2px 8px rgba(0,0,0,0.3)" : "0 8px 32px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.06)"};
    border-radius:8px;padding:4px;min-width:160px;
  `;
  menu.style.left = `${pos.x}px`;
  menu.style.top = `${pos.y}px`;

  const items: { label: string; danger?: boolean; action: () => void }[] = [
    {
      label: i("image.save"),
      action: async () => {
        closeContextMenu();
        const ext = mimeToExt(src);
        const path = await save({ filters: [{ name: "Image", extensions: [ext] }] });
        if (!path) return;
        const bytes = dataUrlToUint8Array(src);
        await writeFile(path, bytes);
      },
    },
    {
      label: i("image.copy"),
      action: async () => {
        closeContextMenu();
        try {
          const resp = await fetch(src);
          const blob = await resp.blob();
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        } catch { /* ignore */ }
      },
    },
    {
      label: i("image.replace"),
      action: async () => {
        closeContextMenu();
        const selected = await open({
          filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
          multiple: false,
        });
        if (!selected) return;
        const path = selected as string;
        const ext = path.split(".").pop() ?? "png";
        const fileBytes = await readFile(path);
        const dataUrl = bytesToDataUrl(fileBytes, mimeFromExt(ext));
        editor.chain().focus().setNodeSelection(nodePos).updateAttributes("image", { src: dataUrl }).run();
      },
    },
    {
      label: i("image.delete"),
      danger: true,
      action: () => {
        closeContextMenu();
        editor.chain().focus().setNodeSelection(nodePos).deleteSelection().run();
      },
    },
  ];

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    btn.style.cssText = `
      display:flex;align-items:center;width:100%;text-align:left;border:none;
      border-radius:4px;font-size:13px;min-height:32px;padding:0 12px 0 8px;
      background:transparent;cursor:pointer;font-family:inherit;
      color:${item.danger
        ? (isDark ? "#f87171" : "#c42b1c")
        : (isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.88)")
      };
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.backgroundColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.backgroundColor = "transparent";
    });
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); item.action(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  registerContextMenu(menu, overlay);
  requestAnimationFrame(() => clampMenuToViewport(menu));
}

export function createImageNodeView(editor: Editor) {
  return (props: { node: any; getPos: () => number | undefined; HTMLAttributes: Record<string, any> }) => {
    const { node, getPos, HTMLAttributes } = props;

    // Mutable state for current node attrs (updated in update())
    let currentSrc = node.attrs.src;
    // Track active drag listeners for cleanup
    let activeDragCleanup: (() => void) | null = null;

    // Wrapper
    const dom = document.createElement("div");
    dom.style.cssText = "position:relative;display:inline-block;max-width:100%;line-height:0;";

    // Img
    const img = document.createElement("img");
    img.src = HTMLAttributes.src;
    if (HTMLAttributes.alt) img.alt = HTMLAttributes.alt;
    if (HTMLAttributes.title) img.title = HTMLAttributes.title;
    img.style.cssText = "display:block;max-width:100%;height:auto;border-radius:var(--editor-radius);cursor:default;";
    if (HTMLAttributes.width) {
      img.style.width = `${HTMLAttributes.width}px`;
    }
    if (HTMLAttributes.height) {
      img.style.height = `${HTMLAttributes.height}px`;
    }
    dom.appendChild(img);

    // Resize handles (corners only)
    const handles: HTMLElement[] = [];
    const corners = ["nw", "ne", "sw", "se"] as const;
    const cursorMap = { nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" };

    corners.forEach((corner) => {
      // Outer hit area (invisible, larger)
      const hitArea = document.createElement("div");
      hitArea.dataset.corner = corner;
      hitArea.style.cssText = `
        position:absolute;width:${HANDLE_HIT}px;height:${HANDLE_HIT}px;
        cursor:${cursorMap[corner]};z-index:1;
        opacity:0;pointer-events:none;
        display:flex;align-items:center;justify-content:center;
      `;
      if (corner.includes("n")) hitArea.style.top = `-${HANDLE_HIT / 2}px`;
      if (corner.includes("s")) hitArea.style.bottom = `-${HANDLE_HIT / 2}px`;
      if (corner.includes("w")) hitArea.style.left = `-${HANDLE_HIT / 2}px`;
      if (corner.includes("e")) hitArea.style.right = `-${HANDLE_HIT / 2}px`;
      // Visual handle (smaller, centered inside hit area)
      const knob = document.createElement("div");
      knob.style.cssText = `
        width:${HANDLE_SIZE}px;height:${HANDLE_SIZE}px;
        background:#fff;border:1.5px solid var(--editor-color-accent, #0078d4);
        border-radius:2px;pointer-events:none;
      `;
      hitArea.appendChild(knob);
      dom.appendChild(hitArea);
      handles.push(hitArea);
    });

    // Show/hide handles
    const showHandles = () => handles.forEach((h) => { h.style.opacity = "1"; h.style.pointerEvents = "auto"; });
    const hideHandles = () => handles.forEach((h) => { h.style.opacity = "0"; h.style.pointerEvents = "none"; });
    dom.addEventListener("mouseenter", showHandles);
    dom.addEventListener("mouseleave", hideHandles);

    // Selection outline
    const updateSelection = () => {
      const pos = getPos();
      if (pos === undefined) return;
      const { from } = editor.state.selection;
      const selected = from === pos;
      dom.style.outline = selected ? "2px solid var(--editor-color-accent, #0078d4)" : "none";
      dom.style.outlineOffset = "2px";
      dom.style.borderRadius = "var(--editor-radius, 4px)";
      if (selected) showHandles();
    };

    // Click to select
    img.addEventListener("click", () => {
      const pos = getPos();
      if (pos !== undefined) {
        editor.commands.setNodeSelection(pos);
      }
    });

    // Resize drag
    handles.forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = img.offsetWidth;
        const aspectRatio = img.naturalHeight / img.naturalWidth || 1;
        const corner = handle.dataset.corner!;
        const isLeft = corner.includes("w");

        const onMouseMove = (ev: MouseEvent) => {
          const dx = isLeft ? startX - ev.clientX : ev.clientX - startX;
          const newW = Math.max(MIN_WIDTH, startW + dx);
          const newH = Math.round(newW * aspectRatio);
          img.style.width = `${newW}px`;
          img.style.height = `${newH}px`;
        };

        const cleanup = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          activeDragCleanup = null;
        };

        const onMouseUp = (ev: MouseEvent) => {
          cleanup();
          const dx = isLeft ? startX - ev.clientX : ev.clientX - startX;
          const finalW = Math.max(MIN_WIDTH, startW + dx);
          const finalH = Math.round(finalW * aspectRatio);
          const pos = getPos();
          if (pos !== undefined) {
            editor.chain()
              .setNodeSelection(pos)
              .updateAttributes("image", { width: finalW, height: finalH })
              .run();
          }
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        activeDragCleanup = cleanup;
      });
    });

    // Context menu
    img.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos === undefined) return;
      const locale = (editor.storage.slashCommands?.locale ?? "en") as Locale;
      showContextMenu({ x: e.clientX, y: e.clientY }, editor, pos, currentSrc, locale);
    });

    // Listen for selection changes to update outline
    const onSelectionUpdate = () => updateSelection();
    editor.on("selectionUpdate", onSelectionUpdate);

    return {
      dom,
      update: (updatedNode: any) => {
        if (updatedNode.type.name !== "image") return false;
        currentSrc = updatedNode.attrs.src;
        img.src = updatedNode.attrs.src;
        if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt;
        if (updatedNode.attrs.width) {
          img.style.width = `${updatedNode.attrs.width}px`;
          img.style.height = `${updatedNode.attrs.height}px`;
        }
        updateSelection();
        return true;
      },
      selectNode: () => {
        dom.style.outline = "2px solid var(--editor-color-accent, #0078d4)";
        dom.style.outlineOffset = "2px";
        showHandles();
      },
      deselectNode: () => {
        dom.style.outline = "none";
        hideHandles();
      },
      destroy: () => {
        editor.off("selectionUpdate", onSelectionUpdate);
        activeDragCleanup?.();
      },
    };
  };
}
