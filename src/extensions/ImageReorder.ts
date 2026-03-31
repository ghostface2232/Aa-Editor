import { type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

export function startReorder(
  editor: Editor,
  nodePos: number,
  nodeSize: number,
  attrs: Record<string, unknown>,
  imgEl: HTMLImageElement,
  event: PointerEvent,
): void {
  // [1] 고스트 프리뷰 생성
  const imgRect = imgEl.getBoundingClientRect();
  const scale = 0.85;
  const ghostW = imgRect.width * scale;
  const ghostH = imgRect.height * scale;
  const offsetX = (event.clientX - imgRect.left) * scale;
  const offsetY = (event.clientY - imgRect.top) * scale;

  const ghost = document.createElement("div");
  ghost.className = "image-drag-ghost";
  ghost.style.left = "0";
  ghost.style.top = "0";
  ghost.style.transform = `translate3d(${event.clientX - offsetX}px, ${event.clientY - offsetY}px, 0)`;
  const ghostImg = document.createElement("img");
  ghostImg.src = attrs.src as string;
  ghostImg.style.width = `${ghostW}px`;
  ghostImg.style.height = `${ghostH}px`;
  ghost.appendChild(ghostImg);
  document.body.appendChild(ghost);

  // [2] 원본 이미지 반투명 처리 + 커서 변경
  imgEl.style.opacity = "0.3";
  document.body.style.cursor = "move";

  // [3] 드롭 인디케이터 생성
  const indicator = document.createElement("div");
  indicator.className = "image-drop-indicator";
  indicator.style.left = "0";
  indicator.style.top = "0";
  document.body.appendChild(indicator);

  // [4] 콘텐츠 영역 bounds 캐싱
  const pmDom = editor.view.dom;
  const pmRect = pmDom.getBoundingClientRect();
  const pmStyle = getComputedStyle(pmDom);
  const paddingLeft = parseFloat(pmStyle.paddingLeft);
  const paddingRight = parseFloat(pmStyle.paddingRight);
  const contentLeft = pmRect.left + paddingLeft;
  const contentWidth = pmRect.width - paddingLeft - paddingRight;

  // [5] 상태 변수
  let pendingX = event.clientX;
  let pendingY = event.clientY;
  let rafId: number | null = null;
  let lastInsertPos: number | null = null;
  let currentInsertPos: number | null = null;
  let cleaned = false;

  // [6] 스크롤 컨테이너 캐싱
  let scrollContainer: HTMLElement | null = null;
  let ancestor = imgEl.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLElement) {
      const ov = getComputedStyle(ancestor).overflowY;
      if (ov === "auto" || ov === "scroll") {
        scrollContainer = ancestor;
        break;
      }
    }
    ancestor = ancestor.parentElement;
  }

  // [7] cleanup 함수
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    ghost.remove();
    indicator.remove();
    imgEl.style.opacity = "";
    document.body.style.cursor = "";
    if (rafId !== null) cancelAnimationFrame(rafId);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("keydown", onKeyDown);
  }

  // [8] tick 함수
  function tick() {
    rafId = null;
    let isScrolling = false;

    // a) 고스트 위치 갱신
    ghost.style.transform = `translate3d(${pendingX - offsetX}px, ${pendingY - offsetY}px, 0)`;

    // b) 삽입 위치 계산
    try {
      const posResult = editor.view.posAtCoords({ left: pendingX, top: pendingY });
      if (!posResult) {
        indicator.style.opacity = "0";
        currentInsertPos = null;
      } else {
        const $resolved = editor.state.doc.resolve(posResult.pos);
        const blockStart = $resolved.before(1);
        const blockEnd = $resolved.after(1);

        const blockDOM = editor.view.nodeDOM(blockStart) as HTMLElement | null;
        if (!blockDOM || !(blockDOM instanceof HTMLElement)) {
          indicator.style.opacity = "0";
          currentInsertPos = null;
        } else {
          const blockRect = blockDOM.getBoundingClientRect();
          const midY = (blockRect.top + blockRect.bottom) / 2;

          const prevSibling = blockDOM.previousElementSibling as HTMLElement | null;
          const nextSibling = blockDOM.nextElementSibling as HTMLElement | null;

          let insertPos: number;
          let indicatorY: number;

          if (pendingY < midY) {
            insertPos = blockStart;
            if (prevSibling) {
              indicatorY = (prevSibling.getBoundingClientRect().bottom + blockRect.top) / 2;
            } else {
              indicatorY = blockRect.top;
            }
          } else {
            insertPos = blockEnd;
            if (nextSibling) {
              indicatorY = (blockRect.bottom + nextSibling.getBoundingClientRect().top) / 2;
            } else {
              indicatorY = blockRect.bottom;
            }
          }

          if (insertPos === nodePos || insertPos === nodePos + nodeSize) {
            indicator.style.opacity = "0";
            currentInsertPos = null;
          } else {
            // c) 인디케이터 위치 갱신 — 이전 프레임과 같으면 DOM 업데이트 스킵
            if (lastInsertPos !== insertPos) {
              indicator.style.left = contentLeft + "px";
              indicator.style.width = contentWidth + "px";
              indicator.style.top = indicatorY - 1 + "px";
              indicator.style.opacity = "1";
              lastInsertPos = insertPos;
            }
            currentInsertPos = insertPos;
          }
        }
      }
    } catch {
      indicator.style.opacity = "0";
      currentInsertPos = null;
    }

    // d) 자동 스크롤
    if (scrollContainer) {
      const scrollRect = scrollContainer.getBoundingClientRect();
      const EDGE = 40;
      const MAX_SPEED = 12;

      const distTop = pendingY - scrollRect.top;
      if (distTop < EDGE) {
        scrollContainer.scrollBy({ top: -(((EDGE - distTop) / EDGE) * MAX_SPEED), behavior: "instant" as ScrollBehavior });
        isScrolling = true;
      }

      const distBottom = scrollRect.bottom - pendingY;
      if (distBottom < EDGE) {
        scrollContainer.scrollBy({ top: ((EDGE - distBottom) / EDGE) * MAX_SPEED, behavior: "instant" as ScrollBehavior });
        isScrolling = true;
      }

      if (isScrolling && rafId === null) {
        rafId = requestAnimationFrame(tick);
      }
    }
  }

  // [9] 이벤트 핸들러
  const onPointerMove = (ev: PointerEvent) => {
    pendingX = ev.clientX;
    pendingY = ev.clientY;
    if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
    ev.preventDefault();
  };

  const onPointerUp = () => {
    if (currentInsertPos !== null) {
      const imageNode = editor.schema.nodes.image!.create(attrs);
      const tr = editor.view.state.tr;

      tr.delete(nodePos, nodePos + nodeSize);

      let adjustedPos = currentInsertPos;
      if (currentInsertPos > nodePos) {
        adjustedPos -= nodeSize;
      }

      tr.insert(adjustedPos, imageNode);
      tr.setSelection(NodeSelection.create(tr.doc, adjustedPos));
      editor.view.dispatch(tr.scrollIntoView());
    }
    cleanup();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      cleanup();
    }
  };

  // [10] 이벤트 리스너 등록
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keydown", onKeyDown);
}
