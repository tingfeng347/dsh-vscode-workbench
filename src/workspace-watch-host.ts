/**
 * The host half of on-demand watching.
 *
 * Kept out of the socket handler so the behaviour that actually matters — "collapsing a directory
 * releases every handle under it" — can be proven against real chokidar in a test instead of being
 * asserted through chokidar-internal bookkeeping.
 */
import { lstatSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import chokidar from 'chokidar'
import { applyManifest, escapesWorkspace, type WatchBackend, type WatchManifest, type WatchRules } from './workspace-watch.ts'

export interface WorkspaceWatcherOptions {
  /** The session workspace, already resolved by the caller. */
  workspace: string
  /** Exclusion rule from the workspace's .gitignore plus the built-in trees. */
  ignored: (absolute: string) => boolean
  /** Called with a workspace-relative path (forward slashes) when something changes. */
  onChange: (relativePath: string) => void
}

export interface WorkspaceWatcher {
  apply(manifest: WatchManifest): ReturnType<typeof applyManifest>
  /** Paths currently watched, relative, for assertions and diagnostics. */
  watching(): string[]
  close(): Promise<void>
}

const WAIT = { stabilityThreshold: 100, pollInterval: 50 }

export function createWorkspaceWatcher(options: WorkspaceWatcherOptions): WorkspaceWatcher {
  const workspaceReal = realpathSync(options.workspace)
  const tracked = new Set<string>()
  let instance = chokidar.watch([], {
    ignoreInitial: true, followSymlinks: false, depth: 0, ignored: options.ignored, awaitWriteFinish: WAIT,
  })

  const attach = (target: ReturnType<typeof chokidar.watch>) => {
    target.on('all', (_event, path) => {
      const relative = path.startsWith(options.workspace)
        ? path.slice(options.workspace.length).replace(/^[\\/]+/, '').split(sep).join('/')
        : path.split(sep).join('/')
      options.onChange(relative)
    })
    target.on('error', () => { void target.close() })
    return target
  }
  attach(instance)

  const rules: WatchRules = {
    // A junction or symlink would drag the watcher out of the workspace, so it is refused. Resolving
    // as well catches `link/sub`, where the entry is a plain directory but lives elsewhere.
    isLink: absolute => {
      try {
        if (lstatSync(absolute).isSymbolicLink()) return true
        return escapesWorkspace(workspaceReal, realpathSync(absolute), sep)
      } catch { return true }
    },
    ignored: absolute => options.ignored(absolute),
  }

  const backend: WatchBackend = {
    add(absolute) { tracked.add(absolute); void instance.add(absolute) },
    // Measured with chokidar 4.0.3 in this exact configuration (depth 0, directory added on
    // its own): after unwatch() a write to a direct child produces no event, so no rebuild is
    // needed. The stale-closer behaviour only appears for recursive watchers, which this host
    // never uses.
    unwatch(absolute) {
      tracked.delete(absolute)
      void instance.unwatch(absolute)
    },
  }

  return {
    apply(manifest) {
      return applyManifest(options.workspace, manifest, new Set(tracked), backend, rules, join)
    },
    watching() { return [...tracked] },
    async close() { await instance.close() },
  }
}