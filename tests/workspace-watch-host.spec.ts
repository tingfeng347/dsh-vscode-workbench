/**
 * Behavioural proof for the rule the design states: a collapsed directory stops notifying, and
 * expanding it again resumes. Asserting chokidar's internal bookkeeping (getWatched) cannot show
 * that, because a stale closer keeps firing even after unwatch() removes the entry.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { createWorkspaceWatcher } from '../src/workspace-watch-host.ts'

const roots: string[] = []
const settle = (ms = 700) => new Promise<void>(resolve => setTimeout(resolve, ms))

afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 5 }) }, 60000)

it('notifies while a directory is expanded and goes quiet once it is collapsed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dvw-host-watch-'))
  roots.push(root)
  mkdirSync(join(root, 'wide'))
  writeFileSync(join(root, 'wide', 'a.txt'), 'a')

  const events: string[] = []
  const watcher = createWorkspaceWatcher({ workspace: root, ignored: () => false, onChange: path => events.push(path) })

  watcher.apply({ version: 1, paths: [''] })
  watcher.apply({ version: 2, paths: ['', 'wide'] })
  await settle()

  writeFileSync(join(root, 'wide', 'b.txt'), 'b')
  await settle()
  expect(events.some(path => path === 'wide/b.txt' || path.startsWith('wide/'))).toBe(true)

  // Collapsing must stop the notifications, not merely drop a bookkeeping entry.
  events.length = 0
  watcher.apply({ version: 3, paths: [''] })
  expect(watcher.watching()).toEqual([root])
  await settle()
  writeFileSync(join(root, 'wide', 'c.txt'), 'c')
  await settle()
  expect(events.filter(path => path.startsWith('wide/'))).toEqual([])

  // Re-expanding reads the directory fresh and resumes notifications.
  watcher.apply({ version: 4, paths: ['', 'wide'] })
  await settle()
  writeFileSync(join(root, 'wide', 'd.txt'), 'd')
  await settle()
  expect(events.some(path => path.startsWith('wide/'))).toBe(true)

  await watcher.close()
}, 60000)

it('never watches a path that resolves outside the workspace', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'dvw-outside-'))
  const root = mkdtempSync(join(tmpdir(), 'dvw-inside-'))
  roots.push(outside, root)
  mkdirSync(join(root, 'inner'))

  const watcher = createWorkspaceWatcher({ workspace: root, ignored: () => false, onChange: () => undefined })
  // A junction/symlink is platform-dependent to create portably, so assert on the pure rule the
  // host relies on: the resolved path of a sibling root is outside.
  const result = watcher.apply({ version: 1, paths: ['', '../..'] })
  expect(result.skipped.map(row => row.reason)).toContain('outside')
  expect(result.watching).toEqual([''])
  await watcher.close()
}, 30000)