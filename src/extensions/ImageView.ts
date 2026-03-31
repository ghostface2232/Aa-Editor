import { type Editor } from "@tiptap/core";
import { startReorder } from "./ImageReorder";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";
import { dataUrlToUint8Array, mimeToExt, bytesToDataUrl, mimeFromExt } from "../utils/imageUtils";
import { closeContextMenu, createMenuShell, createMenuItem } from "../utils/contextMenuRegistry";

const HANDLE_SIZE = 10;
const HANDLE_HIT = 20;
const MIN_WIDTH = 60;

function showContextMenu(
  pos: { x: number; y: number },
  editor: Editor,
  nodePos: number,
  src: string,
  locale: Locale,
) {
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);
  const { menu } = createMenuShell(pos, 160);

  const iconSave = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 5.5A2.5 2.5 0 015.5 3h7.59a1.5 1.5 0 011.06.44l2.41 2.41c.28.28.44.67.44 1.06V14.5A2.5 2.5 0 0114.5 17h-9A2.5 2.5 0 013 14.5v-9zM5.5 4A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16h9a1.5 1.5 0 001.5-1.5V6.91a.5.5 0 00-.15-.35l-2.41-2.41A.5.5 0 0013.09 4H12v3a1 1 0 01-1 1H7a1 1 0 01-1-1V4H5.5zM7 4v3h4V4H7z"/></svg>';
  const iconCopy = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8 2a2 2 0 00-2 2v10a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2H8zM7 4a1 1 0 011-1h6a1 1 0 011 1v10a1 1 0 01-1 1H8a1 1 0 01-1-1V4zM4 6a2 2 0 011-1.73V14.5A2.5 2.5 0 007.5 17h6.23A2 2 0 0112 18H7.5A3.5 3.5 0 014 14.5V6z"/></svg>';
  const iconReplace = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M14.5 3A2.5 2.5 0 0117 5.5v4a.5.5 0 01-1 0v-4A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16h4a.5.5 0 010 1h-4A2.5 2.5 0 013 14.5v-9A2.5 2.5 0 015.5 3h9zm-1.15 9.85a.5.5 0 01.36-.15h3.79a.5.5 0 010 1h-2.8l2.15 2.15a.5.5 0 01-.7.7L14 14.41v2.8a.5.5 0 01-1 0v-3.86a.5.5 0 01.35-.5z"/></svg>';
  const iconDelete = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8.5 4h3a1.5 1.5 0 00-3 0zM7.5 4a2.5 2.5 0 015 0h4a.5.5 0 010 1h-.44l-1.2 10.17A3 3 0 0111.89 18H8.1a3 3 0 01-2.98-2.83L3.94 5H3.5a.5.5 0 010-1h4zM6.13 15.07A2 2 0 008.1 17h3.78a2 2 0 001.99-1.93L15.05 5H4.95l1.18 10.07zM8.5 7.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V8a.5.5 0 01.5-.5zm3.5.5a.5.5 0 00-1 0v6a.5.5 0 001 0V8z"/></svg>';

  const items: { label: string; icon: string; danger?: boolean; action: () => void }[] = [
    {
      label: i("image.save"), icon: iconSave,
      action: async () => {
        closeContextMenu();
        const ext = mimeToExt(src);
        const path = await save({ filters: [{ name: "Image", extensions: [ext] }] });
        if (!path) return;
        await writeFile(path, dataUrlToUint8Array(src));
      },
    },
    {
      label: i("image.copy"), icon: iconCopy,
      action: async () => {
        closeContextMenu();
        try {
          const bytes = dataUrlToUint8Array(src);
          const mime = src.split(",")[0].split(":")[1].split(";")[0];
          const blob = new Blob([bytes], { type: mime });
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        } catch { /* ignore */ }
      },
    },
    {
      label: i("image.replace"), icon: iconReplace,
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
      label: i("image.delete"), icon: iconDelete,
      danger: true,
      action: () => {
        closeContextMenu();
        editor.chain().focus().setNodeSelection(nodePos).deleteSelection().run();
      },
    },
  ];

  items.forEach((item) => {
    const btn = createMenuItem(item.label, null, { danger: item.danger, icon: item.icon });
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); item.action(); });
    menu.appendChild(btn);
  });
}

