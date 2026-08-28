import { useState, useEffect, useLayoutEffect, useCallback, useRef, type RefObject } from "react";

const CHROME_HIDE_SCROLL_THRESHOLD = 36;
const CHROME_LOCK_MS = 300;

export function useChromeVisibility(
  contentRef: RefObject<HTMLDivElement | null>,
  activeDocId: string | undefined,
  pinEditorToolbar: boolean,
  // While a floating bar (find/replace, go-to-line) is open, the toolbar must
  // neither hide nor reappear on scroll: the bar is anchored below the
  // toolbar, so every toggle would shift it under the user's cursor. Opening
  // the bar shows the toolbar once (so the bar always sits in the same place
  // and an editor click cannot un-hide it later), then visibility is frozen
  // until the bar closes, when one fresh evaluation runs.
  freezeChrome = false,
) {
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeLockUntilRef = useRef(0);
  const chromeVisibleRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const freezeChromeRef = useRef(freezeChrome);
  useLayoutEffect(() => {
    freezeChromeRef.current = freezeChrome;
  }, [freezeChrome]);

  const handleShowEditorChrome = useCallback(() => {
    if (freezeChromeRef.current) return;
    chromeVisibleRef.current = true;
    setChromeVisible(true);
    chromeLockUntilRef.current = Date.now() + CHROME_LOCK_MS;
  }, []);

  // Freeze the show/hide reaction without changing the current visibility —
  // for programmatic scrolls (outline jumps) that must not flash the toolbar.
  // Scroll positions keep being recorded during the lock, so on unlock only
  // genuinely new user deltas are evaluated.
  const lockEditorChrome = useCallback((ms: number) => {
    chromeLockUntilRef.current = Date.now() + ms;
  }, []);

  // Drop an active lock immediately — the user intervened and normal
  // scroll-driven behavior must resume at once.
  const unlockEditorChrome = useCallback(() => {
    chromeLockUntilRef.current = 0;
  }, []);

  const [toolbarHeight, setToolbarHeight] = useState(0);
  const editorTopOffset = Math.max(toolbarHeight - 16, 0);
  const handleBarHeight = useCallback((h: number) => {
    setToolbarHeight((prev) => (prev === h ? prev : h));
  }, []);

  useEffect(() => {
    if (pinEditorToolbar) {
      chromeVisibleRef.current = true;
      setChromeVisible(true);
      chromeLockUntilRef.current = 0;
      return;
    }

    const el = contentRef.current;
    if (!el) return;

    // Coalesce to one evaluation per frame: a fling fires dozens of scroll
    // events per frame, and each one read scrollTop (a layout-forcing read) and
    // could setState. Reading inside the rAF collapses that to a single read +
    // at most one state change per frame. Behavior is unchanged — only the
    // latest scroll position per frame matters for the show/hide decision.
    let frame: number | null = null;

    const evaluate = () => {
      frame = null;
      const nextTop = el.scrollTop;
      const now = Date.now();

      if (freezeChromeRef.current || now < chromeLockUntilRef.current) {
        lastScrollTopRef.current = nextTop;
        return;
      }

      const previousTop = lastScrollTopRef.current;
      let next: boolean | undefined;

      if (nextTop <= 1) {
        next = true;
      } else if (nextTop < previousTop) {
        next = true;
      } else if (nextTop >= CHROME_HIDE_SCROLL_THRESHOLD) {
        next = false;
      }

      if (next !== undefined && next !== chromeVisibleRef.current) {
        chromeVisibleRef.current = next;
        setChromeVisible(next);
        chromeLockUntilRef.current = now + 300;
      }

      lastScrollTopRef.current = nextTop;
    };

    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(evaluate);
    };

    lastScrollTopRef.current = el.scrollTop;
    evaluate();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [contentRef, pinEditorToolbar]);

  useEffect(() => {
    if (pinEditorToolbar) {
      chromeVisibleRef.current = true;
      setChromeVisible(true);
      lastScrollTopRef.current = contentRef.current?.scrollTop ?? 0;
      return;
    }

    requestAnimationFrame(() => {
      const el = contentRef.current;
      if (!el) return;
      const nextTop = el.scrollTop;
      lastScrollTopRef.current = nextTop;
      const next = freezeChromeRef.current || nextTop < CHROME_HIDE_SCROLL_THRESHOLD;
      chromeVisibleRef.current = next;
      setChromeVisible(next);
    });
  }, [activeDocId, contentRef, pinEditorToolbar]);

  // Entering the freeze: show the toolbar so the bar anchors below it.
  // Leaving it: re-run the position check once, since scrolls during the
  // freeze were recorded but never acted on (a bar closed at the top of the
  // document must not leave the toolbar hidden with no scroll left to show it).
  const freezeInitRef = useRef(true);
  useEffect(() => {
    if (freezeInitRef.current) {
      freezeInitRef.current = false;
      if (!freezeChrome) return;
    }
    if (freezeChrome) {
      chromeVisibleRef.current = true;
      setChromeVisible(true);
      chromeLockUntilRef.current = 0;
      return;
    }
    if (pinEditorToolbar) return;
    const el = contentRef.current;
    if (!el) return;
    const nextTop = el.scrollTop;
    lastScrollTopRef.current = nextTop;
    const next = nextTop < CHROME_HIDE_SCROLL_THRESHOLD;
    if (next !== chromeVisibleRef.current) {
      chromeVisibleRef.current = next;
      setChromeVisible(next);
    }
  }, [freezeChrome, pinEditorToolbar, contentRef]);

  return {
    chromeVisible,
    toolbarHeight,
    editorTopOffset,
    handleShowEditorChrome,
    lockEditorChrome,
    unlockEditorChrome,
    handleBarHeight,
  };
}
