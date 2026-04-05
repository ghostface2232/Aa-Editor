/**
 * `getCoords` 가 반환하는 좌표가 화면 상단/하단 80px 영역에 있을 때,
 * scrollable 조상 컨테이너를 그 좌표의 1/3 지점으로 smooth 스크롤.
 */
export function scrollToPos(
  dom: HTMLElement,
  getCoords: () => { top: number } | null,
) {
  requestAnimationFrame(() => {
    try {
      const coords = getCoords();
      if (!coords) return;
      let scrollParent: HTMLElement | null = dom.parentElement;
      while (scrollParent) {
        const { overflowY } = window.getComputedStyle(scrollParent);
        if (overflowY === "auto" || overflowY === "scroll") break;
        scrollParent = scrollParent.parentElement;
      }
      if (scrollParent) {
        const rect = scrollParent.getBoundingClientRect();
        const relativeTop = coords.top - rect.top;
        const padding = 80;
        if (relativeTop < padding || relativeTop > rect.height - padding) {
          scrollParent.scrollTo({
            top: scrollParent.scrollTop + relativeTop - rect.height / 3,
            behavior: "smooth",
          });
        }
      }
    } catch { /* no-op */ }
  });
}
