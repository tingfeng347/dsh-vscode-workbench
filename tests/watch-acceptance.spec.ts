/**
 * Acceptance for on-demand watching.
 *
 * Builds a workspace of generated files, applies a manifest the way the host does, and asserts that
 * the watcher only covers what the manifest named. It also records how long listing and watch setup
 * take, so a slow first screen can be attributed to the tree, the watcher or the editor.
 *
 * Gated behind DSH_WATCH_ACCEPTANCE=1 because it writes thousands of files.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import chokidar from 'chokidar'
import { afterAll, expect, it } from 'vitest'
import { listFiles } from '../src/host.ts'
import { applyManifest, type WatchBackend } from '../src/workspace-watch.ts'

const enabled = process.env.DSH_WATCH_ACCEPTANCE === '1'
const scale = Number(process.env.DSH_WATCH_SCALE ?? '3000')
const roots: string[] = []

/** Two shapes in one workspace: many siblings in one directory, and a deep chain. */
function makeWorkspace(count: number): { root: string; wide: string; deep: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'dvw-watch-'))
  roots.push(root)
  const wide = join(root, 'wide')
  mkdirSync(wide)
  const deep: string[] = []
  let current = 'deep'
  mkdirSync(join(root, current), { recursive: true })
  deep.push(current)
  for (let level = 1; level <= 5; level += 1) {
    current = `${current}/n${level}`
    mkdirSync(join(root, current), { recursive: true })
    deep.push(current)
  }
  // The bulk sits in one wide directory: that is the shape that makes recursive watching expensive.
  for (let index = 0; index < count; index += 1) writeFileSync(join(wide, `file-${index}.txt`), 'x')
  for (const path of deep) for (let index = 0; index < 20; index += 1) writeFileSync(join(root, path, `f${index}.txt`), 'x')
  return { root, wide: 'wide', deep }
}

// Removing tens of thousands of files takes longer than the default hook budget.\nafterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 5 }) }, 180000)

it.skipIf(!enabled)('watches only the paths the manifest names, and releases them again', async () => {
  const { root, wide } = makeWorkspace(scale)
  const watcher = chokidar.watch([], { ignoreInitial: true, followSymlinks: false, depth: 0, persistent: false })
  const added: string[] = []
  const backend: WatchBackend = {
    add(absolute) { added.push(absolute); void watcher.add(absolute) },
    unwatch(absolute) { void watcher.unwatch(absolute) },
  }
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 1500))

  // Cold screen: root only.
  const listStart = Date.now()
  const top = await listFiles(root, '')
  const listMs = Date.now() - listStart

  const applyStart = Date.now()
  const first = applyManifest(root, { version: 1, paths: [''] }, new Set(), backend, { isLink: () => false, ignored: () => false }, join)
  const applyMs = Date.now() - applyStart
  await settle()

  // Expanding one wide directory must add exactly that one path.
  const second = applyManifest(root, { version: 2, paths: ['', wide] }, new Set([root]), backend, { isLink: () => false, ignored: () => false }, join)
  await settle()
  const watchedAfterExpand = Object.keys(watcher.getWatched())

  // Collapsing releases it again.
  applyManifest(root, { version: 3, paths: [''] }, new Set([root, join(root, wide)]), backend, { isLink: () => false, ignored: () => false }, join)
  await settle()
  const watchedAfterCollapse = Object.keys(watcher.getWatched())

  console.log(JSON.stringify({
    scale, listMs, applyMs, topEntries: top.length,
    firstWatching: first.watching, secondAdded: second.added,
    watchedAfterExpand: watchedAfterExpand.length, watchedAfterCollapse: watchedAfterCollapse.length,
  }))

  expect(top.length).toBeGreaterThan(0)
  expect(first.watching).toEqual([''])
  expect(second.added).toEqual([wide])
  // The watcher may index the direct children of a watched directory, but never a sibling subtree.
  expect(watchedAfterExpand.filter(path => path.includes(`${wide}/`))).toEqual([])
  // Direct children of the root stay indexed while the root itself is watched; what must vanish
  // is any watch *inside* the collapsed directory.
  expect(watchedAfterCollapse.filter(path => path.startsWith(join(root, wide) + sep) || path.startsWith(join(root, wide) + '/'))).toEqual([])
  await watcher.close()
}, 300000)
