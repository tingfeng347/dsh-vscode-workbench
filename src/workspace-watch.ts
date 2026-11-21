/**
 * On-demand workspace watching.
 *
 * The editor only needs change notifications for what the user can currently see: the top level of
 * the workspace, the directories they expanded, and the files they opened. Watching the whole tree
 * instead burns file descriptors and drags in `node_modules`-sized subtrees, so the client sends a
 * versioned manifest and this module turns it into the smallest set of watch registrations.
 *
 * The diffing is pure: the chokidar backend is injected, which keeps the interesting rules — path
 * validation, symlink refusal, ignore handling, add/remove stability — testable without touching a
 * real filesystem.
 */

/** What the editor currently needs notifications for. */
export interface WatchManifest {
  /** Monotonic; a stale version must never be applied over a newer one. */
  version: number
  /** Workspace-relative paths: '' is the root itself. */
  paths: string[]
}

export interface WatchBackend {
  /** Register a path. `depth: 0` reports direct children only. */
  add(absolute: string, depth: number): void
  unwatch(absolute: string): void
}

export interface WatchRules {
  /** True when the absolute path is a symlink or junction; those are skipped, not followed. */
  isLink(absolute: string): boolean
  /** True when the path is excluded by the workspace ignore rules. */
  ignored(absolute: string): boolean
}

export interface ApplyResult {
  version: number
  added: string[]
  removed: string[]
  /** Paths the manifest asked for but that were refused, with the reason. */
  skipped: Array<{ path: string; reason: 'link' | 'ignored' | 'outside' | 'absolute' }>
  /** Relative paths now being watched, sorted, for assertions and diagnostics. */
  watching: string[]
}

/** Reject anything that is not a plain workspace-relative path. */
export function normalizeRelative(raw: string): { path: string } | { reason: 'absolute' | 'outside' } | undefined {
  const value = raw.replace(/\\/g, '/').trim()
  if (value === '' || value === '.') return { path: '' }
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return { reason: 'absolute' }
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return { reason: 'outside' }
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return { path: parts.join('/') }
}

/**
 * Turn a manifest into the watch set, applying it to the backend.
 *
 * Invariants:
 * - paths already watched are never re-added (a re-add would reset chokidar's ignoreInitial work);
 * - a path that disappears from the manifest is unwatched immediately, so collapsing a directory
 *   releases its file descriptors;
 * - symlinks and ignored paths are skipped and reported, never silently followed.
 */
export function applyManifest(
  root: string,
  manifest: WatchManifest,
  current: ReadonlySet<string>,
  backend: WatchBackend,
  rules: WatchRules,
  join: (root: string, relative: string) => string,
): ApplyResult {
  const desired = new Map<string, string>()
  const skipped: ApplyResult['skipped'] = []

  for (const raw of manifest.paths) {
    const normalized = normalizeRelative(raw)
    if (normalized === undefined) continue
    if ('reason' in normalized) { skipped.push({ path: raw, reason: normalized.reason }); continue }
    const relative = normalized.path
    const absolute = relative === '' ? root : join(root, relative)
    if (rules.isLink(absolute)) { skipped.push({ path: relative, reason: 'link' }); continue }
    if (relative !== '' && rules.ignored(absolute)) { skipped.push({ path: relative, reason: 'ignored' }); continue }
    desired.set(absolute, relative)
  }

  const added: string[] = []
  for (const [absolute, relative] of desired) {
    if (current.has(absolute)) continue
    backend.add(absolute, 0)
    added.push(relative)
  }

  const removed: string[] = []
  for (const absolute of current) {
    if (desired.has(absolute)) continue
    backend.unwatch(absolute)
    removed.push(absolute)
  }

  const watching = [...desired.values()].sort()
  return { version: manifest.version, added, removed, skipped, watching }
}

/** Does a changed path belong to a watched directory's immediate children? */
export function affectsWatchedDirectory(directory: string, changed: string): boolean {
  const dir = directory.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = changed.replace(/\\/g, '/').replace(/^\/+/, '')
  if (dir === '') return !file.includes('/')
  if (!file.startsWith(`${dir}/`)) return false
  return !file.slice(dir.length + 1).includes('/')
}
/**
 * Does a resolved path live outside the resolved workspace root?
 *
 * `lstat` alone misses `link/sub`: the entry is a plain directory, but its real location is
 * wherever the link points. Comparing resolved paths closes that gap.
 */
export function escapesWorkspace(workspaceReal: string, resolved: string, separator: string): boolean {
  if (resolved === workspaceReal) return false
  const prefix = workspaceReal.endsWith(separator) ? workspaceReal : workspaceReal + separator
  return !resolved.startsWith(prefix)
}
