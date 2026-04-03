import { useRef, useCallback } from "react";
import type { NoteGroup, NoteDoc } from "./useNotesLoader";

const DRAG_THRESHOLD = 5;
const AUTO_EXPAND_DELAY = 600;
const SCROLL_EDGE = 40;
const SCROLL_SPEED = 8;

interface DropTarget {
  type: "group-header" | "group-insert";
  groupId?: string;
  index?: number;
}

interface DragSession {
  noteId: string;
  allNoteIds: string[];
  sourceGroupId: string | null;
  ghost: HTMLElement;
  indicator: HTMLElement;
  startX: number;
  startY: number;
  pendingX: number;
  pendingY: number;
  offsetX: number;
  offsetY: number;
  rafId: number | null;
  target: DropTarget | null;
  expandTimer: number | null;
  expandGroupId: string | null;
  dimmedEls: HTMLElement[];
  fadedEls: HTMLElement[];
  cleaned: boolean;
}

interface UseSidebarDragOptions {
  groups: NoteGroup[];
  docs: NoteDoc[];
  selectedNoteIds: Set<string>;
  selectMode: boolean;
  editingIndex: number | null;
  editingGroupId: string | null;
  searchActive: boolean;
  sidebarBodyRef: React.RefObject<HTMLElement | null>;
  onAddNoteToGroup: (noteId: string, groupId: string) => void;
  onMoveNotesToGroup: (noteIds: string[], groupId: string) => void;
  onInsertNoteInGroup: (noteId: string, groupId: string, index: number) => void;
  onReorderNoteInGroup: (noteId: string, groupId: string, newIndex: number) => void;
  onToggleGroupCollapsed: (groupId: string) => void;
}

