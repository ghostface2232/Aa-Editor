/** Height of the status bar (24px content + 1px border-top). */
const STATUS_BAR_HEIGHT = 25;

/**
 * Clamp a fixed-position menu so it stays fully visible within the viewport.
 * Call after the menu element is mounted and has its layout dimensions.
 */
export function clampMenuToViewport(el: HTMLElement, margin = 8) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bottomLimit = vh - STATUS_BAR_HEIGHT - margin;

  if (rect.right > vw - margin) {
    el.style.left = `${Math.max(margin, vw - rect.width - margin)}px`;
  }
  if (rect.bottom > bottomLimit) {
    el.style.top = `${Math.max(margin, bottomLimit - rect.height)}px`;
  }
  if (rect.left < margin) {
    el.style.left = `${margin}px`;
  }
  if (rect.top < margin) {
    el.style.top = `${margin}px`;
  }
}
