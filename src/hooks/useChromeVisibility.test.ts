import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChromeVisibility } from "./useChromeVisibility";

let el: HTMLDivElement;
let ref: { current: HTMLDivElement | null };
let raf: ((cb: FrameRequestCallback) => number) | undefined;
let caf: ((id: number) => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  el = document.createElement("div");
  document.body.appendChild(el);
  // The hook keys its effects on the ref object's identity, so it must be
  // stable across renders — a fresh literal per render would re-run the
  // document-switch effect after every state change.
  ref = { current: el };
  raf = window.requestAnimationFrame;
  caf = window.cancelAnimationFrame;
  // Back rAF with a (fake) timer so the frame fires after the hook has
  // recorded its id — a synchronous stub would run evaluate before the id is
  // stored and leave the hook thinking a frame is still pending.
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 16) as unknown as number;
  window.cancelAnimationFrame = (id) => clearTimeout(id);
});

afterEach(() => {
  if (raf) window.requestAnimationFrame = raf;
  if (caf) window.cancelAnimationFrame = caf;
  el.remove();
  vi.useRealTimers();
});

function scrollTo(top: number) {
  act(() => {
    Object.defineProperty(el, "scrollTop", { value: top, configurable: true });
    el.dispatchEvent(new Event("scroll"));
    // Step past the 300ms post-toggle lock so consecutive scrolls all count.
    vi.advanceTimersByTime(400);
  });
}

function mount(freeze = false) {
  return renderHook(
    ({ freeze, docId }) => useChromeVisibility(ref, docId, false, freeze),
    { initialProps: { freeze, docId: "doc-1" } },
  );
}

describe("useChromeVisibility freezeChrome", () => {
  it("hides on scroll-down and shows on scroll-up when not frozen", () => {
    const { result } = mount(false);
    scrollTo(100);
    expect(result.current.chromeVisible).toBe(false);
    scrollTo(50);
    expect(result.current.chromeVisible).toBe(true);
  });

  it("keeps the chrome visible while frozen, regardless of scroll direction", () => {
    const { result, rerender } = mount(false);
    expect(result.current.chromeVisible).toBe(true);
    rerender({ freeze: true, docId: "doc-1" });
    scrollTo(100);
    scrollTo(300);
    expect(result.current.chromeVisible).toBe(true);
  });

  it("shows a hidden toolbar when the freeze starts, then holds it on scroll", () => {
    const { result, rerender } = mount(false);
    scrollTo(200);
    expect(result.current.chromeVisible).toBe(false);
    rerender({ freeze: true, docId: "doc-1" });
    expect(result.current.chromeVisible).toBe(true);
    scrollTo(400);
    scrollTo(100);
    scrollTo(600);
    expect(result.current.chromeVisible).toBe(true);
  });

  it("keeps recording scroll positions during the freeze", () => {
    const { result, rerender } = mount(false);
    rerender({ freeze: true, docId: "doc-1" });
    scrollTo(400);
    rerender({ freeze: false, docId: "doc-1" });
    // Still visible: unfreezing at 400 re-evaluates position only, and a
    // scroll-up from the recorded 400 must read as an upward delta.
    scrollTo(300);
    expect(result.current.chromeVisible).toBe(true);
    scrollTo(500);
    expect(result.current.chromeVisible).toBe(false);
  });

  it("re-evaluates once when the freeze lifts at the top of the document", () => {
    const { result, rerender } = mount(false);
    scrollTo(200);
    rerender({ freeze: true, docId: "doc-1" });
    scrollTo(0);
    rerender({ freeze: false, docId: "doc-1" });
    expect(result.current.chromeVisible).toBe(true);
  });

  it("re-evaluates once when the freeze lifts deep in the document", () => {
    const { result, rerender } = mount(false);
    rerender({ freeze: true, docId: "doc-1" });
    scrollTo(500);
    rerender({ freeze: false, docId: "doc-1" });
    expect(result.current.chromeVisible).toBe(false);
  });

  it("keeps the toolbar visible on document switch while frozen", () => {
    const { result, rerender } = mount(false);
    rerender({ freeze: true, docId: "doc-1" });
    scrollTo(500);
    act(() => { rerender({ freeze: true, docId: "doc-2" }); vi.advanceTimersByTime(50); });
    expect(result.current.chromeVisible).toBe(true);
  });
});
