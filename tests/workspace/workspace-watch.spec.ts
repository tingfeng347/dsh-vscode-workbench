import { expect, it } from 'vitest'
import { affectsWatchedDirectory, applyManifest, escapesWorkspace, normalizeRelative, type WatchBackend } from '../../src/shared/workspace-watch.ts'

const join = (root: string, relative: string) => `${root}/${relative}`
const root = 'D:/work'

function backend() {
  const watched = new Set<string>()
  const calls: Array<{ op: 'add' | 'unwatch'; path: string }> = []
  const api: WatchBackend = {
    add(absolute) { watched.add(absolute); calls.push({ op: 'add', path: absolute }) },
    unwatch(absolute) { watched.delete(absolute); calls.push({ op: 'unwatch', path: absolute }) },
  }
  return { api, watched, calls }
}

const rules = { isLink: () => false, ignored: () => false }

it('watches the root and only the directories the manifest names', () => {
  const { api, watched } = backend()
  const result = applyManifest(root, { version: 1, paths: ['', 'src', 'src/client'] }, new Set(), api, rules, join)
  expect(result.watching).toEqual(['', 'src', 'src/client'])
  expect(watched.size).toBe(3)
})

it('never re-adds a path that is already watched', () => {
  const { api, calls } = backend()
  applyManifest(root, { version: 1, paths: ['', 'src'] }, new Set(), api, rules, join)
  calls.length = 0
  const second = applyManifest(root, { version: 2, paths: ['', 'src'] }, new Set([`${root}`, `${root}/src`]), api, rules, join)
  expect(second.added).toEqual([])
  expect(calls).toEqual([])
})

it('releases a directory as soon as it leaves the manifest', () => {
  const { api, calls } = backend()
  const result = applyManifest(root, { version: 2, paths: [''] }, new Set([`${root}`, `${root}/src`]), api, rules, join)
  expect(result.removed).toEqual([`${root}/src`])
  expect(calls).toEqual([{ op: 'unwatch', path: `${root}/src` }])
})

it('skips symlinked and ignored paths instead of following them', () => {
  const { api } = backend()
  const result = applyManifest(
    root, { version: 1, paths: ['', 'linked', 'node_modules'] }, new Set(), api,
    { isLink: path => path.endsWith('/linked'), ignored: path => path.endsWith('/node_modules') }, join,
  )
  expect(result.skipped).toEqual([
    { path: 'linked', reason: 'link' },
    { path: 'node_modules', reason: 'ignored' },
  ])
  expect(result.watching).toEqual([''])
})

it('refuses absolute and escaping paths', () => {
  expect(normalizeRelative('C:/Windows')).toEqual({ reason: 'absolute' })
  expect(normalizeRelative('/etc')).toEqual({ reason: 'absolute' })
  expect(normalizeRelative('../outside')).toEqual({ reason: 'outside' })
  expect(normalizeRelative('a/../../b')).toEqual({ reason: 'outside' })
  expect(normalizeRelative('a/./b/../c')).toEqual({ path: 'a/c' })
  expect(normalizeRelative('')).toEqual({ path: '' })

  const { api } = backend()
  const result = applyManifest(root, { version: 1, paths: ['C:/Windows', '../x', ''] }, new Set(), api, rules, join)
  expect(result.skipped.map(row => row.reason)).toEqual(['absolute', 'outside'])
  expect(result.watching).toEqual([''])
})

it('only reports immediate children of a watched directory', () => {
  expect(affectsWatchedDirectory('src', 'src/a.ts')).toBe(true)
  expect(affectsWatchedDirectory('src', 'src/deep/a.ts')).toBe(false)
  expect(affectsWatchedDirectory('', 'a.ts')).toBe(true)
  expect(affectsWatchedDirectory('', 'src/a.ts')).toBe(false)
  expect(affectsWatchedDirectory('src', 'other/a.ts')).toBe(false)
})

it('drops everything when the manifest becomes empty apart from the root', () => {
  const { api, watched } = backend()
  const current = new Set([`${root}`, `${root}/a`, `${root}/b`])
  const result = applyManifest(root, { version: 9, paths: [''] }, current, api, rules, join)
  expect(result.removed.sort()).toEqual([`${root}/a`, `${root}/b`])
  expect(watched.has(`${root}/a`)).toBe(false)
})
it('treats a path inside a symlinked directory as outside the workspace', () => {
  // realpathSync returns native separators on Windows, so the rule is tested with them.
  const real = 'D:\\work'
  expect(escapesWorkspace(real, 'D:\\work', '\\')).toBe(false)
  expect(escapesWorkspace(real, 'D:\\work\\src', '\\')).toBe(false)
  // `link/sub` resolves here: the entry is a plain directory but the real path is elsewhere.
  expect(escapesWorkspace(real, 'C:\\elsewhere\\sub', '\\')).toBe(true)
  // A sibling whose name merely starts with the root name must not pass.
  expect(escapesWorkspace(real, 'D:\\work2\\src', '\\')).toBe(true)
})
