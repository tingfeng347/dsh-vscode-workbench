// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeBrowser } from '../src/client/browser.ts'

function source<T>(value: T) {
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, set: (next: T) => { value = next; for (const listener of listeners) listener() } }
}
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); document.body.replaceChildren() })
function setup() {
  const seat = document.createElement('div'); seat.setAttribute('data-sidebar-right-session', 's'); document.body.append(seat)
  const mounted = source<string | undefined>('s')
  const rows: Array<{ id: string; sessionId: string; kind: string; title: string; contentId: string }> = []
  const openTabs = source<Array<{ sessionId: string; tabId: string; kind: string; contentId: string }>>([])
  let expanded = false
  const publish = () => openTabs.set(rows.map(row => ({ ...row, tabId: row.id })))
  const sidebar = {
    openTabs, mounted,
    tabsIn: (id: string) => rows.filter(row => row.sessionId === id),
    openTabIn: vi.fn((sessionId: string, kind: string) => { rows.push({ id: `tab-${rows.length}`, sessionId, kind, title: '浏览器', contentId: `content-${rows.length}` }); publish() }),
    closeIn: vi.fn((sessionId: string, id: string) => { const i = rows.findIndex(row => row.id === id && row.sessionId === sessionId); rows.splice(i, 1); publish() }),
    close: vi.fn((id: string) => { const i = rows.findIndex(row => row.id === id); rows.splice(i, 1); publish() }),
    focus: vi.fn(), isExpanded: () => expanded, toggleExpanded: () => { expanded = !expanded },
  }
  const browser = new NativeBrowser({ sidebarRight: sidebar, sidebarRightTabs: { get: () => ({}), subscribe: () => () => {} } } as unknown as Context)
  cleanup.push(() => browser.dispose())
  return { browser, sidebar, mounted, rows, publish }
}
it('opens independent official browser pages and scopes closure to their Session', async () => {
  const h = setup()
  const first = await h.browser.open('s'); const second = await h.browser.open('s')
  expect(first).not.toBe(second)
  h.rows.push({ id: 'agent', sessionId: 's', kind: 'ego-browser', title: 'Agent 浏览器', contentId: 'agent' }); h.publish()
  expect(h.browser.getSnapshot().tabs.map(tab => tab.id)).toEqual([first, second])
  h.browser.focus(first)
  expect(h.sidebar.isExpanded()).toBe(true)
  h.browser.close('s', first)
  expect(h.sidebar.closeIn).toHaveBeenCalledWith('s' as SessionId, first)
  expect(h.rows.some(row => row.id === 'agent')).toBe(true)
})
it('waits for the selected Session to mount after leaving a global panel', async () => {
  const h = setup(); h.mounted.set(undefined)
  const opening = h.browser.open('s')
  expect(h.sidebar.openTabIn).not.toHaveBeenCalled()
  h.mounted.set('s')
  await expect(opening).resolves.toBe('tab-0')
})
it('cancels pending opens when switching workspaces instead of opening a stale page later', async () => {
  const h = setup(); h.mounted.set(undefined)
  const request = new AbortController()
  const opening = h.browser.open('s', request.signal)
  request.abort()
  await expect(opening).rejects.toBeDefined()
  h.mounted.set('s')
  expect(h.sidebar.openTabIn).not.toHaveBeenCalled()
})

it('waits for the native sidebar seat after mounted changes before React commits', async () => {
  const h = setup(); document.body.replaceChildren()
  const opening = h.browser.open('s')
  expect(h.sidebar.openTabIn).not.toHaveBeenCalled()
  const seat = document.createElement('div'); seat.setAttribute('data-sidebar-right-session', 's'); document.body.append(seat)
  await expect(opening).resolves.toBe('tab-0')
})

it('falls back to the on-screen close when a Session store was never adopted', async () => {
  const h = setup(); const id = await h.browser.open('s')
  // A released adoption makes closeIn a documented no-op, and the tab would otherwise stay clickable forever.
  h.sidebar.closeIn.mockImplementation(() => {})
  h.browser.close('s', id)
  expect(h.sidebar.close).toHaveBeenCalledWith(id)
  expect(h.rows.some(row => row.id === id)).toBe(false)
})

it('never closes a same-named tab of a different Session', async () => {
  const h = setup(); const id = await h.browser.open('s')
  h.rows.push({ id: 'other', sessionId: 'x', kind: 'browser', title: '浏览器', contentId: 'other' }); h.publish()
  h.mounted.set('x')
  h.sidebar.closeIn.mockImplementation(() => {})
  h.browser.close('s', id)
  expect(h.sidebar.close).not.toHaveBeenCalled()
})
