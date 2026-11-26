// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Workbench } from '../src/client/Workbench.tsx'
import { WorkbenchController } from '../src/client/service.ts'
import { settingsHost } from '../src/client/settingsHost.ts'

vi.mock('../src/client/MonacoEditor.tsx', () => ({
  MonacoEditor: () => null,
  MonacoDiffEditor: () => null,
  preloadMonaco: () => {},
  retainEditorModels: () => {},
  loadMonaco: () => Promise.resolve({ editor: { registerEditorOpener: () => ({ dispose() {} }) } }),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined

class FakeSocket extends EventTarget {
  close() {}
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'fullscreenElement')
  Reflect.deleteProperty(document, 'exitFullscreen')
  Reflect.deleteProperty(document.body, 'requestFullscreen')
  localStorage.clear()
  settingsHost.set(undefined)
  document.body.replaceChildren()
})

async function mount(dshPanelId?: string, onOpenDshPanel?: (id: string) => void, overrides: Pick<Parameters<typeof Workbench>[0], 'rightSidebar' | 'browser'> = {}): Promise<WorkbenchController> {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = url.split('/').at(-1)
    const value = method === 'workspace'
      ? { cwd: '/tmp/audit', name: 'audit' }
      : method === 'commit.models'
        ? { models: [
            { provider: 'deepseek-official', model: 'deepseek-flash', id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', providerName: 'DeepSeek', badge: { text: '1017', tone: 'info' } },
            { provider: 'deepseek-official', model: 'deepseek-v4-pro', id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', providerName: 'DeepSeek' },
          ], unavailable: [], defaultModel: { provider: 'deepseek-official', model: 'deepseek-flash' } }
        : method === 'git.status' ? {repository:'/tmp/audit', branch:'main', ahead:0, behind:0, changes:[]}
        : method === 'fs.list' ? [{ name: 'sidebar-reference.txt', path: 'sidebar-reference.txt', kind: 'file' }]
        : ['search', 'lsp.status', 'terminal.list'].includes(method ?? '') ? [] : {}
    return { ok: true, json: async () => ({ ok: true, value }) }
  }))
  const service = new WorkbenchController()
  service.show()
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit" dshPanelId={dshPanelId} onOpenDshPanel={onOpenDshPanel} {...overrides}/>) })
  return service
}

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
}

it('renders the workbench as a floating layer with its own drag bar', async () => {
  localStorage.setItem('dvw:open-mode', 'floating')
  localStorage.setItem('dvw:activity-order-v2', JSON.stringify(['plugins', 'chat']))
  await mount(undefined, vi.fn())
  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  expect(overlay.getAttribute('data-dvw-float')).toBe('true')
  expect(overlay.style.left).not.toBe('')
  expect(overlay.style.top).not.toBe('')
  expect(overlay.style.width).not.toBe('')
  expect(overlay.style.height).not.toBe('')
  expect(overlay.style.paddingTop).toBe('34px')
  expect(document.querySelector('.dvw-floatbar')).not.toBeNull()
  expect(document.querySelectorAll('.dvw-float-handle')).toHaveLength(8)
  expect(document.querySelector('.dvw-chat')).not.toBeNull()
  expect(document.querySelector('.dvw-chat-head')).toBeNull()
  expect(document.querySelector('[data-act-id="plugins"]')).toBeNull()
  expect(document.querySelector('.dvw-activity [data-act-id="chat"][title^="关闭 DSH 对话栏"]')).not.toBeNull()
})

