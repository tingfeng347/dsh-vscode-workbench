import { describe, expect, it, vi } from 'vitest'
import { buildWorkspaceChoices, createDshNavigation } from '../src/client/dshNavigation.ts'

const workspaces = { items: [
  { workspaceId: 'w1', title: 'repo', path: 'D:\\repo', sessionIds: ['s1', 's2', 'missing'] },
  { workspaceId: 'w2', title: 'other', path: 'D:\\other', sessionIds: [] },
] }
const sessions = { ids: ['s1', 's2'], byId: {
  s1: { title: '问候' },
  s2: { blank: true, projectionValues: { title: '新会话' } },
} }

describe('Workspace switcher data', () => {
  it('lists workspaces with their sessions and marks the active one', () => {
    expect(buildWorkspaceChoices(workspaces, sessions, 's1')).toEqual([
      { id: 'w1', title: 'repo', path: 'D:\\repo', sessions: [
        { id: 's1', title: '问候', blank: false, active: true },
        { id: 's2', title: '新会话', blank: true, active: false },
      ] },
      { id: 'w2', title: 'other', path: 'D:\\other', sessions: [] },
    ])
  })

  it('falls back to a placeholder for an untitled session', () => {
    expect(buildWorkspaceChoices({ items: [{ workspaceId: 'w', title: 't', path: '/w', sessionIds: ['s'] }] }, { ids: ['s'], byId: { s: {} } })[0]!.sessions[0]!.title).toBe('未命名会话')
  })

  it('reads DSH client services through get and switches sessions', () => {
    const openSession = vi.fn()
    const openWorkspace = vi.fn()
    const stores: Record<string, unknown> = { workspaces: { list: { getSnapshot: () => workspaces } }, sessions: { list: { getSnapshot: () => sessions } }, uiWorkspace: { openSession, openWorkspace } }
    const navigation = createDshNavigation(name => stores[name])
    expect(navigation.available).toBe(true)
    expect(navigation.choices('s2').map(choice => choice.sessions.map(session => session.active))).toEqual([[false, true], []])
    expect(navigation.openSession('s2')).toBe(true)
    expect(openSession).toHaveBeenCalledWith('s2')
    expect(navigation.openWorkspace('w1')).toBe(true)
    expect(openWorkspace).toHaveBeenCalledWith('w1', expect.any(Function))
  })

  it('reports unavailability when the client stores are absent', () => {
    const navigation = createDshNavigation(() => undefined)
    expect(navigation.available).toBe(false)
    expect(navigation.choices()).toEqual([])
    expect(navigation.openSession('s1')).toBe(false)
    expect(navigation.openWorkspace('w1')).toBe(false)
  })
})
