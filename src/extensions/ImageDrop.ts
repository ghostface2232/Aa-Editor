import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { Editor } from "@tiptap/core";

const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

/** 브라우저 File → base64 data URL */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Uint8Array → base64 data URL (chunk 처리로 O(N) 보장) */
function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return `data:${mimeType};base64,${btoa(parts.join(""))}`;
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return map[ext.toLowerCase()] ?? "image/png";
}

/** Tauri 환경 여부 */
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

/** 브라우저 <input type="file">로 이미지 선택 */
function pickWithBrowserInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_MIME.join(",");
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** 파일 다이얼로그로 이미지를 선택해 에디터에 삽입 */
export async function pickAndInsertImage(editor: Editor): Promise<void> {
  if (isTauri) {
    const selected = await open({
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
      multiple: false,
    });
    if (!selected) return;

    const path = selected as string;
    const ext = path.split(".").pop() ?? "png";
    const bytes = await readFile(path);
    const dataUrl = bytesToDataUrl(bytes, mimeFromExt(ext));
    editor.chain().focus().setImage({ src: dataUrl }).run();
  } else {
    const file = await pickWithBrowserInput();
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    editor.chain().focus().setImage({ src: dataUrl }).run();
  }
}

/**
 * 이미지 드래그앤드롭 & 클립보드 붙여넣기 처리 확장
 */
const ImageDrop = Extension.create({
  name: "imageDrop",
  priority: 101,

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("imageDrop"),
        props: {
          handleDrop(view, event) {
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            const images = Array.from(files).filter((f) =>
              IMAGE_MIME.includes(f.type),
            );
            if (images.length === 0) return false;

            event.preventDefault();

            // 드롭 위치에 커서 배치
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });

            images.forEach(async (file) => {
              const dataUrl = await fileToDataUrl(file);
              if (pos) {
                editor
                  .chain()
                  .focus()
                  .insertContentAt(pos.pos, {
                    type: "image",
                    attrs: { src: dataUrl },
                  })
                  .run();
              } else {
                editor.chain().focus().setImage({ src: dataUrl }).run();
              }
            });

            return true;
          },

          handlePaste(_view, event) {
            const items = event.clipboardData?.items;
            if (!items) return false;

            const imageItems = Array.from(items).filter(
              (item) => item.kind === "file" && IMAGE_MIME.includes(item.type),
            );
            if (imageItems.length === 0) return false;

            event.preventDefault();

            imageItems.forEach(async (item) => {
              const file = item.getAsFile();
              if (!file) return;
              const dataUrl = await fileToDataUrl(file);
              editor.chain().focus().setImage({ src: dataUrl }).run();
            });

            return true;
          },
        },
      }),
    ];
  },
});

export default ImageDrop;
