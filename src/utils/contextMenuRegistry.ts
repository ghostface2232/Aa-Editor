/** Shared singleton for all context menus — ensures only one is open at a time. */
let activeMenu: HTMLElement | null = null;
let activeOverlay: HTMLElement | null = null;

export function closeContextMenu() {
  activeMenu?.remove();
  activeOverlay?.remove();
  activeMenu = null;
  activeOverlay = null;
}

export function registerContextMenu(menu: HTMLElement, overlay: HTMLElement) {
  closeContextMenu();
  activeMenu = menu;
  activeOverlay = overlay;
}
