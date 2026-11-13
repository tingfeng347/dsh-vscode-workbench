import { expect, it } from 'vitest'
import { createLeaf, dropPosition, leafGroups, MAX_PANES, MIN_RATIO, normalizeLayout, paneCount, removeGroup, setRatio, splitAt } from '../src/client/panes.ts'

it('splits the leaf that holds the group and keeps the other leaves untouched', () => {
  const tree = splitAt(createLeaf('a'), 'a', 'row', 'b', 'second', 's1')
  expect(leafGroups(tree)).toEqual(['a', 'b'])
  const deeper = splitAt(tree, 'a', 'column', 'c', 'first', 's2')
  expect(leafGroups(deeper)).toEqual(['c', 'a', 'b'])
  expect(paneCount(deeper)).toBe(3)
})

it('ignores a split aimed at a group that is not in the tree', () => {
  const tree = splitAt(createLeaf('a'), 'a', 'row', 'b', 'second', 's1')
  expect(splitAt(tree, 'missing', 'row', 'c', 'second', 's2')).toBe(tree)
})

it('collapses the split when a group leaves so the survivor takes its space', () => {
  const tree = splitAt(splitAt(createLeaf('a'), 'a', 'row', 'b', 'second', 's1'), 'b', 'column', 'c', 'second', 's2')
  const after = removeGroup(tree, 'b')!
  expect(leafGroups(after)).toEqual(['a', 'c'])
  expect(removeGroup(createLeaf('a'), 'a')).toBeUndefined()
})

it('clamps a dragged divider away from the edges', () => {
  const tree = splitAt(createLeaf('a'), 'a', 'row', 'b', 'second', 's1')
  const widened = setRatio(tree, 's1', 0.98) as { ratio: number }
  expect(widened.ratio).toBeCloseTo(1 - MIN_RATIO)
  const narrowed = setRatio(tree, 's1', -3) as { ratio: number }
  expect(narrowed.ratio).toBeCloseTo(MIN_RATIO)
})

it('reads the nearest edge, and the middle as "open here"', () => {
  const rect = { width: 800, height: 600 }
  expect(dropPosition(rect, 20, 300)).toEqual({ direction: 'row', position: 'first' })
  expect(dropPosition(rect, 780, 300)).toEqual({ direction: 'row', position: 'second' })
  expect(dropPosition(rect, 400, 10)).toEqual({ direction: 'column', position: 'first' })
  expect(dropPosition(rect, 400, 590)).toEqual({ direction: 'column', position: 'second' })
  expect(dropPosition(rect, 400, 300)).toBeUndefined()
})

it('rebuilds a persisted tree and re-anchors groups the stored layout forgot', () => {
  const stored = { kind: 'split', id: 's1', direction: 'row', ratio: 0.4, first: { kind: 'leaf', group: 'a' }, second: { kind: 'leaf', group: 'b' } }
  expect(leafGroups(normalizeLayout(stored, ['a', 'b'], 'a'))).toEqual(['a', 'b'])
  expect([...leafGroups(normalizeLayout(stored, ['a', 'b', 'c'], 'a'))].sort()).toEqual(['a', 'b', 'c'])
  expect(leafGroups(normalizeLayout(undefined, ['a'], 'a'))).toEqual(['a'])
  expect(leafGroups(normalizeLayout({ kind: 'split', first: { kind: 'leaf', group: '' } }, ['a'], 'a'))).toEqual(['a'])
})

it('keeps the pane cap visible to the UI', () => {
  expect(MAX_PANES).toBeGreaterThan(1)
})