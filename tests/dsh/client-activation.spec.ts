// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/src/client/registry.ts'
import { act, createElement, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { WorkbenchPanel } from '../../src/client/index.tsx'
import { LayoutController, type MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import { installStyles } from '../../src/client/workbench/styles.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@deepseek-ai/dsh-api-terminal-controller/client', () => ({
  ClientTerminals: class { retainTabs() {} },
}))

it.each(['before', 'after'])('activates when official slots are declared %s the workbench client', async order => {
  const client = await import('../../src/client/index.tsx')
  const ctx = new Context()
  const sidebar = { openResource() {}, openResourceIn() {}, mounted: { getSnapshot: () => undefined }, openTabs: { getSnapshot: () => [] } }
  const tabDisposer = vi.fn()
  const registerTab = vi.fn(() => tabDisposer)
  ctx.reflect.provide('layout', { selectPanel() {} })
  ctx.reflect.provide('remote', { terminal: {} })
  ctx.reflect.provide('remote.terminal', {})
  ctx.reflect.provide('sidebarRight', sidebar)
  ctx.reflect.provide('sidebarRightTabs', { get: () => undefined, register: registerTab })
  new SlotRegistry(ctx)
  const declareShell = () => ctx.slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'contextMenu.icon': { kind: 'keyed', scope: 'root', inline: true },
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'conversation.hero.frame': { kind: 'hoc', scope: 'root' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    'settings.section': { kind: 'list', scope: 'root' },
    'settings.section.icon': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  try {
    if (order === 'before') declareShell()
    const fiber = ctx.plugin(client)
    await fiber.await()
    if (order === 'after') declareShell()

    expect(fiber.state).toBe(2)
    expect(ctx.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toContain('vscode-workbench')
    expect(ctx.slots.entries('main').map(entry => entry.options.key)).toContain('vscode-workbench')
    expect(ctx.slots.entries('contextMenu.icon')).toHaveLength(4)
    expect(ctx.slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toContain('dsh-vscode-workbench-conversation-actions')
    expect(registerTab).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dvw-conversation', keepMounted: true }))
    const conversation = ctx.slots.entries('sidebar.right.pane.tab')
    expect(conversation.map(entry => entry.options.key)).toEqual([])
    expect(ctx.slots.entries('conversation.hero.frame').map(entry => entry.options.id)).toContain('dsh-vscode-workbench/conversation')

    const toolbarEntry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const Toolbar = toolbarEntry.component as ComponentType<Record<string, unknown>>
    const toolbarHost = document.createElement('div')
    document.body.append(toolbarHost)
    const toolbarRoot = createRoot(toolbarHost)
    const removeStyles = installStyles()
    try {
      await act(async () => toolbarRoot.render(createElement(Toolbar, { ...toolbarEntry.inject?.(), sessionId: 's' })))
      expect(toolbarHost.querySelector('button'), 'workbench buttons must be absent from the official conversation').toBeNull()
      await act(async () => ctx.vscodeWorkbench.show())
      const openSidebar = toolbarHost.querySelector('button[aria-label="打开侧边栏"]')!
      expect(openSidebar).not.toBeNull()
      // A floating workbench must not add controls to the official page behind it.
      expect(getComputedStyle(openSidebar).display).toBe('none')
      toolbarHost.setAttribute('data-dvw-conversation-panel', 'sidebar')
      expect(getComputedStyle(openSidebar).display).toBe('inline-grid')
      toolbarHost.removeAttribute('data-dvw-conversation-panel')
      toolbarHost.className = 'dvw-native-conversation'
      expect(getComputedStyle(openSidebar).display).toBe('inline-grid')
      toolbarHost.className = ''
      await act(async () => ctx.vscodeWorkbench.hide())
      expect(toolbarHost.querySelector('button'), 'returning home must remove every workbench toolbar button').toBeNull()
    } finally {
      await act(async () => toolbarRoot.unmount())
      toolbarHost.remove()
      removeStyles()
      localStorage.clear()
    }

    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(ctx.slots.entries('contextMenu.icon')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.hero.frame')).toHaveLength(0)
    expect(tabDisposer).toHaveBeenCalledOnce()
    expect(sidebar.openResource.name).toBe('openResource')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('hands the main panel back to DSH without hiding the workbench or disabling its native sidebar', async () => {
  const node = document.createElement('div')
  const root = createRoot(node)
  const service = { show: vi.fn(), hide: vi.fn() }
  const restoreConversation = vi.fn()
  try {
    await act(async () => root.render(createElement(WorkbenchPanel, { service, restoreConversation } as never)))
    expect(service.show).toHaveBeenCalledOnce()
    expect(restoreConversation).toHaveBeenCalledOnce()
    expect(service.hide).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    expect(service.hide).not.toHaveBeenCalled()
  } finally {
    if (node.isConnected) await act(async () => root.unmount())
  }
})

it('restores the DSH composer when returning home from an empty workbench', async () => {
  const client = await import('../../src/client/index.tsx')
  const ctx = new Context()
  let panelInfo = { activePanelId: null as MainPanelId | null }
  const listeners = new Set<() => void>()
  const observable = {
    getSnapshot: () => panelInfo,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const layout = new LayoutController({ selectPanel(id: MainPanelId | null) {
    panelInfo = { activePanelId: id }
    for (const listener of listeners) listener()
  } } as never, () => true, observable)
  ctx.reflect.provide('layout', layout)
  ctx.reflect.provide('remote', { terminal: {} })
  ctx.reflect.provide('remote.terminal', {})
  ctx.reflect.provide('sidebarRight', { openResource() {}, mounted: { getSnapshot: () => undefined } })
  ctx.reflect.provide('sidebarRightTabs', { register() { return () => {} } })
  new SlotRegistry(ctx)
  ctx.slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const node = document.createElement('div')
  const root = createRoot(node)
  try {
    const fiber = ctx.plugin(client)
    await fiber.await()
    const service = ctx.vscodeWorkbench
    const entry = ctx.slots.entries('main').find(row => row.options.key === 'vscode-workbench')!
    const Panel = entry.component as ComponentType<{ service: typeof service }>
    function MainPanel() {
      const { activePanelId } = useSyncExternalStore(observable.subscribe, observable.getSnapshot)
      if (activePanelId === 'vscode-workbench') return createElement(Panel, entry.inject?.() as { service: typeof service })
      return activePanelId === null
        ? createElement('textarea', { 'aria-label': 'DSH 聊天输入框' })
        : createElement('div', { 'data-panel': activePanelId })
    }
    await act(async () => root.render(createElement(MainPanel)))
    for (let attempt = 0; attempt < 3; attempt++) {
      await act(async () => layout.selectPanel('vscode-workbench' as MainPanelId))
      expect(service.getSnapshot().visible).toBe(true)
      // DSH disables its official dock while any global main panel is selected.
      expect(panelInfo.activePanelId, 'native sidebar requires the conversation main panel').toBeNull()
      expect(node.querySelector('textarea')).not.toBeNull()
      // The empty editor's Home button calls this same service method.
      await act(async () => service.hide())
      expect(service.getSnapshot().visible).toBe(false)
      expect(node.querySelector('textarea[aria-label="DSH 聊天输入框"]')).not.toBeNull()
      expect(panelInfo.activePanelId).toBeNull()
    }
    // Hiding the overlay must retain another official page's selection.
    await act(async () => layout.selectPanel('vscode-workbench' as MainPanelId))
    await act(async () => layout.selectPanel('plugins' as MainPanelId))
    expect(service.getSnapshot().visible).toBe(true)
    expect(panelInfo.activePanelId).toBe('plugins')
    expect(node.querySelector('[data-panel="plugins"]')).not.toBeNull()
    await act(async () => service.hide())
    expect(panelInfo.activePanelId).toBe('plugins')
  } finally {
    await act(async () => root.unmount())
    await ctx.fiber.dispose()
    layout.dispose()
    localStorage.clear()
  }
})