it('keeps the native conversation and plugin page inside the moving window', async () => {
  localStorage.setItem('dvw:open-mode', 'floating')
  const conversation = document.createElement('div')
  conversation.dataset.phase = 'ready'
  conversation.innerHTML = '<div data-conversation-scroll></div>'
  const panel = document.createElement('div')
  panel.dataset.globalPanel = ''
  panel.style.left = '8px'
  document.body.append(conversation, panel)
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const overlay = this.closest<HTMLElement>('.dvw-overlay')
    if (overlay && this.matches('.dvw-editor, .dvw-chat-body')) {
      return new DOMRect(parseFloat(overlay.style.left) + 50, parseFloat(overlay.style.top) + 50, 350, 400)
    }
    return new DOMRect(0, 0, 800, 600)
  })
  try {
    const service = await mount('plugins')
    const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
    const bar = document.querySelector<HTMLElement>('.dvw-floatbar')!
    const check = async (surface: HTMLElement) => vi.waitFor(() => {
      expect(surface.style.top).toBe(`${parseFloat(overlay.style.top) + 50}px`)
      expect(surface.style.left).toBe(`${parseFloat(overlay.style.left) + 50}px`)
    })
    await check(panel)
    await act(async () => {
      bar.dispatchEvent(pointer('pointerdown', 200, 120))
      window.dispatchEvent(pointer('pointermove', 220, 140))
      window.dispatchEvent(pointer('pointerup', 220, 140))
    })
    await check(panel)
    await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit"/>) })
    expect(panel.style.left).toBe('8px')
    expect(conversation.hasAttribute('data-dvw-conversation-panel')).toBe(true)
    await check(conversation)
    await act(async () => document.querySelector<HTMLButtonElement>('.dvw-activity [data-act-id="chat"][title^="关闭 DSH 对话栏"]')!.click())
    expect(conversation.hasAttribute('data-dvw-conversation-panel')).toBe(false)
    expect(conversation.style.left).toBe('')
  } finally {
    rect.mockRestore()
  }
})

it('keeps the full-window layout untouched by default', async () => {
  await mount()
  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  expect(overlay.hasAttribute('data-dvw-float')).toBe(false)
  expect(overlay.style.left).toBe('')
  expect(document.querySelector('.dvw-floatbar')).toBeNull()
  expect(document.querySelector('.dvw-tab') ?? document.querySelector('.dvw-empty')).not.toBeNull()
})

it('renders the workbench settings page even when no session is selected', async () => {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, value: { models: [], unavailable: [] } }) })))
  const service = new WorkbenchController()
  service.show()
  const app = document.createElement('div')
  const settings = document.createElement('div')
  document.body.append(app, settings)
  settingsHost.set(settings)
  root = createRoot(app)
  await act(async () => { root!.render(<Workbench service={service} sessionId={undefined}/>) })
  expect(settings.textContent).toContain('外观')
  expect(settings.textContent).toContain('提交信息')
  expect(settings.textContent).toContain('生成模型')
})

