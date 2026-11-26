// @vitest-environment jsdom
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useNativeSidebar } from '../src/client/nativeSidebar.ts'
import { installStyles } from '../src/client/styles.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Keep the host's real transition declarations in the cascade. Only unwrap CSS
// Modules' global selectors; jsdom does not simulate animation frames themselves.
function officialTransitionRule(file: string, selector: string) {
  const source = readFileSync(resolve('node_modules/@deepseek-ai', file), 'utf8')
  const start = source.indexOf(selector)
  if (start < 0) throw new Error(`Official transition fixture is missing ${selector}`)
  return source.slice(start, source.indexOf('}', start) + 1).replace(/:global\(([^)]+)\)/g, '$1')
}

function transitionFixture({ workbench, conversation, requested, conversationMarker = conversation }: { workbench: boolean; conversation: boolean; requested: boolean; conversationMarker?: boolean }) {
  const attributes = ['data-dvw-workbench-active', 'data-dvw-conversation-active']
  const previous = attributes.map(name => document.body.getAttribute(name))
  document.body.toggleAttribute(attributes[0]!, workbench)
  document.body.toggleAttribute(attributes[1]!, conversationMarker)
  const official = document.createElement('style')
  official.textContent = [
    officialTransitionRule('dsh-client-ui-layout/src/client/AppFrame.module.css', '.frame[data-animating]'),
    officialTransitionRule('dsh-client-ui-sidebar-right/src/client/shell/SidebarRight.module.css', ".panel :global([data-dockkit-host='dock'])"),
    officialTransitionRule('dsh-client-ui-sidebar-right/src/client/shell/SidebarRight.module.css', ".panel[data-sidebar-right-open] :global([data-dockkit-host='dock'])"),
    ".panel [data-dockkit-host='float']{transition:opacity 170ms ease}",
  ].join('\n')
  document.head.append(official)
  const frame = document.createElement('div')
  frame.className = 'frame'
  frame.setAttribute('data-animating', '')
  frame.innerHTML = `<div data-rightbar-col ${requested ? 'data-dvw-native-sidebar="push"' : ''}>
    <div class="panel" data-sidebar-right-panel="push" data-sidebar-right-session="s" data-sidebar-right-open="true">
      <div data-dockkit-host="dock"></div><div data-dockkit-empty></div><div data-dockkit-divider></div>
      <div data-dockkit-host="float"><section data-dockkit-float="terminal"></section></div>
    </div>
  </div><div data-shell-overlay><div class="dvw-overlay" data-dvw-conversation="${conversation}"></div></div>`
  document.body.append(frame)
  const removeStyles = installStyles()
  return {
    frame,
    docked: [...frame.querySelectorAll<HTMLElement>('[data-dockkit-host="dock"], [data-dockkit-empty], [data-dockkit-divider]')],
    floating: frame.querySelector<HTMLElement>('[data-dockkit-host="float"]')!,
    dispose() {
      removeStyles()
      official.remove()
      frame.remove()
      for (const [index, name] of attributes.entries()) {
        const value = previous[index]
        if (value === null || value === undefined) document.body.removeAttribute(name)
        else document.body.setAttribute(name, value)
      }
    },
  }
}

it('opens the requested native dock without exposing a closed conversation during its slide', () => {
  const fixture = transitionFixture({ workbench: true, conversation: false, requested: true })
  try {
    expect(getComputedStyle(fixture.frame).transition).toBe('none')
    for (const item of fixture.docked) {
      expect(getComputedStyle(item).transition).toBe('none')
      expect(getComputedStyle(item).transform).toBe('none')
      expect(getComputedStyle(item).visibility).toBe('visible')
    }
    expect(getComputedStyle(fixture.floating).transition).toBe('opacity 170ms ease')
  } finally { fixture.dispose() }
})

it.each([
  { name: 'the conversation is showing', workbench: true, conversation: true, requested: true },
  // A width update briefly releases the conversation placement effect's body
  // marker. The render-level visibility remains true throughout that cleanup.
  { name: 'conversation placement is refreshing', workbench: true, conversation: true, requested: true, conversationMarker: false },
  { name: 'the workbench is inactive', workbench: false, conversation: false, requested: true },
  { name: 'the native dock was not requested', workbench: true, conversation: false, requested: false },
])('preserves the official dock transitions when $name', state => {
  const fixture = transitionFixture(state)
  try {
    expect(getComputedStyle(fixture.frame).transition).toContain('grid-template-columns')
    for (const item of fixture.docked) expect(getComputedStyle(item).transition).toContain('transform')
    expect(getComputedStyle(fixture.floating).transition).toBe('opacity 170ms ease')
  } finally { fixture.dispose() }
})

it('lets a terminal dragged out of the native dock keep its viewport layer when the dock is dismissed', () => {
  document.body.innerHTML = '<style>[data-sidebar-right-panel="fullscreen"]{--dsh-dockkit-dock-layer:40;--dsh-dockkit-float-layer:60}</style><div data-rightbar-col><div data-sidebar-right-panel="fullscreen"><div data-dockkit-host="float"><section data-dockkit-float="terminal"></section></div></div></div><div data-shell-overlay><div class="dvw-overlay"></div></div>'
  const removeStyles = installStyles()
  try {
    const column = document.querySelector<HTMLElement>('[data-rightbar-col]')!
    const panel = document.querySelector<HTMLElement>('[data-sidebar-right-panel]')!
    expect(getComputedStyle(column).isolation).not.toBe('isolate')
    // Background docks stay below the shell overlay (20); floats retain their native layer (60).
    expect(getComputedStyle(panel).getPropertyValue('--dsh-dockkit-dock-layer').trim()).toBe('10')
    expect(getComputedStyle(panel).getPropertyValue('--dsh-dockkit-float-layer').trim()).toBe('60')
  } finally {
    removeStyles()
    document.body.replaceChildren()
  }
})

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
