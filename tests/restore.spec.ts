import { expect, it } from 'vitest'
import { orderForRestore, RESTORE_STEP_MS, shouldPauseRestore, splitRestore } from '../src/client/restore.ts'

it('replays shallow directories before deep ones', () => {
  expect(orderForRestore(['src/client/deep', 'src', '', 'a'])).toEqual(['', 'a', 'src', 'src/client/deep'])
})

it('deduplicates and sorts siblings by name', () => {
  expect(orderForRestore(['b', 'a', 'b'])).toEqual(['a', 'b'])
})

it('splits into batches of at most two by default', () => {
  const batches = splitRestore(['a', 'a/b', 'a/b/c', '', 'x', 'y'])
  expect(batches.map(batch => batch.length)).toEqual([2, 2, 2])
  expect(batches[0]).toEqual(['', 'a'])
})

it('clamps a non-positive batch size to one', () => {
  expect(splitRestore(['a', 'b'], 0).map(batch => batch.length)).toEqual([1, 1])
  expect(splitRestore(['a', 'b'], -3).map(batch => batch.length)).toEqual([1, 1])
})

it('returns no batches for an empty saved list', () => {
  expect(splitRestore([])).toEqual([])
})

it('pauses the replay while the user is clicking', () => {
  expect(shouldPauseRestore(undefined, 1000)).toBe(false)
  expect(shouldPauseRestore(900, 1000)).toBe(true)
  expect(shouldPauseRestore(100, 1000)).toBe(false)
  expect(shouldPauseRestore(900, 1000, 200)).toBe(true)
  expect(shouldPauseRestore(500, 1000, 200)).toBe(false)
})

it('keeps a step delay that leaves room for a render', () => {
  expect(RESTORE_STEP_MS).toBeGreaterThanOrEqual(100)
})