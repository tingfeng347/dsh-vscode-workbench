/** Selection state for the visible Explorer rows. */
export interface TreeSelection {
  readonly selected: ReadonlySet<string>
  readonly anchor?: string
  readonly focus?: string
}

/** Pointer modifiers that change how a tree row is selected. */
export interface TreeSelectionOptions {
  readonly toggle?: boolean
  readonly extend?: boolean
}

function indexOfPath(paths: readonly string[], path: string | undefined): number {
  return path === undefined ? -1 : paths.indexOf(path)
}

function rangePaths(paths: readonly string[], first: number, last: number): Set<string> {
  const start = Math.min(first, last)
  const end = Math.max(first, last)
  return new Set(paths.slice(start, end + 1))
}

/**
 * Apply a click to the current selection.
 *
 * Ctrl/Cmd toggles one row. Shift selects the visible range from the existing
 * anchor; combining both adds that range to the existing selection. A plain
 * click replaces the selection. Hidden paths are ignored.
 */
export function selectTreePath(
  current: TreeSelection,
  visiblePaths: readonly string[],
  target: string,
  options: TreeSelectionOptions = {},
): TreeSelection {
  const targetIndex = indexOfPath(visiblePaths, target)
  if (targetIndex === -1) return current

  if (options.extend) {
    const anchorIndex = indexOfPath(visiblePaths, current.anchor)
    const first = anchorIndex === -1 ? targetIndex : anchorIndex
    const range = rangePaths(visiblePaths, first, targetIndex)
    return {
      selected: options.toggle ? new Set([...current.selected, ...range]) : range,
      anchor: anchorIndex === -1 ? target : current.anchor,
      focus: target,
    }
  }

  if (options.toggle) {
    const selected = new Set(current.selected)
    if (selected.has(target)) selected.delete(target)
    else selected.add(target)
    return { selected, anchor: target, focus: target }
  }

  return { selected: new Set([target]), anchor: target, focus: target }
}

/** Select every row currently rendered in the Explorer tree. */
export function selectAllTreePaths(visiblePaths: readonly string[]): TreeSelection {
  return {
    selected: new Set(visiblePaths),
    anchor: visiblePaths[0],
    focus: visiblePaths.at(-1),
  }
}

/** Move selected paths after an Explorer rename while preserving their tree order. */
export function remapTreeSelectionPaths(current: TreeSelection, oldPath: string, nextPath: string): TreeSelection {
  const remap = (path: string | undefined): string | undefined => {
    if (path === oldPath) return nextPath
    if (path?.startsWith(`${oldPath}/`)) return `${nextPath}${path.slice(oldPath.length)}`
    return path
  }
  return {
    selected: new Set([...current.selected].map(path => remap(path) ?? path)),
    anchor: remap(current.anchor),
    focus: remap(current.focus),
  }
}

/**
 * Keep only the outermost selected entries for deletion. Deleting a selected
 * directory already removes its selected descendants, and issuing both calls
 * would produce a spurious failure for every child.
 */
export function outermostTreeEntries<T extends { readonly path: string }>(entries: readonly T[]): T[] {
  const unique = new Map(entries.map(entry => [entry.path, entry]))
  return [...unique.values()].filter(entry =>
    ![...unique.keys()].some(parent => parent !== entry.path && entry.path.startsWith(`${parent}/`)),
  )
}
