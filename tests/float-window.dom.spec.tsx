// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Workbench } from '../src/client/Workbench.tsx'
import { WorkbenchController } from '../src/client/service.ts'

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
  document.body.replaceChildren()
})

async function mount(): Promise<WorkbenchController> {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = url.split('/').at(-1)
    const value = method === 'workspace'
      ? { cwd: '/tmp/audit', name: 'audit' }
      : ['fs.list', 'search', 'git.status', 'terminal.list'].includes(method ?? '') ? [] : {}
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