export function useSidebarDrag(opts: UseSidebarDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const sessionRef = useRef<DragSession | null>(null);
  const draggingRef = useRef(false);

  const cleanup = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.cleaned) return;
    s.cleaned = true;

    if (s.rafId !== null) cancelAnimationFrame(s.rafId);
    if (s.expandTimer !== null) clearTimeout(s.expandTimer);

    s.ghost.remove();
    s.indicator.remove();
    s.dimmedEls.forEach((el) => { el.style.opacity = ""; });
    s.fadedEls.forEach((el) => { el.style.opacity = ""; el.style.pointerEvents = ""; });

    document.querySelectorAll(".sidebar-drag-over").forEach((el) => el.classList.remove("sidebar-drag-over"));
    document.body.style.cursor = "";

    draggingRef.current = false;
    sessionRef.current = null;
  }, []);

  const commit = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const o = optsRef.current;
    const t = s.target;

    if (t) {
      const isSingle = s.allNoteIds.length === 1;

      if (t.type === "group-header" && t.groupId) {
        if (s.sourceGroupId === t.groupId && isSingle) {
          // no-op: dropped on own group header
        } else if (isSingle) {
          o.onAddNoteToGroup(s.noteId, t.groupId);
        } else {
          o.onMoveNotesToGroup(s.allNoteIds, t.groupId);
        }
      } else if (t.type === "group-insert" && t.groupId != null && t.index != null) {
        if (isSingle) {
          if (s.sourceGroupId === t.groupId) {
            o.onReorderNoteInGroup(s.noteId, t.groupId, t.index);
          } else {
            o.onInsertNoteInGroup(s.noteId, t.groupId, t.index);
          }
        } else {
          o.onMoveNotesToGroup(s.allNoteIds, t.groupId);
        }
      }
    }

    cleanup();
  }, [cleanup]);

  const tick = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.cleaned) return;
    s.rafId = null;

    const x = s.pendingX;
    const y = s.pendingY;

    // Update ghost position
    s.ghost.style.transform = `translate3d(${x - s.offsetX}px, ${y - s.offsetY}px, 0)`;

    // Auto-scroll
    const body = optsRef.current.sidebarBodyRef.current;
    if (body) {
      const rect = body.getBoundingClientRect();
      if (y < rect.top + SCROLL_EDGE) {
        const ratio = 1 - Math.max(0, y - rect.top) / SCROLL_EDGE;
        body.scrollTop -= SCROLL_SPEED * ratio;
      } else if (y > rect.bottom - SCROLL_EDGE) {
        const ratio = 1 - Math.max(0, rect.bottom - y) / SCROLL_EDGE;
        body.scrollTop += SCROLL_SPEED * ratio;
      }
    }

    // Hit-test
    const el = document.elementFromPoint(x, y);
    if (!el) {
      clearTarget(s);
      return;
    }

    const groupHeader = el.closest<HTMLElement>("[data-group-item][data-group-id]");
    const noteInGroup = el.closest<HTMLElement>("[data-doc-item][data-group-id]");

    let nextTarget: DropTarget | null = null;

    if (groupHeader) {
      const gid = groupHeader.dataset.groupId!;
      nextTarget = { type: "group-header", groupId: gid };

      // Auto-expand collapsed groups
      const group = optsRef.current.groups.find((g) => g.id === gid);
      if (group?.collapsed && s.expandGroupId !== gid) {
        if (s.expandTimer !== null) clearTimeout(s.expandTimer);
        s.expandGroupId = gid;
        s.expandTimer = window.setTimeout(() => {
          s.expandTimer = null;
          optsRef.current.onToggleGroupCollapsed(gid);
        }, AUTO_EXPAND_DELAY);
      }
    } else if (noteInGroup) {
      const gid = noteInGroup.dataset.groupId!;
      const nid = noteInGroup.dataset.noteId;
      if (nid && nid !== s.noteId) {
        const group = optsRef.current.groups.find((g) => g.id === gid);
        if (group) {
          const noteRect = noteInGroup.getBoundingClientRect();
          const isTopHalf = y < noteRect.top + noteRect.height / 2;
          const noteIdx = group.noteIds.indexOf(nid);
          const insertIdx = isTopHalf ? noteIdx : noteIdx + 1;
          nextTarget = { type: "group-insert", groupId: gid, index: insertIdx };
        }
      }
      clearAutoExpand(s);
    } else {
      clearAutoExpand(s);
    }

    // Update visuals
    applyTarget(s, nextTarget, el);
    s.target = nextTarget;
  }, []);

  const handleDragPointerDown = useCallback((e: React.PointerEvent, noteId: string) => {
    if (e.button !== 0) return;
    const o = optsRef.current;
    if (o.editingIndex !== null || o.editingGroupId !== null || o.searchActive) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        started = true;
        startDrag(noteId, startX, startY, ev);
      }

      const s = sessionRef.current;
      if (!s) return;
      s.pendingX = ev.clientX;
      s.pendingY = ev.clientY;
      if (s.rafId === null) {
        s.rafId = requestAnimationFrame(tick);
      }
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKeyDown);
      if (started) commit();
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("keydown", onKeyDown);
        cleanup();
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKeyDown);
  }, [tick, commit, cleanup]);

  function startDrag(noteId: string, startX: number, startY: number, ev: PointerEvent) {
    const o = optsRef.current;

    const allNoteIds = o.selectMode && o.selectedNoteIds.has(noteId)
      ? Array.from(o.selectedNoteIds)
      : [noteId];

    const sourceGroup = o.groups.find((g) => g.noteIds.includes(noteId));

    // Create ghost
    const ghost = document.createElement("div");
    ghost.className = "sidebar-drag-ghost";
    const doc = o.docs.find((d) => d.id === noteId);
    const iconSvg = '<svg fill="currentColor" width="16" height="16" viewBox="0 0 20 20"><path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8h-3a2 2 0 0 1-2-2V3H6Zm5 1.07V6a1 1 0 0 0 1 1h2.93L11 3.07ZM5 4a1 1 0 0 1 1-1h4v3a2 2 0 0 0 2 2h3v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z"/></svg>';
    ghost.innerHTML = iconSvg + `<span>${doc?.fileName ?? ""}</span>`;
    if (allNoteIds.length > 1) {
      ghost.innerHTML += `<span class="sidebar-drag-count">+${allNoteIds.length - 1}</span>`;
    }
    ghost.style.transform = `translate3d(${startX + 8}px, ${startY - 14}px, 0)`;
    document.body.appendChild(ghost);

    // Create indicator
    const indicator = document.createElement("div");
    indicator.className = "sidebar-drop-indicator";
    document.body.appendChild(indicator);

    // Dim source elements
    const dimmedEls: HTMLElement[] = [];
    for (const id of allNoteIds) {
      const el = document.querySelector<HTMLElement>(`[data-doc-item][data-note-id="${id}"]`);
      if (el) {
        el.style.opacity = "0.35";
        dimmedEls.push(el);
      }
    }

    // Fade non-drop areas (notes section, new-doc button)
    const fadedEls: HTMLElement[] = [];
    const notesSection = document.querySelector<HTMLElement>("[data-notes-section]");
    if (notesSection) { notesSection.style.opacity = "0.45"; notesSection.style.pointerEvents = "none"; fadedEls.push(notesSection); }
    const newDocBtn = document.querySelector<HTMLElement>("[data-sidebar-body] > button");
    if (newDocBtn) { newDocBtn.style.opacity = "0.45"; newDocBtn.style.pointerEvents = "none"; fadedEls.push(newDocBtn); }

    document.body.style.cursor = "grabbing";
    draggingRef.current = true;

    sessionRef.current = {
      noteId,
      allNoteIds,
      sourceGroupId: sourceGroup?.id ?? null,
      ghost,
      indicator,
      startX,
      startY,
      pendingX: ev.clientX,
      pendingY: ev.clientY,
      offsetX: -8,
      offsetY: 14,
      rafId: null,
      target: null,
      expandTimer: null,
      expandGroupId: null,
      dimmedEls,
      fadedEls,
      cleaned: false,
    };
  }

  return {
    handleDragPointerDown,
    isDragging: draggingRef,
  };
}

