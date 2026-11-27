/**
 * Restoring a saved tree must not compete with the first screen.
 *
 * A workspace can remember dozens of expanded directories; mounting all of their trees at once
 * fires that many directory reads before anything is visible. The saved set is therefore replayed
 * in small batches, shallowest first, and any click the user makes pauses the replay so their
 * directory never queues behind it.
 */

/** Order a saved expansion list for replay: shallow directories first, then by name. */
export function orderForRestore(saved: readonly string[]): string[] {
  const depth = (path: string) => path.split('/').filter(Boolean).length
  return [...new Set(saved)].sort((left, right) => {
    const byDepth = depth(left) - depth(right)
    return byDepth !== 0 ? byDepth : left.localeCompare(right)
  })
}

/** Split the ordered list into replay batches; `batch` is clamped to at least one entry. */
export function splitRestore(saved: readonly string[], batch = 2): string[][] {
  const size = Math.max(1, Math.floor(batch))
  const ordered = orderForRestore(saved)
  const batches: string[][] = []
  for (let index = 0; index < ordered.length; index += size) batches.push(ordered.slice(index, index + size))
  return batches
}

/**
 * The replay yields while the user is actively opening directories, so their click is never
 * delayed by background restoration.
 */
export function shouldPauseRestore(lastUserActionAt: number | undefined, now: number, quietMs = 800): boolean {
  if (lastUserActionAt === undefined) return false
  return now - lastUserActionAt < quietMs
}

/** Delay before the next background batch, long enough for the previous trees to render. */
export const RESTORE_STEP_MS = 250