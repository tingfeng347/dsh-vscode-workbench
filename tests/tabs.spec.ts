import { expect, it } from 'vitest'
import { moveTabToGroup, swapActiveTab, type TabGroupLike } from '../src/client/tabs.ts'

type T = { path: string }
const tab = (path: string): T => ({ path })
const groups = (...rows: Array<[string, string[], string?]>): TabGroupLike<T>[] =>
  rows.map(([id, paths, active]) => ({ id, tabs: paths.map(tab), active: active ?? paths[0] }))

it('moves a tab into another group and activates it there', () => {
  const next = moveTabToGroup(groups(['a', ['x', 'y'], 'x'], ['b', ['z'], 'z']), 'a', 'y', 'b')!
  expect(next[0]!.tabs.map(row => row.path)).toEqual(['x'])
  expect(next[0]!.active).toBe('x')
  expect(next[1]!.tabs.map(row => row.path)).toEqual(['z', 'y'])
  expect(next[1]!.active).toBe('y')
})

it('leaves the source active tab alone when another tab was dragged', () => {
  const next = moveTabToGroup(groups(['a', ['x', 'y'], 'x'], ['b', [], undefined]), 'a', 'y', 'b')!
  expect(next[0]!.active).toBe('x')
})

it('reorders inside one group at the requested index', () => {
  const next = moveTabToGroup(groups(['a', ['x', 'y', 'z'], 'x']), 'a', 'z', 'a', 0)!
  expect(next[0]!.tabs.map(row => row.path)).toEqual(['z', 'x', 'y'])
  expect(next[0]!.active).toBe('z')
})

it('refuses to open a second tab over the same file', () => {
  expect(moveTabToGroup(groups(['a', ['x'], 'x'], ['b', ['x'], 'x']), 'a', 'x', 'b')).toBeUndefined()
})

it('trades the dragged file with the target group active file', () => {
  const next = swapActiveTab(groups(['a', ['x'], 'x'], ['b', ['y'], 'y']), 'a', 'x', 'b')!
  expect(next[0]!.tabs.map(row => row.path)).toEqual(['y'])
  expect(next[0]!.active).toBe('y')
  expect(next[1]!.tabs.map(row => row.path)).toEqual(['x'])
  expect(next[1]!.active).toBe('x')
})

it('swaps with the active tab only, keeping the target group other tabs in place', () => {
  const next = swapActiveTab(groups(['a', ['x'], 'x'], ['b', ['p', 'y'], 'y']), 'a', 'x', 'b')!
  expect(next[1]!.tabs.map(row => row.path)).toEqual(['p', 'x'])
  expect(next[1]!.active).toBe('x')
})

it('keeps the source active tab when the dragged tab was in the background', () => {
  const next = swapActiveTab(groups(['a', ['x', 'y'], 'x'], ['b', ['z'], 'z']), 'a', 'y', 'b')!
  expect(next[0]!.active).toBe('x')
  expect(next[0]!.tabs.map(row => row.path)).toEqual(['x', 'z'])
})

it('has nothing to swap in the same group or against an empty target', () => {
  expect(swapActiveTab(groups(['a', ['x', 'y'], 'x']), 'a', 'y', 'a')).toBeUndefined()
  expect(swapActiveTab(groups(['a', ['x'], 'x'], ['b', [], undefined]), 'a', 'x', 'b')).toBeUndefined()
})