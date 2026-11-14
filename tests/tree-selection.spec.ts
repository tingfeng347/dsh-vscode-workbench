import { describe, expect, it } from 'vitest'
import { outermostTreeEntries, remapTreeSelectionPaths, selectAllTreePaths, selectTreePath, type TreeSelection } from '../src/client/treeSelection.ts'

const visible = ['src', 'src/a.ts', 'src/b.ts', 'README.md']
const empty: TreeSelection = { selected: new Set() }

describe('Explorer tree selection', () => {
  it('replaces selection on a plain click and toggles one path with Ctrl/Cmd', () => {
    expect(selectTreePath(empty, visible, 'src/b.ts')).toEqual({
      selected: new Set(['src/b.ts']),
      anchor: 'src/b.ts',
      focus: 'src/b.ts',
    })

    const toggled = selectTreePath(
      { selected: new Set(['src/a.ts']), anchor: 'src/a.ts', focus: 'src/a.ts' },
      visible,
      'src/b.ts',
      { toggle: true },
    )
    expect(toggled.selected).toEqual(new Set(['src/a.ts', 'src/b.ts']))

    expect(selectTreePath(toggled, visible, 'src/a.ts', { toggle: true }).selected).toEqual(new Set(['src/b.ts']))
  })

  it('selects a visible range from the anchor and supports additive Shift+Ctrl ranges', () => {
    const extended = selectTreePath(
      { selected: new Set(['README.md']), anchor: 'src/a.ts', focus: 'src/a.ts' },
      visible,
      'src/b.ts',
      { extend: true },
    )
    expect(extended).toEqual({
      selected: new Set(['src/a.ts', 'src/b.ts']),
      anchor: 'src/a.ts',
      focus: 'src/b.ts',
    })

    expect(selectTreePath(extended, visible, 'src', { extend: true, toggle: true }).selected).toEqual(
      new Set(['src', 'src/a.ts', 'src/b.ts']),
    )
  })

  it('selects all visible rows and ignores paths that are no longer visible', () => {
    expect(selectAllTreePaths(visible)).toEqual({
      selected: new Set(visible),
      anchor: 'src',
      focus: 'README.md',
    })
    expect(selectTreePath(empty, visible, 'collapsed/old.ts')).toBe(empty)
  })

  it('moves selected paths and selection endpoints after a rename', () => {
    expect(remapTreeSelectionPaths({
      selected: new Set(['docs', 'docs/a.md', 'README.md']),
      anchor: 'docs',
      focus: 'docs/a.md',
    }, 'docs', 'guides')).toEqual({
      selected: new Set(['guides', 'guides/a.md', 'README.md']),
      anchor: 'guides',
      focus: 'guides/a.md',
    })
  })
})

describe('Explorer batch deletion', () => {
  it('deduplicates entries and removes children already covered by a selected directory', () => {
    const entries = [
      { path: 'src', kind: 'directory' as const },
      { path: 'src/a.ts', kind: 'file' as const },
      { path: 'src/nested', kind: 'directory' as const },
      { path: 'src/nested/b.ts', kind: 'file' as const },
      { path: 'README.md', kind: 'file' as const },
      { path: 'README.md', kind: 'file' as const },
    ]
    expect(outermostTreeEntries(entries)).toEqual([
      { path: 'src', kind: 'directory' },
      { path: 'README.md', kind: 'file' },
    ])
  })
})