function clearAutoExpand(s: DragSession) {
  if (s.expandTimer !== null) {
    clearTimeout(s.expandTimer);
    s.expandTimer = null;
  }
  s.expandGroupId = null;
}

function clearTarget(s: DragSession) {
  document.querySelectorAll(".sidebar-drag-over").forEach((el) => el.classList.remove("sidebar-drag-over"));
  document.querySelectorAll(".sidebar-drag-over-section").forEach((el) => el.classList.remove("sidebar-drag-over-section"));
  s.indicator.style.opacity = "0";
  s.target = null;
}

function applyTarget(s: DragSession, t: DropTarget | null, _hitEl: Element) {
  // Clear previous
  document.querySelectorAll(".sidebar-drag-over").forEach((el) => el.classList.remove("sidebar-drag-over"));
  s.indicator.style.opacity = "0";

  if (!t) return;

  if (t.type === "group-header" && t.groupId) {
    const header = document.querySelector<HTMLElement>(`[data-group-item][data-group-id="${t.groupId}"]`);
    if (header) header.classList.add("sidebar-drag-over");
  } else if (t.type === "group-insert" && t.groupId != null && t.index != null) {
    const groupEl = document.querySelector<HTMLElement>(`[data-group-item][data-group-id="${t.groupId}"]`);
    if (groupEl) groupEl.classList.add("sidebar-drag-over");

    const notesInGroup = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-doc-item][data-group-id="${t.groupId}"]`),
    );
    if (notesInGroup.length > 0) {
      let refRect: DOMRect;
      if (t.index >= notesInGroup.length) {
        refRect = notesInGroup[notesInGroup.length - 1].getBoundingClientRect();
        positionIndicator(s.indicator, refRect.bottom, refRect.left, refRect.width);
      } else {
        refRect = notesInGroup[t.index].getBoundingClientRect();
        positionIndicator(s.indicator, refRect.top, refRect.left, refRect.width);
      }
    }
  }
}

function positionIndicator(indicator: HTMLElement, top: number, left: number, width: number) {
  indicator.style.top = `${top - 1}px`;
  indicator.style.left = `${left + 4}px`;
  indicator.style.width = `${width - 8}px`;
  indicator.style.opacity = "1";
}
