// @vitest-environment jsdom
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useNativeSidebar } from '../src/client/nativeSidebar.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('presents only the requested session dock and releases it after native collapse or workbench exit', async () => {
  document.body.innerHTML = `
    <div id="old-col" data-rightbar-col><div data-sidebar-right-panel="push" data-sidebar-right-session="old" data-sidebar-right-open="true"></div></div>
    <div id="current-col" data-rightbar-col><div data-sidebar-right-panel="push" data-sidebar-right-session="current"></div></div>
    <div id="workbench"></div>
  `
  const host = document.querySelector('#workbench')!
  const oldColumn = document.querySelector('#old-col')!
  const column = document.querySelector('#current-col')!
  const panel = column.firstElementChild as HTMLElement
  const widthProperty = '--dvw-native-sidebar-width'
  const marker = 'data-dvw-native-sidebar'
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect)

  const isExpanded = () => panel.hasAttribute('data-sidebar-right-open')
  const sidebar = {
    mounted: { getSnapshot: () => 'current', subscribe: () => () => {} },
    isExpanded,
    toggleExpanded: vi.fn(() => {
      if (isExpanded()) panel.removeAttribute('data-sidebar-right-open')
      else panel.setAttribute('data-sidebar-right-open', 'true')
    }),
  } as unknown as ISidebarRight
  const root = createRoot(host)

  function Toggle({ visible }: { visible: boolean }) {
    const { ready, shown, toggle } = useNativeSidebar(sidebar, 'current', visible)
    return <button disabled={!ready} aria-expanded={shown} onClick={toggle}>DSH 原生右侧栏</button>
  }

  try {
    await act(async () => root.render(<Toggle visible/>))
    const button = host.querySelector('button')!
    await act(async () => button.click())
    expect(sidebar.toggleExpanded).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(column.hasAttribute(marker)).toBe(true)
    expect(oldColumn.hasAttribute(marker)).toBe(false)
    expect(document.body.style.getPropertyValue(widthProperty)).toBe('320px')
    expect(panel.parentElement).toBe(column)

    await act(async () => panel.setAttribute('data-sidebar-right-panel', 'fullscreen'))
    expect(document.body.style.getPropertyValue(widthProperty)).toBe('0px')

    await act(async () => panel.removeAttribute('data-sidebar-right-open'))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(column.hasAttribute(marker)).toBe(false)

    // The browser can open the host dock in the background without displaying it over the editor.
    await act(async () => panel.setAttribute('data-sidebar-right-open', 'true'))
    expect(column.hasAttribute(marker)).toBe(false)
    await act(async () => button.click())
    expect(sidebar.toggleExpanded).toHaveBeenCalledTimes(1)
    expect(column.hasAttribute(marker)).toBe(true)

    await act(async () => root.render(<Toggle visible={false}/>))
    expect(column.hasAttribute(marker)).toBe(false)
    expect(document.body.style.getPropertyValue(widthProperty)).toBe('')
    expect(isExpanded()).toBe(true)
  } finally {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  }
})

it.each(['removed', 'replaced'] as const)('synchronizes presentation when the host column is %s', async change => {
  const frame = document.createElement('div')
  frame.innerHTML = '<div data-rightbar-col><div data-sidebar-right-panel="push" data-sidebar-right-session="s" data-sidebar-right-open="true"></div></div><div id="mount"></div>'
  document.body.append(frame)
  const column = frame.firstElementChild!
  vi.spyOn(column.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect)
  const sidebar = {
    mounted: { getSnapshot: () => 's', subscribe: () => () => {} },
    isExpanded: () => true,
    toggleExpanded() {},
  } as unknown as ISidebarRight
  const root = createRoot(frame.querySelector('#mount')!)
  function Toggle() {
    const { shown, toggle } = useNativeSidebar(sidebar, 's', true)
    return <button aria-expanded={shown} onClick={toggle}/>
  }
  try {
    await act(async () => root.render(<Toggle/>))
    const button = frame.querySelector('button')!
    await act(async () => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const replacement = column.cloneNode(true) as HTMLElement
    replacement.removeAttribute('data-dvw-native-sidebar')
    vi.spyOn(replacement.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ width: 340 } as DOMRect)
    await act(async () => { if (change === 'removed') column.remove(); else column.replaceWith(replacement) })
    expect(column.hasAttribute('data-dvw-native-sidebar')).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe(change === 'removed' ? 'false' : 'true')
    expect(document.body.style.getPropertyValue('--dvw-native-sidebar-width')).toBe(change === 'removed' ? '' : '340px')
  } finally {
    await act(async () => root.unmount())
    frame.remove()
  }
})

