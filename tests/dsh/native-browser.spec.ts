// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeBrowser } from '../../src/client/dsh/browser.ts'

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
  let expanded = false
  const sidebar = {
    mounted,
    openTabIn: vi.fn((sessionId: string, kind: string, _options?: { revealIfOpened?: boolean; params?: { url?: string } }) => {
      rows.push({ id: `tab-${rows.length}`, sessionId, kind, title: '浏览器', contentId: `content-${rows.length}` })
      expanded = true
    }),
    isExpanded: () => expanded,
  }
  const registration = { get: () => ({}) as object | undefined }
  const browser = new NativeBrowser({ sidebarRight: sidebar, sidebarRightTabs: registration } as unknown as Context)
  cleanup.push(() => browser.dispose())
  return { browser, sidebar, mounted, rows, registration }
}
it('opens independent official pages without changing an Agent browser', async () => {
  const h = setup()
  h.rows.push({ id: 'agent', sessionId: 's', kind: 'ego-browser', title: 'Agent 浏览器', contentId: 'agent' })
  await h.browser.open('s'); await h.browser.open('s')
  expect(h.rows.map(row => row.kind)).toEqual(['ego-browser', 'browser', 'browser'])
  expect(h.rows[0]).toEqual({ id: 'agent', sessionId: 's', kind: 'ego-browser', title: 'Agent 浏览器', contentId: 'agent' })
  expect(h.sidebar.isExpanded()).toBe(true)
})
it('waits for the selected Session to mount after leaving a global panel', async () => {
  const h = setup(); h.mounted.set(undefined)
  const opening = h.browser.open('s')
  expect(h.sidebar.openTabIn).not.toHaveBeenCalled()
  h.mounted.set('s')
  await expect(opening).resolves.toBeUndefined()
  expect(h.rows).toHaveLength(1)
})
it('passes explicit addresses to the official browser without replacing existing pages', async () => {
  const h = setup()
  await h.browser.open('s')
  await h.browser.open('s', undefined, 'https://example.com/')
  await h.browser.open('s', undefined, 'https://example.org/docs')
  expect(h.sidebar.openTabIn.mock.calls[1]?.[2]).toEqual({ revealIfOpened: false, params: { url: 'https://example.com/' } })
  expect(h.sidebar.openTabIn.mock.calls[2]?.[2]).toEqual({ revealIfOpened: false, params: { url: 'https://example.org/docs' } })
  expect(h.rows).toHaveLength(3)
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
  await expect(opening).resolves.toBeUndefined()
  expect(h.rows).toHaveLength(1)
})
it('cancels a ready but not yet continued open if another Session replaces it', async () => {
  const h = setup(); h.mounted.set(undefined)
  const opening = h.browser.open('s')
  h.mounted.set('s'); h.mounted.set('other')
  await expect(opening).rejects.toThrow('工作区已切换')
  expect(h.sidebar.openTabIn).not.toHaveBeenCalled()
})
it('cancels pending opens when its plugin is disposed', async () => {
  const h = setup(); h.mounted.set(undefined)
  const opening = h.browser.open('s')
  h.browser.dispose()
  await expect(opening).rejects.toBeDefined()
  h.mounted.set('s')
  expect(h.sidebar.openTabIn).not.toHaveBeenCalled()
})
it('reports an unavailable official browser instead of creating another browser', async () => {
  const h = setup(); h.registration.get = () => undefined
  await expect(h.browser.open('s')).rejects.toThrow('官方浏览器尚未启用')
  expect(h.sidebar.openTabIn).not.toHaveBeenCalled()
})
