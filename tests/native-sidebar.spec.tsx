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
