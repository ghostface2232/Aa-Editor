import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const result = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(result).toEqual(["0:30", "1:10", "2:20", "3:0"]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n % 3));
      inFlight--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("returns an empty array without invoking the task", async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 8, async () => { calls++; return 1; });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("clamps a non-positive limit to a single worker instead of stalling", async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3], 0, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return n * 2;
    });
    expect(result).toEqual([2, 4, 6]);
    expect(peak).toBe(1);
  });

  it("rejects with the first failure and stops handing out new work", async () => {
    const started: number[] = [];
    const gate = deferred<void>();
    const call = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      if (n === 0) throw new Error("boom");
      await gate.promise;
      return n;
    });
    gate.resolve();
    await expect(call).rejects.toThrow("boom");
    // Item 0 fails immediately; its worker stops. The sibling worker finishes
    // the item it already picked up, but no further items are dispatched.
    expect(started).not.toContain(5);
  });

  it("lets tasks already in flight settle before rejecting", async () => {
    let settled = false;
    const call = mapWithConcurrency([0, 1], 2, async (n) => {
      if (n === 0) throw new Error("fail fast");
      await new Promise((r) => setTimeout(r, 5));
      settled = true;
      return n;
    });
    await expect(call).rejects.toThrow("fail fast");
    expect(settled).toBe(true);
  });
});
