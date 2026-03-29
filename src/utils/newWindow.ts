import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

let windowCounter = 0;

export function openNewWindow(noteId?: string) {
  windowCounter++;
  const label = `win-${Date.now()}-${windowCounter}`;
  const url = noteId ? `/?noteId=${encodeURIComponent(noteId)}` : "/";

  new WebviewWindow(label, {
    url,
    title: "Aa",
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 620,
    decorations: false,
    transparent: true,
    visible: false,
  });
}
