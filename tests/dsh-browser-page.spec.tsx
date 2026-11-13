// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { DshBrowserPage } from '../src/client/DshBrowserPage.tsx'
import { settingsHost } from '../src/client/settingsHost.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
if (typeof globalThis.requestAnimationFrame !== 'function') {
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  })
}

afterEach(() => { settingsHost.set(undefined); document.body.replaceChildren() })

function stage() {
  document.body.innerHTML = '<div class="dvw-overlay"><div class="dvw-editor"></div></div><div data-sidebar-right-session="s"></div><div id="host"></div>'
  const editor = document.querySelector<HTMLElement>('.dvw-editor')!
  editor.getBoundingClientRect = () => ({ left: 100, top: 85, width: 800, height: 565, right: 900, bottom: 650, x: 100, y: 85, toJSON() {} }) as DOMRect
  return { host: document.getElementById('host')!, seat: document.querySelector<HTMLElement>('[data-sidebar-right-session]')! }
}

function rect(node: HTMLElement, width: number, height: number) {
  node.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect
}

function body(seat: HTMLElement, tabId: string) {
  const node = document.createElement('div')
  node.setAttribute('data-sidebar-right-tab', tabId)
  seat.append(node)
  return node
}

it('adopts a tab body that DSH mounts after the seat is ready', async () => {
  const { host, seat } = stage()
  const root = createRoot(host)
  await act(async () => { root.render(<DshBrowserPage sessionId="s" tabId="tab1" active colorScheme="light"/>) })
  const page = body(seat, 'tab1')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(true)
  expect(page.getAttribute('popover')).toBe('manual')
  expect(page.style.getPropertyValue('left')).toBe('100px')
  await act(async () => { root.unmount() })
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(false)
})

it('picks the laid-out body when a collapsed duplicate shares the tab id', async () => {
  const { host, seat } = stage()
  const collapsed = body(seat, 'tab1'); rect(collapsed, 0, 0)
  const visible = body(seat, 'tab1'); rect(visible, 640, 480)
  const root = createRoot(host)
  await act(async () => { root.render(<DshBrowserPage sessionId="s" tabId="tab1" active colorScheme="light"/>) })
  expect(visible.hasAttribute('data-dvw-browser-page')).toBe(true)
  expect(collapsed.hasAttribute('data-dvw-browser-page')).toBe(false)
  await act(async () => { root.unmount() })
})

// A closed popover is only hidden by a user-agent rule, and DSH's `.tabBody { display: flex }`
// is author CSS that outranks it. Leaving the node adopted therefore paints its chrome from stale
// geometry with no live controller, which is what a browser tab showed over an open file.
it('leaves the official body untouched while a file owns the centre', async () => {
  const { host, seat } = stage()
  const page = body(seat, 'tab1'); rect(page, 640, 480)
  const root = createRoot(host)
  await act(async () => { root.render(<DshBrowserPage sessionId="s" tabId="tab1" active={false} colorScheme="light"/>) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
  expect(page.hasAttribute('popover')).toBe(false)
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(false)
  expect(page.getAttribute('style')).toBeFalsy()
  await act(async () => { root.unmount() })
})

it('releases the official body when a file takes the centre back', async () => {
  const { host, seat } = stage()
  const page = body(seat, 'tab1'); rect(page, 640, 480)
  const root = createRoot(host)
  await act(async () => { root.render(<DshBrowserPage sessionId="s" tabId="tab1" active colorScheme="light"/>) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(true)
  await act(async () => { root.render(<DshBrowserPage sessionId="s" tabId="tab1" active={false} colorScheme="light"/>) })
  expect(page.hasAttribute('popover')).toBe(false)
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(false)
  expect(page.getAttribute('style')).toBeFalsy()
  await act(async () => { root.unmount() })
})

it('steps out of the top layer while DSH settings is open and returns afterwards', async () => {
  const { host, seat } = stage()
  const page = body(seat, 'tab1'); rect(page, 640, 480)
  const root = createRoot(host)
  await act(async () => { root.render(<DshBrowserPage sessionId="s" tabId="tab1" active colorScheme="light"/>) })
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(true)
  await act(async () => { settingsHost.set(document.createElement('div')) })
  expect(page.hasAttribute('popover')).toBe(false)
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(false)
  await act(async () => { settingsHost.set(undefined) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
  expect(page.hasAttribute('data-dvw-browser-page')).toBe(true)
  await act(async () => { root.unmount() })
})
