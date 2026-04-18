import { useState, useRef, useEffect, useCallback } from "react";
import type { NoteDoc, NoteGroup } from "./useNotesLoader";

interface UseSidebarAnimationsOptions {
  docs: NoteDoc[];
  groups: NoteGroup[];
}

export function useSidebarAnimations({ docs, groups }: UseSidebarAnimationsOptions) {
  // Detect added/removed docs for animation
  const prevDocListRef = useRef<string[]>(docs.map((d) => d.id));
  const prevDocsSnapshotRef = useRef<Map<string, NoteDoc>>(new Map(docs.map((d) => [d.id, d])));
  const [newDocIds, setNewDocIds] = useState<Set<string>>(new Set());
  const [slideUpFromIndex, setSlideUpFromIndex] = useState(-1);
  const [exitingDoc, setExitingDoc] = useState<{ doc: NoteDoc; index: number } | null>(null);

  // Track groups that just expanded / collapsed (for child animation).
  // Detection happens during render (not in useEffect) so that a collapsing
  // group's notes can stay mounted for the animation — by the time an effect
  // runs React would already have filtered them out via `!group.collapsed`.
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [collapsingGroupIds, setCollapsingGroupIds] = useState<Set<string>>(new Set());
  const prevGroupCollapsedRef = useRef<Map<string, boolean>>(new Map(groups.map((g) => [g.id, g.collapsed])));

  // Track newly created groups (for slide-in animation)
  const prevGroupIdsRef = useRef<Set<string>>(new Set(groups.map((g) => g.id)));

  // Track groups being removed (for collapse-out animation)
  const [removingGroupIds, setRemovingGroupIds] = useState<Set<string>>(new Set());
  const [newGroupIds, setNewGroupIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prevList = prevDocListRef.current;
    const prevSet = new Set(prevList);
    const currentIds = docs.map((d) => d.id);
    const currentSet = new Set(currentIds);
    const timers: ReturnType<typeof setTimeout>[] = [];

    const added = new Set<string>();
    for (const id of currentIds) {
      if (!prevSet.has(id)) added.add(id);
    }
    let removedId: string | null = null;
    let removedIdx = -1;
    for (let idx = 0; idx < prevList.length; idx++) {
      if (!currentSet.has(prevList[idx])) {
        removedId = prevList[idx];
        removedIdx = idx;
        break;
      }
    }

    if (added.size > 0) {
      setNewDocIds(added);
      timers.push(setTimeout(() => setNewDocIds(new Set()), 300));
    }

    if (removedId && added.size === 0) {
      const snapshot = prevDocsSnapshotRef.current.get(removedId);
      if (snapshot) {
        // Exit animation handles the space collapse — no slideUp needed
        setExitingDoc({ doc: snapshot, index: removedIdx });
        timers.push(setTimeout(() => setExitingDoc(null), 280));
      } else {
        // Fallback: no snapshot, use slideUp
        setSlideUpFromIndex(removedIdx);
        timers.push(setTimeout(() => setSlideUpFromIndex(-1), 250));
      }
    }

    prevDocListRef.current = currentIds;
    prevDocsSnapshotRef.current = new Map(docs.map((d) => [d.id, d]));
    return () => timers.forEach(clearTimeout);
  }, [docs]);

  // Detect expand/collapse transitions synchronously during render (see note
  // above). Uses the "setState during render, guarded by a change condition"
  // pattern — React discards the current render and retries with the updated
  // state, so the collapse-animation class lands on the same paint as the
  // state flip and the notes never visibly disappear before animating out.
  {
    const prev = prevGroupCollapsedRef.current;
    const justExpanded: string[] = [];
    const justCollapsed: string[] = [];
    for (const g of groups) {
      const wasColl = prev.get(g.id);
      if (wasColl === true && !g.collapsed) justExpanded.push(g.id);
      else if (wasColl === false && g.collapsed) justCollapsed.push(g.id);
    }
    if (justExpanded.length > 0 || justCollapsed.length > 0) {
      prevGroupCollapsedRef.current = new Map(groups.map((g) => [g.id, g.collapsed]));
      if (justExpanded.length > 0) {
        setExpandedGroupIds((s) => {
          const next = new Set(s);
          for (const id of justExpanded) next.add(id);
          return next;
        });
        // Rapid toggle: cancel any in-flight collapse for these groups.
        setCollapsingGroupIds((s) => {
          if (!justExpanded.some((id) => s.has(id))) return s;
          const next = new Set(s);
          for (const id of justExpanded) next.delete(id);
          return next;
        });
      }
      if (justCollapsed.length > 0) {
        setCollapsingGroupIds((s) => {
          const next = new Set(s);
          for (const id of justCollapsed) next.add(id);
          return next;
        });
        setExpandedGroupIds((s) => {
          if (!justCollapsed.some((id) => s.has(id))) return s;
          const next = new Set(s);
          for (const id of justCollapsed) next.delete(id);
          return next;
        });
      }
    }
  }

  // Clear the in-flight animation sets after the animation finishes.
  // 420ms ≈ 280ms duration + up to ~5 notes of 30ms stagger; for larger
  // groups the tail is invisible (opacity 0) so running slightly long is fine.
  useEffect(() => {
    if (expandedGroupIds.size === 0) return;
    const timer = setTimeout(() => setExpandedGroupIds(new Set()), 420);
    return () => clearTimeout(timer);
  }, [expandedGroupIds]);

  useEffect(() => {
    if (collapsingGroupIds.size === 0) return;
    const timer = setTimeout(() => setCollapsingGroupIds(new Set()), 420);
    return () => clearTimeout(timer);
  }, [collapsingGroupIds]);

  // Detect newly created groups (for slide-in). Effect is fine here — notes
  // appear on mount so the class just needs to be applied post-render.
  useEffect(() => {
    const prevIds = prevGroupIdsRef.current;
    const addedGroups = new Set<string>();
    for (const g of groups) {
      if (!prevIds.has(g.id)) addedGroups.add(g.id);
    }
    prevGroupIdsRef.current = new Set(groups.map((g) => g.id));
    if (addedGroups.size === 0) return;
    setNewGroupIds(addedGroups);
    const timer = setTimeout(() => setNewGroupIds(new Set()), 250);
    return () => clearTimeout(timer);
  }, [groups]);

  const animateGroupRemoval = useCallback((groupId: string, noteIds: string[], callback: () => void) => {
    // Collect all IDs to animate: group header + its child notes
    const allIds = new Set<string>([groupId, ...noteIds]);
    setRemovingGroupIds(allIds);
    setTimeout(() => {
      callback();
      setRemovingGroupIds(new Set());
    }, 200);
  }, []);

  return {
    newDocIds,
    slideUpFromIndex,
    exitingDoc,
    expandedGroupIds,
    collapsingGroupIds,
    removingGroupIds,
    newGroupIds,
    animateGroupRemoval,
  };
}
