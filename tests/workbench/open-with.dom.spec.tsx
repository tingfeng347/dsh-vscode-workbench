// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagePreview } from '../../src/client/preview/ImagePreview.tsx'
import { OpenWith } from '../../src/client/workspace/OpenWith.tsx'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../src/client/transport/api.ts', () => ({ api: request }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined

beforeEach(() => { request.mockReset().mockResolvedValue({ available: true, applications: [] }) })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
async function mount(element = <ImagePreview src="/dsh-vscode/file?sessionId=s&path=image.png" path="image.png"/>) {
  const host = document.createElement('div')
  host.className = 'dvw-overlay'
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(element))
}
function main() { return document.querySelector<HTMLButtonElement>('.dvw-open-with-main')! }
function more() { return document.querySelector<HTMLButtonElement>('.dvw-open-with-more')! }
function item(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node => node.textContent === label)! }
const apps = [
  { id: 'first', name: 'First App', default: false, icon: null },
  { id: 'preferred', name: 'Image App', default: true, icon: 'data:image/png;base64,AA==' },
]

describe('native file opening controls', () => {
  it('uses an icon placeholder during loading and stays compact when reveal is the only action', async () => {
    let resolve!: (value: unknown) => void
    request.mockReturnValueOnce(new Promise(done => { resolve = done }))
    await mount()
    expect(main().textContent).toBe('')
    expect(main().disabled).toBe(true)
    expect(main().querySelector('[data-open-target-skeleton]')).not.toBeNull()
    await act(async () => resolve({ available: true, applications: [] }))
    expect(main().textContent).toBe('')
    expect(main().getAttribute('aria-label')).toBe('显示文件位置')
    expect(main().disabled).toBe(false)
    expect(document.querySelectorAll('.dvw-preview-header button')).toHaveLength(1)
    await act(async () => main().click())
    expect(request).toHaveBeenLastCalledWith('fs.openExternal', { sessionId: 's', path: 'image.png', action: 'reveal' })
  })

  it('shows the preferred app icon and a menu ending with file reveal', async () => {
    request.mockResolvedValue({ available: true, applications: apps })
    await mount()
    expect(main().textContent).toBe('')
    expect(main().getAttribute('aria-label')).toBe('用 Image App 打开')
    expect(main().querySelector('img')?.getAttribute('src')).toBe(apps[1]!.icon)
    await act(async () => main().click())
    expect(request).toHaveBeenLastCalledWith('fs.openExternal', { sessionId: 's', path: 'image.png' })
    await act(async () => more().click())
    expect(item('Image App（默认）')).toBeDefined()
    const entries = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(entries.at(-1)?.textContent).toBe('显示文件位置')
    expect(document.querySelector('.dvw-preview-header [role="menu"]')).toBeNull()
    await act(async () => item('First App').click())
    expect(request).toHaveBeenLastCalledWith('fs.openExternal', { sessionId: 's', path: 'image.png', application: 'first' })
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('uses the first app when the host has no default marker and supports keyboard dismissal', async () => {
    request.mockResolvedValue({ available: true, applications: apps.map(app => ({ ...app, default: false })) })
    await mount()
    expect(main().getAttribute('aria-label')).toBe('用 First App 打开')
    await act(async () => main().click())
    expect(request).toHaveBeenLastCalledWith('fs.openExternal', { sessionId: 's', path: 'image.png', application: 'first' })
    await act(async () => more().click())
    expect(document.activeElement).toBe(item('First App（默认）'))
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(document.activeElement).toBe(item('显示文件位置'))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(more())
  })

  it('retains a labeled action in the unsupported-file empty state', async () => {
    request.mockResolvedValue({ available: true, applications: apps })
    await mount(<OpenWith sessionId="s" path="file.bin"/>)
    expect(main().textContent).toBe('打开')
  })

  it('keeps file reveal available after an app-list failure and falls back from broken app icons', async () => {
    request.mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect(main().textContent).toBe('')
    expect(main().getAttribute('aria-label')).toBe('显示文件位置')
    await act(async () => more().click())
    expect(item('无法加载应用列表').disabled).toBe(true)
    await act(async () => item('显示文件位置').click())
    expect(request).toHaveBeenLastCalledWith('fs.openExternal', { sessionId: 's', path: 'image.png', action: 'reveal' })
    await act(async () => root!.unmount())
    request.mockResolvedValue({ available: true, applications: apps })
    await mount()
    const image = main().querySelector('img')!
    await act(async () => image.dispatchEvent(new Event('error')))
    expect(main().querySelector('img')).toBeNull()
    expect(main().querySelector('.codicon-link-external')).not.toBeNull()
    expect(main().getAttribute('aria-label')).toBe('用 Image App 打开')
  })
})
