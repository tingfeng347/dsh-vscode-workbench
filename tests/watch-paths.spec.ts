import { expect, it } from 'vitest'
import { isStaleManifest, mergeWatchPaths, nextRetryDelay, nextWatchVersion } from '../src/client/watch-paths.ts'

it('always includes the workspace root', () => {
  expect(mergeWatchPaths([], [])).toEqual([''])
  expect(mergeWatchPaths(['src'], [])).toEqual(['', 'src'])
})

it('adds a file the user just opened, even when its directory is collapsed', () => {
  const manifest = mergeWatchPaths([''], ['deep/nested/file.ts'])
  expect(manifest).toContain('deep/nested/file.ts')
})

it('folds duplicates between expanded directories and open files', () => {
  expect(mergeWatchPaths(['src', 'src'], ['src', 'src/a.ts'])).toEqual(['', 'src', 'src/a.ts'])
})

it('never treats a virtual diff buffer as a file on disk', () => {
  expect(mergeWatchPaths([''], ['diff:commit:abc123', 'image:preview'])).toEqual([''])
})

it('ignores empty and non-string entries', () => {
  expect(mergeWatchPaths(['', 'a'], ['', 'b'])).toEqual(['', 'a', 'b'])
})

it('advances the manifest version by one', () => {
  expect(nextWatchVersion(0)).toBe(1)
  expect(nextWatchVersion(41)).toBe(42)
})

it('drops a stale or invalid manifest version', () => {
  expect(isStaleManifest(3, 3)).toBe(true)
  expect(isStaleManifest(2, 3)).toBe(true)
  expect(isStaleManifest(4, 3)).toBe(false)
  expect(isStaleManifest(Number.NaN, 3)).toBe(true)
})
it('backs off further on each reconnect attempt and caps the wait', () => {
  expect(nextRetryDelay(0)).toBe(1000)
  expect(nextRetryDelay(1)).toBe(2000)
  expect(nextRetryDelay(3)).toBe(8000)
  expect(nextRetryDelay(10)).toBe(15000)
  expect(nextRetryDelay(-2)).toBe(1000)
})