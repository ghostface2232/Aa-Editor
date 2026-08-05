/**
 * Map over `items` with at most `limit` tasks in flight, preserving input
 * order in the result.
 *
 * Startup fans out one filesystem read per note. Through the Tauri IPC bridge
 * an unbounded `Promise.all` over a few thousand notes queues every read at
 * once; on an OneDrive/Dropbox folder each of those can also trigger placeholder
 * hydration, so the cold start degrades far worse than the file count suggests.
 * A fixed window keeps the pipe busy without the stampede.
 *
 * A rejected task rejects the whole call (same contract as `Promise.all`), but
 * tasks already started are allowed to settle first so no write is orphaned
 * mid-flight.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  let failure: unknown = null;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index], index);
      } catch (err) {
        // Remember the first failure and stop handing out work, but let the
        // sibling workers finish what they already picked up.
        if (failure === null) failure = err ?? new Error("mapWithConcurrency task failed");
        next = items.length;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  if (failure !== null) throw failure;
  return results;
}