it('follows the DeepSeek chat model by default and keeps the menu open while it scrolls', async () => {
  const settings = document.createElement('div')
  document.body.append(settings)
  settingsHost.set(settings)
  await mount()
  const trigger = await vi.waitFor(() => {
    const value = [...settings.querySelectorAll<HTMLButtonElement>('.dvw-set-selector')]
      .find(button => button.getAttribute('aria-label')?.startsWith('提交信息生成模型：跟随 DSH 聊天模型（DeepSeek-V4.1-Flash）'))
    expect(value).not.toBeUndefined()
    return value!
  })
  expect(trigger.textContent).toContain('DeepSeek-V4.1-Flash')
  expect(trigger.textContent).toContain('1017')
  await act(async () => trigger.click())
  const menu = await vi.waitFor(() => {
    const value = settings.querySelector<HTMLElement>('.dvw-set-menu[aria-label="提交信息生成模型"]')
    expect(value).not.toBeNull()
    return value!
  })
  expect(menu.textContent).toContain('跟随 DSH 聊天模型')
  expect(menu.textContent).toContain('DeepSeek-V4.1-Flash')
  expect(menu.textContent).toContain('DeepSeek-V4-Pro')
  expect(menu.textContent).toContain('1017')
  await act(async () => menu.dispatchEvent(new Event('scroll')))
  expect(settings.querySelector('.dvw-set-menu[aria-label="提交信息生成模型"]')).not.toBeNull()
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(settings.querySelector('.dvw-set-menu[aria-label="提交信息生成模型"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('can override the chat model and return to following it', async () => {
  const settings = document.createElement('div')
  document.body.append(settings)
  settingsHost.set(settings)
  await mount()
  let trigger = await vi.waitFor(() => {
    const value = [...settings.querySelectorAll<HTMLButtonElement>('.dvw-set-selector')]
      .find(button => button.getAttribute('aria-label')?.startsWith('提交信息生成模型：跟随 DSH 聊天模型'))
    expect(value).not.toBeUndefined()
    return value!
  })
  await act(async () => trigger.click())
  const pro = await vi.waitFor(() => {
    const value = [...settings.querySelectorAll<HTMLButtonElement>('.dvw-set-menu button')]
      .find(button => button.textContent === 'DeepSeek-V4-Pro')
    expect(value).not.toBeUndefined()
    return value!
  })
  await act(async () => pro.click())
  await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('dvw:commit-model')!)).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }))
  trigger = settings.querySelector<HTMLButtonElement>('button[aria-label^="提交信息生成模型：DeepSeek-V4-Pro"]')!
  expect(trigger).not.toBeNull()
  await act(async () => trigger.click())
  const follow = await vi.waitFor(() => {
    const value = [...settings.querySelectorAll<HTMLButtonElement>('.dvw-set-menu button')]
      .find(button => button.textContent?.startsWith('跟随 DSH 聊天模型'))
    expect(value).not.toBeUndefined()
    return value!
  })
  await act(async () => follow.click())
  await vi.waitFor(() => expect(localStorage.getItem('dvw:commit-model')).toBeNull())
  expect(settings.querySelector('button[aria-label^="提交信息生成模型：跟随 DSH 聊天模型（DeepSeek-V4.1-Flash）"]')).not.toBeNull()
})

it('drags the floating layer and persists the new geometry', async () => {
  localStorage.setItem('dvw:open-mode', 'floating')
  await mount()
  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  const bar = document.querySelector<HTMLElement>('.dvw-floatbar')!
  const left = Number.parseFloat(overlay.style.left)
  const top = Number.parseFloat(overlay.style.top)
  await act(async () => {
    bar.dispatchEvent(pointer('pointerdown', 200, 120))
    window.dispatchEvent(pointer('pointermove', 220, 140))
    window.dispatchEvent(pointer('pointerup', 220, 140))
  })
  expect(overlay.style.left).toBe(`${left + 20}px`)
  expect(overlay.style.top).toBe(`${top + 20}px`)
  expect(JSON.parse(localStorage.getItem('dvw:float-rect') ?? '{}')).toMatchObject({ x: left + 20, y: top + 20 })
})

it('enters real fullscreen and leaves the DSH chrome behind', async () => {
  localStorage.setItem('dvw:open-mode', 'floating')
  await mount()
  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  let current: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current })
  const request = vi.fn(async () => { current = document.body; document.dispatchEvent(new Event('fullscreenchange')) })
  const exit = vi.fn(async () => { current = null; document.dispatchEvent(new Event('fullscreenchange')) })
  Object.defineProperty(document.body, 'requestFullscreen', { configurable: true, value: request })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="进入全屏"]')!.click()
    await Promise.resolve()
  })
  expect(request).toHaveBeenCalledTimes(1)
  expect(overlay.getAttribute('data-dvw-float-fullscreen')).toBe('true')
  expect(overlay.hasAttribute('data-dvw-float-max')).toBe(false)
  expect(document.querySelector('[aria-label="退出全屏"]')).not.toBeNull()
  expect(document.querySelectorAll('.dvw-float-handle')).toHaveLength(0)
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="退出全屏"]')!.click()
    await Promise.resolve()
  })
  expect(exit).toHaveBeenCalledTimes(1)
  expect(overlay.hasAttribute('data-dvw-float-fullscreen')).toBe(false)
  const enter = document.querySelector<HTMLButtonElement>('[aria-label="进入全屏"]')!
  await act(async () => enter.click())
  await act(async () => document.querySelector<HTMLButtonElement>('.dvw-floatbar [aria-label="返回 DSH"]')!.click())
  expect(exit).toHaveBeenCalledTimes(2)
  expect(document.querySelector('.dvw-overlay')).toBeNull()
})

