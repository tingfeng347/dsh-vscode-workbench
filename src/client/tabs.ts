/** Pure tab movement between editor groups, kept out of the component so it can be tested. */

export interface TabGroupLike<T> { id: string; tabs: T[]; active?: string }

/** Move a tab into another group at `index`, or reorder it inside its own group. */
export function moveTabToGroup<T extends { path: string }>(groups: readonly TabGroupLike<T>[], from: string, path: string, to: string, index?: number): TabGroupLike<T>[] | undefined {
  const source = groups.find(group => group.id === from)
  const target = groups.find(group => group.id === to)
  const tab = source?.tabs.find(row => row.path === path)
  if (source === undefined || target === undefined || tab === undefined) return undefined
  // The same file open twice would be two editors over one buffer; the caller focuses the existing tab instead.
  if (to !== from && target.tabs.some(row => row.path === path)) return undefined
  const rest = source.tabs.filter(row => row.path !== path)
  const at = Math.max(0, Math.min(index ?? rest.length, rest.length))
  const placed = [...rest.slice(0, at), tab, ...rest.slice(at)]
  return groups.map(group => {
    if (group.id !== from && group.id !== to) return group
    if (from === to) return { ...group, tabs: placed, active: path }
    if (group.id === from) return { ...group, tabs: rest, active: group.active === path ? rest.at(-1)?.path : group.active }
    return { ...group, tabs: [...group.tabs, tab], active: path }
  })
}

/** Trade the dragged tab with the target group's active tab, which is what comparing two files looks like. */
export function swapActiveTab<T extends { path: string }>(groups: readonly TabGroupLike<T>[], from: string, path: string, to: string): TabGroupLike<T>[] | undefined {
  if (from === to) return undefined
  const source = groups.find(group => group.id === from)
  const target = groups.find(group => group.id === to)
  const moved = source?.tabs.find(row => row.path === path)
  const other = target?.tabs.find(row => row.path === target.active)
  if (source === undefined || target === undefined || moved === undefined || other === undefined) return undefined
  if (other.path === path || target.tabs.some(row => row.path === path)) return undefined
  return groups.map(group => {
    if (group.id === from) return { ...group, tabs: group.tabs.map(row => row.path === path ? other : row), active: group.active === path ? other.path : group.active }
    if (group.id === to) return { ...group, tabs: group.tabs.map(row => row.path === other.path ? moved : row), active: path }
    return group
  })
}