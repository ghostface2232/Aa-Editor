import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const floating = vi.hoisted(() => ({
  autoUpdate: vi.fn(() => vi.fn()),
  computePosition: vi.fn(async () => ({ x: 12, y: 34 })),
  flip: vi.fn((options?: unknown) => ({ name: "flip", options })),
  offset: vi.fn((options?: unknown) => ({ name: "offset", options })),
  shift: vi.fn((options?: unknown) => ({ name: "shift", options })),
}));

vi.mock("@floating-ui/dom", () => floating);

import { usePopoverAnchor } from "./usePopoverAnchor";

function renderPopoverAnchor(shiftCrossAxis?: boolean) {
  const popover = document.createElement("div");
  const reference = {
    getBoundingClientRect: () => new DOMRect(0, -500, 600, 2_000),
  };

  const hook = renderHook(() =>
    usePopoverAnchor({
      open: true,
      popoverRef: { current: popover },
      getReference: () => reference,
      placement: "top",
      offsetPx: 8,
      shiftPaddingPx: 10,
      shiftCrossAxis,
    }),
  );

  return { ...hook, popover };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePopoverAnchor", () => {
  it("keeps cross-axis overlap disabled by default", async () => {
    renderPopoverAnchor();

    await waitFor(() => expect(floating.computePosition).toHaveBeenCalled());
    expect(floating.shift).toHaveBeenCalledWith({ padding: 10, crossAxis: false });
  });

  it("combines best-fit flipping with cross-axis shifting for viewport-spanning references", async () => {
    const { popover } = renderPopoverAnchor(true);

    await waitFor(() => expect(floating.computePosition).toHaveBeenCalled());
    expect(floating.flip).toHaveBeenCalledWith({ fallbackStrategy: "bestFit" });
    expect(floating.shift).toHaveBeenCalledWith({ padding: 10, crossAxis: true });
    await waitFor(() => {
      expect(popover.style.left).toBe("12px");
      expect(popover.style.top).toBe("34px");
    });
  });
});
