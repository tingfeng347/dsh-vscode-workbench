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
vi.mock('../src/client/DshConversationPanel.tsx', () => ({ DshConversationPanel: () => null, DshConversationTheme: () => null, DshReviewActions: () => null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined

class FakeSocket {
  onmessage?: (event: { data: string }) => void
  onopen?: () => void
  close() {}
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'fullscreenElement')
  Reflect.deleteProperty(document, 'exitFullscreen')
  localStorage.clear()
  settingsHost.set(undefined)
  document.body.replaceChildren()
})

async function mount(): Promise<WorkbenchController> {
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
        : ['fs.list', 'search', 'git.status', 'lsp.status', 'terminal.list'].includes(method ?? '') ? [] : {}
    return { ok: true, json: async () => ({ ok: true, value }) }
  }))
  const service = new WorkbenchController()
  service.show()
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit"/>) })
  return service
}

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
}

it('renders the workbench as a floating layer with its own drag bar', async () => {
  localStorage.setItem('dvw:open-mode', 'floating')
  await mount()
  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  expect(overlay.getAttribute('data-dvw-float')).toBe('true')
  expect(overlay.style.left).not.toBe('')
  expect(overlay.style.top).not.toBe('')
  expect(overlay.style.width).not.toBe('')
  expect(overlay.style.height).not.toBe('')
  expect(overlay.style.paddingTop).toBe('34px')
  expect(document.querySelector('.dvw-floatbar')).not.toBeNull()
  expect(document.querySelectorAll('.dvw-float-handle')).toHaveLength(8)
  expect(document.querySelector('.dvw-chat')).toBeNull()
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
  const request = vi.fn(async () => { current = overlay; document.dispatchEvent(new Event('fullscreenchange')) })
  const exit = vi.fn(async () => { current = null; document.dispatchEvent(new Event('fullscreenchange')) })
  Object.defineProperty(overlay, 'requestFullscreen', { configurable: true, value: request })
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
  expect(document.querySelector('[aria-label="进入全屏"]')).not.toBeNull()
})

it('falls back to filling the DSH window when the host rejects fullscreen', async () => {
  localStorage.setItem('dvw:open-mode', 'floating')
  await mount()
  const overlay = document.querySelector<HTMLElement>('.dvw-overlay')!
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
  Object.defineProperty(overlay, 'requestFullscreen', { configurable: true, value: vi.fn(async () => { throw new Error('denied') }) })
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
