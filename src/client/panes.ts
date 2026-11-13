/** Editor-group layout for the workbench: a binary tree of splits with one leaf per group. */

export type SplitDirection = 'row' | 'column'
export type SplitPosition = 'first' | 'second'

export interface PaneLeaf { kind: 'leaf'; group: string }
export interface PaneSplit {
  kind: 'split'
  id: string
  direction: SplitDirection
  /** Share of the space the first child takes, kept between MIN_RATIO and 1 - MIN_RATIO. */
  ratio: number
  first: PaneNode
  second: PaneNode
}
export type PaneNode = PaneLeaf | PaneSplit

/** Keeps a dragged divider from hiding either side. */
export const MIN_RATIO = 0.2
/** Above this many groups the drag gesture is refused, so a stray drop cannot shred the layout. */
export const MAX_PANES = 6

export function createLeaf(group: string): PaneLeaf { return { kind: 'leaf', group } }

export function leafGroups(node: PaneNode): string[] {
  return node.kind === 'leaf' ? [node.group] : [...leafGroups(node.first), ...leafGroups(node.second)]
}

export function paneCount(node: PaneNode): number { return leafGroups(node).length }

const clampRatio = (ratio: number) => Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio))

/** Split the leaf holding `group`, putting the new group before or after it. */
export function splitAt(node: PaneNode, group: string, direction: SplitDirection, added: string, position: SplitPosition, id: string): PaneNode {
  if (node.kind === 'leaf') {
    if (node.group !== group) return node
    const fresh = createLeaf(added)
    return {
      kind: 'split', id, direction, ratio: 0.5,
      first: position === 'first' ? fresh : node,
      second: position === 'first' ? node : fresh,
    }
  }
  const first = splitAt(node.first, group, direction, added, position, id)
  if (first !== node.first) return { ...node, first }
  const second = splitAt(node.second, group, direction, added, position, id)
  return second === node.second ? node : { ...node, second }
}

/** Drop a group's leaf and collapse the split that held it, so the survivor takes the space. */
export function removeGroup(node: PaneNode, group: string): PaneNode | undefined {
  if (node.kind === 'leaf') return node.group === group ? undefined : node
  const first = removeGroup(node.first, group)
  const second = removeGroup(node.second, group)
  if (first === undefined) return second
  if (second === undefined) return first
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

export function setRatio(node: PaneNode, id: string, ratio: number): PaneNode {
  if (node.kind === 'leaf') return node
  if (node.id === id) return { ...node, ratio: clampRatio(ratio) }
  const first = setRatio(node.first, id, ratio)
  const second = setRatio(node.second, id, ratio)
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

/** The edge whose drop zone the pointer is in, or undefined when it means "open here". */
export function dropPosition(rect: { width: number; height: number }, x: number, y: number, edge = 0.25): { direction: SplitDirection; position: SplitPosition } | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined
  const left = x / rect.width
  const top = y / rect.height
  const candidates = [
    { distance: left, value: { direction: 'row' as const, position: 'first' as const } },
    { distance: 1 - left, value: { direction: 'row' as const, position: 'second' as const } },
    { distance: top, value: { direction: 'column' as const, position: 'first' as const } },
    { distance: 1 - top, value: { direction: 'column' as const, position: 'second' as const } },
  ]
  candidates.sort((a, b) => a.distance - b.distance)
  return candidates[0]!.distance <= edge ? candidates[0]!.value : undefined
}

/** Keep a persisted tree usable: drop leaves whose group is gone and re-anchor a missing first group. */
export function normalizeLayout(node: unknown, groups: readonly string[], fallback: string): PaneNode {
  const rebuilt = prune(node)
  const known = rebuilt === undefined ? [] : leafGroups(rebuilt)
  if (rebuilt === undefined || known.length === 0) return createLeaf(groups[0] ?? fallback)
  const missing = groups.filter(group => !known.includes(group))
  if (missing.length === 0) return rebuilt
  return missing.reduce<PaneNode>((tree, group) => {
    const anchor = leafGroups(tree)[0]!
    return splitAt(tree, anchor, 'row', group, 'second', `pane-${group}`)
  }, rebuilt)
}

function prune(node: unknown): PaneNode | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const value = node as Record<string, unknown>
  if (value.kind === 'leaf') return typeof value.group === 'string' && value.group !== '' ? createLeaf(value.group) : undefined
  if (value.kind !== 'split') return undefined
  const first = prune(value.first)
  const second = prune(value.second)
  if (first === undefined) return second
  if (second === undefined) return first
  const direction: SplitDirection = value.direction === 'column' ? 'column' : 'row'
  const ratio = typeof value.ratio === 'number' && Number.isFinite(value.ratio) ? clampRatio(value.ratio) : 0.5
  const id = typeof value.id === 'string' && value.id !== '' ? value.id : `split-${direction}-${ratio}`
  return { kind: 'split', id, direction, ratio, first, second }
}