export function createImageNodeView(editor: Editor) {
  return (props: { node: any; getPos: () => number | undefined; HTMLAttributes: Record<string, any> }) => {
    const { node, getPos, HTMLAttributes } = props;

    let currentSrc = node.attrs.src;
    let currentNode = node;
    let activeDragCleanup: (() => void) | null = null;

    const dom = document.createElement("div");
    dom.style.cssText = "position:relative;display:inline-block;max-width:100%;line-height:0;";
    dom.draggable = false;

    const img = document.createElement("img");
    img.src = HTMLAttributes.src;
    if (HTMLAttributes.alt) img.alt = HTMLAttributes.alt;
    if (HTMLAttributes.title) img.title = HTMLAttributes.title;
    img.draggable = false;
    img.style.cssText = "display:block;max-width:100%;height:auto;border-radius:var(--editor-radius);cursor:default;";
    if (HTMLAttributes.width) img.style.width = `${HTMLAttributes.width}px`;
    if (HTMLAttributes.height) img.style.height = `${HTMLAttributes.height}px`;
    dom.appendChild(img);

    const handles: HTMLElement[] = [];
    const corners = ["nw", "ne", "sw", "se"] as const;
    const cursorMap = { nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" };

    corners.forEach((corner) => {
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

    const isReadonly = () => !!editor.storage.readonlyGuard?.readonly;

    const syncDragState = () => {
      img.style.cursor = isReadonly() ? "default" : "move";
    };

    const showHandles = () => {
      if (isReadonly()) return;
      handles.forEach((h) => { h.style.opacity = "1"; h.style.pointerEvents = "auto"; });
    };
    const hideHandles = () => handles.forEach((h) => { h.style.opacity = "0"; h.style.pointerEvents = "none"; });
    dom.addEventListener("mouseenter", showHandles);
    dom.addEventListener("mouseleave", hideHandles);

    const updateSelection = () => {
      syncDragState();
      if (isReadonly()) { dom.style.outline = "none"; hideHandles(); return; }
      const pos = getPos();
      if (pos === undefined) return;
      const selected = editor.state.selection.from === pos;
      dom.style.outline = selected ? "2px solid var(--editor-color-accent, #0078d4)" : "none";
      dom.style.outlineOffset = "2px";
      dom.style.borderRadius = "var(--editor-radius, 4px)";
      if (selected) showHandles();
    };

    const selectImageNode = () => {
      const pos = getPos();
      if (pos !== undefined) editor.chain().focus().setNodeSelection(pos).run();
    };

    img.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      selectImageNode();
      if (isReadonly()) return;

      const startPos = getPos();
      if (startPos === undefined) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let handed = false;

      const onMove = (ev: PointerEvent) => {
        if (handed) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;

        handed = true;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);

        startReorder(editor, startPos, currentNode.nodeSize, { ...currentNode.attrs }, img, ev);
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    img.addEventListener("click", () => {
      selectImageNode();
    });

    handles.forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        if (isReadonly()) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = img.offsetWidth;
        const aspectRatio = img.naturalHeight / img.naturalWidth || 1;
        const isLeft = handle.dataset.corner!.includes("w");

        const onMouseMove = (ev: MouseEvent) => {
          const dx = isLeft ? startX - ev.clientX : ev.clientX - startX;
          const newW = Math.max(MIN_WIDTH, startW + dx);
          img.style.width = `${newW}px`;
          img.style.height = `${Math.round(newW * aspectRatio)}px`;
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
          const pos = getPos();
          if (pos !== undefined) {
            editor.chain()
              .setNodeSelection(pos)
              .updateAttributes("image", { width: finalW, height: Math.round(finalW * aspectRatio) })
              .run();
          }
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        activeDragCleanup = cleanup;
      });
    });

    img.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos === undefined) return;
      const locale = (editor.storage.slashCommands?.locale ?? "en") as Locale;
      showContextMenu({ x: e.clientX, y: e.clientY }, editor, pos, currentSrc, locale);
    });

    editor.on("selectionUpdate", updateSelection);
    editor.on("transaction", syncDragState);
    syncDragState();

    return {
      dom,
      update: (updatedNode: any) => {
        if (updatedNode.type.name !== "image") return false;
        currentNode = updatedNode;
        currentSrc = updatedNode.attrs.src;
        img.src = updatedNode.attrs.src;
        if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt;
        if (updatedNode.attrs.width) {
          img.style.width = `${updatedNode.attrs.width}px`;
          img.style.height = `${updatedNode.attrs.height}px`;
        }
        syncDragState();
        updateSelection();
        return true;
      },
      selectNode: () => {
        dom.style.outline = "2px solid var(--editor-color-accent, #0078d4)";
        dom.style.outlineOffset = "2px";
        showHandles();
      },
      deselectNode: () => { dom.style.outline = "none"; hideHandles(); },
      destroy: () => {
        editor.off("selectionUpdate", updateSelection);
        editor.off("transaction", syncDragState);
        activeDragCleanup?.();
      },
    };
  };
}
