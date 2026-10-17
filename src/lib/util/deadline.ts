import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Time budget for a unit of background work (an evaluation or OCR job). Serverless functions are
 * killed at their maxDuration without running any cleanup, so model calls must stop early enough
 * for the job to record a clear failure instead of disappearing mid-run.
 */
const store = new AsyncLocalStorage<number>();

export function withDeadline<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const outer = store.getStore();
  const at = Math.min(Date.now() + ms, outer ?? Infinity);
  return store.run(at, fn);
}

/** Milliseconds left in the current budget (Infinity outside any budget). */
export function remainingMs(): number {
  const at = store.getStore();
  return at === undefined ? Infinity : at - Date.now();
}