it('falls back to filling the DSH window when the host rejects fullscreen', async () => {
  localStorage.setItem('dvw:open-mode', 'floating')
  await mount()
  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
  Object.defineProperty(document.body, 'requestFullscreen', { configurable: true, value: vi.fn(async () => { throw new Error('denied') }) })
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="进入全屏"]')!.click()
    await Promise.resolve()
  })
  expect(overlay.getAttribute('data-dvw-float-max')).toBe('true')
  expect(overlay.style.left).toBe('0px')
  expect(overlay.style.top).toBe('48px')
  expect(overlay.style.width).toBe(`${window.innerWidth}px`)
  expect(overlay.style.height).toBe(`${window.innerHeight - 48}px`)
  expect(localStorage.getItem('dvw:float-max')).toBe('1')
  expect(document.querySelectorAll('.dvw-float-handle')).toHaveLength(0)
})

it('fits the conversation and restores an existing browser after opening the native sidebar', async () => {
  vi.stubGlobal('innerWidth', 1000)
  const column = document.createElement('div')
  column.setAttribute('data-rightbar-col', '')
  column.innerHTML = '<div data-sidebar-right-panel="push" data-sidebar-right-session="s"></div>'
  document.body.append(column)
  const panel = column.firstElementChild as HTMLElement
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect)
  const isExpanded = () => panel.hasAttribute('data-sidebar-right-open')
  const rightSidebar = {
    mounted: { getSnapshot: () => 's', subscribe: () => () => {} },
    isExpanded,
    toggleExpanded: vi.fn(() => {
      if (isExpanded()) panel.removeAttribute('data-sidebar-right-open')
      else panel.setAttribute('data-sidebar-right-open', 'true')
    }),
  } as unknown as Parameters<typeof Workbench>[0]['rightSidebar']
  const focus = vi.fn()
  const browser = {
    getSnapshot: () => ({ available: true, tabs: [{ id: 'existing', sessionId: 's', title: 'Existing browser' }] }),
    subscribe: () => () => {},
    focus,
  } as unknown as Parameters<typeof Workbench>[0]['browser']
  await mount(undefined, undefined, { rightSidebar, browser })

  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  const sidebarToggle = document.querySelector<HTMLButtonElement>('[data-act-id="native-sidebar"]')!
  const browserTab = document.querySelector<HTMLButtonElement>('[data-dvw-browser-tab="existing"]')!
  await act(async () => sidebarToggle.click())
  expect(sidebarToggle.getAttribute('aria-expanded')).toBe('true')
  expect(document.body.style.getPropertyValue('--dvw-native-sidebar-width')).toBe('300px')
  expect(overlay.dataset.dvwChat).toBe('true')
  expect(overlay.style.getPropertyValue('--dvw-chat-width')).toBe('440px')
  expect(overlay.style.getPropertyValue('--dvw-side-width')).toBe('112px')

  await act(async () => browserTab.click())
  expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false')
  expect(focus).toHaveBeenCalledWith('existing')
  expect(browserTab.dataset.active).toBe('true')
  expect(document.body.style.getPropertyValue('--dvw-native-sidebar-width')).toBe('')

  await act(async () => sidebarToggle.click())
  vi.stubGlobal('innerWidth', 850)
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(overlay.hasAttribute('data-dvw-chat')).toBe(false)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', ctrlKey: true, altKey: true })))
  expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false')
  expect(overlay.dataset.dvwChat).toBe('true')
})

