import { expect, it } from 'vitest'
import { createLeaf, dropPosition, dropPaneCount, leafGroups, MAX_PANES, MIN_RATIO, normalizeLayout, paneCount, removeGroup, setRatio, splitAt, splitForDrop, type PaneNode, type SplitPosition } from '../../src/client/workbench/panes.ts'

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

it.each([
  [10, 10, 'first', 'first'],
  [790, 10, 'second', 'first'],
  [10, 590, 'first', 'second'],
  [790, 590, 'second', 'second'],
])('recognizes the quarter at (%s, %s) before choosing a single edge', (x, y, position, vertical) => {
  expect(dropPosition({ width: 800, height: 600 }, x as number, y as number)).toEqual({ direction: 'row', position, vertical })
})

it.each([['first', 'first'], ['second', 'first'], ['first', 'second'], ['second', 'second']] as const)('lays out the dropped group in the %s/%s quarter', (position, vertical) => {
  const drop = { direction: 'row' as const, position, vertical }
  const tree = splitForDrop(createLeaf('a'), 'a', drop, 'new', 'empty')
  const areas: Record<string, number[]> = {}
  const measure = (node: PaneNode, x = 0, y = 0, width = 800, height = 600): void => {
    if (node.kind === 'leaf') { areas[node.group] = [x, y, width, height]; return }
    if (node.direction === 'row') {
      measure(node.first, x, y, width * node.ratio, height)
      measure(node.second, x + width * node.ratio, y, width * (1 - node.ratio), height)
    } else {
      measure(node.first, x, y, width, height * node.ratio)
      measure(node.second, x, y + height * node.ratio, width, height * (1 - node.ratio))
    }
  }
  measure(tree)
  expect(areas.new).toEqual([position === 'first' ? 0 : 400, vertical === 'first' ? 0 : 300, 400, 300])
  expect(areas.a).toEqual([position === 'first' ? 400 : 0, 0, 400, 600])
  expect(new Set(leafGroups(tree)).size).toBe(3)
  expect(dropPaneCount(drop)).toBe(2)
  expect(paneCount(normalizeLayout(tree, leafGroups(tree), 'a'))).toBe(3)
})

it('uses one extra group for a half split and leaves missing targets untouched', () => {
  const drop = { direction: 'column' as const, position: 'second' as SplitPosition }
  const leaf = createLeaf('a')
  expect(dropPaneCount(drop)).toBe(1)
  expect(paneCount(splitForDrop(leaf, 'a', drop, 'new', 'unused'))).toBe(2)
  expect(splitForDrop(leaf, 'missing', { ...drop, vertical: 'first' }, 'new', 'empty')).toBe(leaf)
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
