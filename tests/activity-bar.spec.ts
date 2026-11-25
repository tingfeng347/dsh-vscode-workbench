import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { moveActivity, normalizeActivityLayout, normalizeActivityOrder, singleActiveActivity, toggleActivityHidden } from '../src/client/ActivityBar.tsx'

const KNOWN = ['explorer', 'search', 'git', 'terminal', 'chat']

describe('Activity bar order', () => {
  it('keeps saved order and appends new views', () => {
    expect(normalizeActivityOrder(['chat', 'explorer'], KNOWN)).toEqual(['chat', 'explorer', 'search', 'git', 'terminal'])
    expect(normalizeActivityOrder(['chat', 'chat', 'bogus', 3], KNOWN)).toEqual(['chat', 'explorer', 'search', 'git', 'terminal'])
    expect(normalizeActivityOrder(undefined, KNOWN)).toEqual(KNOWN)
  })

  it('drags a view before another or to the end', () => {
    expect(moveActivity(KNOWN, 'chat', 'explorer')).toEqual(['chat', 'explorer', 'search', 'git', 'terminal'])
    expect(moveActivity(KNOWN, 'explorer', 'git')).toEqual(['search', 'explorer', 'git', 'terminal', 'chat'])
    expect(moveActivity(KNOWN, 'search', undefined)).toEqual(['explorer', 'git', 'terminal', 'chat', 'search'])
    expect(moveActivity(KNOWN, 'missing', 'git')).toEqual(KNOWN)
  })

  it('restores older orders with all footer actions at the bottom', () => {
    expect(normalizeActivityLayout(['chat', 'workspaces', 'home'], ['workspaces'], KNOWN, ['home', 'settings']))
      .toEqual(['chat', 'workspaces', 'explorer', 'search', 'git', 'terminal', 'home', 'settings'])
    expect(normalizeActivityLayout(['settings', 'workspaces', 'home', 'explorer'], ['workspaces'], KNOWN, ['home', 'settings']))
      .toEqual(['workspaces', 'explorer', 'search', 'git', 'terminal', 'chat', 'settings', 'home'])
    expect(normalizeActivityLayout([...KNOWN, 'home', 'settings'], ['workspaces'], [...KNOWN, 'debug'], ['home', 'settings']))
      .toEqual(['workspaces', ...KNOWN, 'debug', 'home', 'settings'])
  })

  it('toggles hidden views', () => {
    expect(toggleActivityHidden([], 'git')).toEqual(['git'])
    expect(toggleActivityHidden(['git', 'chat'], 'git')).toEqual(['chat'])
  })

  it('keeps at most one selected activity, preferring the last clicked one', () => {
    expect(singleActiveActivity(['explorer', 'terminal', 'chat'])).toBe('explorer')
    expect(singleActiveActivity(['explorer', 'terminal', 'chat'], 'chat')).toBe('chat')
    expect(singleActiveActivity(['explorer', 'terminal'], 'chat')).toBe('explorer')
    expect(singleActiveActivity([], 'chat')).toBeUndefined()
  })
})

describe('Activity bar surface', () => {
  it('uses the reusable bar with drag and a right-click menu', () => {
    const workbench = readFileSync(new URL('../src/client/Workbench.tsx', import.meta.url), 'utf8')
    const bar = readFileSync(new URL('../src/client/ActivityBar.tsx', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
    expect(workbench).toContain('<ActivityBar')
    expect(workbench).toContain("readActivityJSON('dvw:activity-hidden')")
    expect(bar).toContain('onPointerDown={event => beginDrag')
    expect(bar).toContain('dvw-activity-ghost')
    expect(bar).toContain('element.animate?')
    expect(styles).toContain('.dvw-activity-ghost{')
    expect(bar).toContain('隐藏“{target.label}”')
    expect(bar).toContain('恢复所有视图')
    expect(workbench).toContain('bottom={[')
    expect(workbench).toContain("label:'返回 DSH'")
    expect(bar).toContain('dvw-activity-bottom')
    expect(styles).toContain('.dvw-activity-bottom{width:100%;margin-top:auto;')
  })
})