it.each(['room returns', 'workbench closes', 'host collapses'] as const)('restores the push mode after a fullscreen fallback when %s', async scenario => {
  document.body.innerHTML = `
    <div data-rightbar-col>
      <div data-sidebar-right-panel="push" data-sidebar-right-session="s" style="--dsh-sidebar-right-panel-width: 0px">
        <button data-sidebar-right-mode="fullscreen"></button>
        <button data-sidebar-right-toggle></button>
      </div>
    </div><button data-sidebar-right-expand></button><div id="mount"></div>`
  const panel = document.querySelector<HTMLElement>('[data-sidebar-right-panel]')!
  const mode = panel.querySelector<HTMLButtonElement>('[data-sidebar-right-mode]')!
  const collapse = panel.querySelector<HTMLButtonElement>('[data-sidebar-right-toggle]')!
  let columnWidth = 0
  vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, columnWidth, 500))
  const isExpanded = () => panel.hasAttribute('data-sidebar-right-open')
  mode.onclick = () => {
    if (!isExpanded()) return
    panel.dataset.sidebarRightPanel = mode.dataset.sidebarRightMode!
    mode.dataset.sidebarRightMode = panel.dataset.sidebarRightPanel === 'fullscreen' ? 'push' : 'fullscreen'
    if (panel.dataset.sidebarRightPanel === 'push' && columnWidth === 0) {
      queueMicrotask(() => panel.removeAttribute('data-sidebar-right-open'))
    }
  }
  collapse.onclick = () => panel.removeAttribute('data-sidebar-right-open')
  document.querySelector<HTMLButtonElement>('[data-sidebar-right-expand]')!.onclick = () => {
    panel.dataset.sidebarRightOpen = 'true'
    queueMicrotask(() => {
      if (panel.dataset.sidebarRightPanel === 'push' && columnWidth === 0) panel.removeAttribute('data-sidebar-right-open')
    })
  }
  const sidebar = {
    mounted: { getSnapshot: () => 's', subscribe: () => () => {} },
    isExpanded,
    // The public service flushes synchronously, so the host rejects this push before it returns.
    toggleExpanded() { panel.removeAttribute('data-sidebar-right-open') },
  } as unknown as ISidebarRight
  const root = createRoot(document.querySelector('#mount')!)
  function Toggle({ visible = true }: { visible?: boolean }) {
    const { shown, toggle } = useNativeSidebar(sidebar, 's', visible)
    return <button aria-expanded={shown} onClick={toggle}/>
  }
  try {
    await act(async () => root.render(<Toggle/>))
    const button = document.querySelector<HTMLButtonElement>('#mount button')!
    await act(async () => button.click())
    expect(panel.dataset.sidebarRightPanel).toBe('fullscreen')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
      if (scenario === 'room returns') {
        columnWidth = 340
        window.dispatchEvent(new Event('resize'))
      } else if (scenario === 'workbench closes') {
        root.render(<Toggle visible={false}/>)
      } else {
        collapse.click()
      }
    })
    expect(panel.dataset.sidebarRightPanel).toBe('push')
    expect(isExpanded()).toBe(scenario === 'room returns')
  } finally {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  }
})