function mockNativeDock(mode: 'push' | 'fullscreen', width = 360) {
  const column = document.createElement('div')
  column.setAttribute('data-rightbar-col', '')
  column.innerHTML = `<div data-sidebar-right-panel="${mode}" data-sidebar-right-session="s"></div>`
  document.body.append(column)
  const panel = column.firstElementChild as HTMLElement
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect)
  return {
    mounted: { getSnapshot: () => 's', subscribe: () => () => {} },
    isExpanded: () => panel.hasAttribute('data-sidebar-right-open'),
    toggleExpanded: () => panel.toggleAttribute('data-sidebar-right-open')
      ? panel.setAttribute('data-sidebar-right-open', 'true') : undefined,
  } as unknown as Parameters<typeof Workbench>[0]['rightSidebar']
}

it('returns from the fullscreen native dock to the conversation with Ctrl+Alt+B', async () => {
  await mount(undefined, undefined, { rightSidebar: mockNativeDock('fullscreen') })
  const button = document.querySelector<HTMLButtonElement>('[data-act-id="native-sidebar"]')!
  await act(async () => button.click())
  expect(button.getAttribute('aria-expanded')).toBe('true')
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', ctrlKey: true, altKey: true })))
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector('.dvw-overlay')?.getAttribute('data-dvw-chat')).toBe('true')
})

it('reveals the conversation when adding a file from a cramped workspace', async () => {
  vi.stubGlobal('innerWidth', 950)
  const conversation = document.createElement('div')
  conversation.dataset.phase = 'active'
  conversation.innerHTML = '<div data-conversation-scroll></div><div data-composer-card><textarea>draft</textarea></div>'
  document.body.append(conversation)
  await mount(undefined, undefined, { rightSidebar: mockNativeDock('push', 370) })
  const button = document.querySelector<HTMLButtonElement>('[data-act-id="native-sidebar"]')!
  await act(async () => button.click())
  expect(document.querySelector('.dvw-overlay')?.hasAttribute('data-dvw-chat')).toBe(false)
  const row = document.querySelector<HTMLElement>('[data-tree-path="sidebar-reference.txt"]')!
  await act(async () => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const menuItem = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.includes('添加到 DSH 对话'))!
  await act(async () => menuItem.click())
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector('.dvw-overlay')?.getAttribute('data-dvw-chat')).toBe('true')
  await vi.waitFor(() => expect(conversation.querySelector('textarea')?.value).toContain('sidebar-reference.txt'))
  expect(conversation.querySelector('textarea')?.value).toContain('draft')
})

it('never focuses an older browser tab while changing to another session', async () => {
  const focus = vi.fn()
  const previous = { id: 'old', sessionId: 's', title: 'Old browser' }
  const browser = {
    getSnapshot: () => ({ available: true, tabs: [previous] }),
    subscribe: () => () => {},
    focus,
  } as unknown as Parameters<typeof Workbench>[0]['browser']
  const service = await mount(undefined, undefined, { rightSidebar: mockNativeDock('push'), browser })
  await act(async () => document.querySelector<HTMLButtonElement>('[data-dvw-browser-tab="old"]')!.click())
  expect(focus).toHaveBeenCalledWith('old')
  const toggle = document.querySelector<HTMLButtonElement>('[data-act-id="native-sidebar"]')!
  await act(async () => toggle.click())
  focus.mockClear()
  await act(async () => root!.render(<Workbench service={service} browser={browser} sessionId="other" cwd="/tmp/audit"/>))
  expect(focus).not.toHaveBeenCalled()
  expect(document.querySelector('[data-dvw-browser-tab="old"]')).toBeNull()
})

it('reports and applies the separator range at the fitted left-pane width', async () => {
  vi.stubGlobal('innerWidth', 1042)
  await mount(undefined, undefined, { rightSidebar: mockNativeDock('push', 299.4) })
  await act(async () => document.querySelector<HTMLButtonElement>('[data-act-id="native-sidebar"]')!.click())
  const separator = document.querySelector<HTMLElement>('.dvw-side-resizer')!
  expect(separator.getAttribute('aria-valuenow')).toBe('154')
  expect(Number(separator.getAttribute('aria-valuemin'))).toBeLessThanOrEqual(154)
  expect(separator.getAttribute('aria-valuemax')).toBe('154')
})
