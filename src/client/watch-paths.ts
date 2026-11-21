/**
 * The watch manifest is the union of what the explorer expanded and what the editor has open.
 * Keeping the merge here makes the rule testable without mounting the workbench: duplicates are
 * folded, the root is always present, and diff buffers (which have no real file) are excluded.
 */

/** Merge expanded directories with open file paths into the manifest payload. */
export function mergeWatchPaths(expanded: readonly string[], open: readonly string[]): string[] {
  const paths = new Set<string>([''])
  for (const path of expanded) {
    if (typeof path === 'string' && path !== '') paths.add(path)
  }
  for (const path of open) {
    if (typeof path !== 'string' || path === '') continue
    // `diff:` and `image:` style tabs are virtual documents, not files on disk.
    if (/^[a-z]+:/i.test(path)) continue
    paths.add(path)
  }
  return [...paths]
}

/** A manifest version may only move forward; stale replies must not overwrite newer state. */
export function nextWatchVersion(previous: number): number {
  return previous + 1
}

/** Ignore a manifest whose version is not newer than the one already applied. */
export function isStaleManifest(incoming: number, applied: number): boolean {
  return !Number.isFinite(incoming) || incoming <= applied
}
/** Backoff for reconnecting the files socket: 1s, 2s, 4s ... capped at 15s. */
export function nextRetryDelay(attempt: number): number {
  const step = Math.max(0, Math.floor(attempt))
  return Math.min(1000 * 2 ** step, 15000)
}
