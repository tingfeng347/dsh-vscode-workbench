// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Workbench } from '../src/client/Workbench.tsx'
import type { MonacoEditor } from '../src/client/MonacoEditor.tsx'
import { WorkbenchController } from '../src/client/service.ts'

type EditorProps = Parameters<typeof MonacoEditor>[0]
const state = vi.hoisted(() => ({ editor: undefined as EditorProps | undefined }))
// Monaco and the DSH conversation are external rendering integrations. Exercise
// the workbench's real state and HTTP client with a controlled network boundary.
vi.mock('../src/client/MonacoEditor.tsx', () => ({ MonacoEditor: (props: EditorProps) => { state.editor = props; return null }, MonacoDiffEditor: () => null, preloadMonaco: () => {}, retainEditorModels: () => {} }))
vi.mock('../src/client/DshConversationPanel.tsx', () => ({ DshConversationPanel: () => null, DshConversationTheme: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let disk = 'disk'
let revision = 'r1'
let completeSave: (() => void) | undefined
const sockets: FakeSocket[] = []
class FakeSocket {
  onmessage?: (event: { data: string }) => void
  onopen?: () => void
  constructor() { sockets.push(this) }
  close() {}
  change(paths: string[]) { this.onmessage?.({ data: JSON.stringify({ paths }) }) }
}
afterEach(async () => {
  await act(async () => { root?.unmount() }); root = undefined
  vi.unstubAllGlobals(); localStorage.clear(); document.body.replaceChildren(); sockets.length = 0
})
async function mount(service = new WorkbenchController(), visible = true) {
  if (visible) service.show()
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit"/>) })
  return service
}
async function setup(binary = false) {
  disk = 'disk'; revision = 'r1'; completeSave = undefined; state.editor = undefined
  localStorage.setItem('dvw:/tmp/audit', JSON.stringify({ paths: ['a.txt'], active: 'a.txt' }))
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: { body: string }) => {
    const method = url.split('/').at(-1)
    const doc = () => ({ path: 'a.txt', content: binary ? '' : disk, revision, size: binary ? 0 : disk.length, binary, tooLarge: false })
    let value: unknown
    if (method === 'workspace') value = { cwd: '/tmp/audit', name: 'audit' }
    else if (method === 'fs.list') value = []
    else if (method === 'git.status') value = { changes: [] }
    else if (method === 'fs.read') value = doc()
    else if (method === 'fs.save') return new Promise(resolve => {
      const body = JSON.parse(options.body)
      completeSave = () => { disk = body.content; revision = 'r2'; resolve({ ok: true, json: async () => ({ ok: true, value: doc() }) }) }
    })
    return { ok: true, json: async () => ({ ok: true, value }) }
  }))
  return mount()
}
it('preserves an unsaved draft when returning to DSH and reopening', async () => {
  const service = await setup()
  await act(async () => state.editor!.onChange('unsaved draft'))
  await act(async () => service.hide())
  await act(async () => service.show())
  expect(state.editor!.value).toBe('unsaved draft')
})

it('keeps edits entered while a save is pending and saves them on the next request', async () => {
  await setup()
  await act(async () => state.editor!.onChange('saved draft'))
  await act(async () => state.editor!.onSave())
  await act(async () => state.editor!.onChange('newer draft'))
  await act(async () => completeSave!())
  expect(state.editor!.value).toBe('newer draft')
  expect(disk).toBe('saved draft')
  await act(async () => state.editor!.onSave())
  await act(async () => completeSave!())
  expect(disk).toBe('newer draft')
})

it('restores unsaved drafts after remounting and detects a changed disk version', async () => {
  const service = await setup()
  await act(async () => state.editor!.onChange('recovered draft'))
  await act(async () => root!.unmount()); root = undefined
  disk = 'external edit'; revision = 'external'
  await mount(service)
  await act(async () => sockets.at(-1)!.onopen?.())
  expect(state.editor!.value).toBe('recovered draft')
  expect(document.body.textContent).toContain('磁盘文件已变化')
})

it('reloads a clean document when its path changes on disk', async () => {
  await setup()
  disk = 'updated by DSH'; revision = 'external'
  await act(async () => sockets.at(-1)!.change(['a.txt']))
  expect(state.editor!.value).toBe('updated by DSH')
})

it('preserves a dirty draft and only marks external changes for its own path', async () => {
  await setup()
  await act(async () => state.editor!.onChange('my draft'))
  disk = 'external edit'; revision = 'external'
  await act(async () => sockets.at(-1)!.change(['unrelated.txt']))
  expect(document.body.textContent).not.toContain('磁盘文件已变化')
  await act(async () => sockets.at(-1)!.change(['a.txt']))
  expect(state.editor!.value).toBe('my draft')
  expect(document.body.textContent).toContain('磁盘文件已变化')
})

it('ignores an old disk read that arrives after saving', async () => {
  await setup()
  await act(async () => state.editor!.onChange('saved draft'))
  const originalFetch = fetch
  let finishRead!: () => void
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => url.endsWith('/fs.read')
    ? new Promise(resolve => { finishRead = () => resolve({ ok: true, json: async () => ({ ok: true, value: { path: 'a.txt', content: 'disk', revision: 'r1', size: 4, binary: false, tooLarge: false } }) }) })
    : originalFetch(url, options))
  await act(async () => sockets.at(-1)!.change(['a.txt']))
  await act(async () => state.editor!.onSave())
  await act(async () => completeSave!())
  await act(async () => finishRead())
  expect(state.editor!.value).toBe('saved draft')
  expect(document.body.textContent).not.toContain('磁盘文件已变化')
})

it('closes tabs from the VS Code tab context menu', async () => {
  await setup(true)
  const tab = document.querySelector<HTMLButtonElement>('.dvw-tab')
  expect(tab).not.toBeNull()
  await act(async () => { tab!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 120 })) })
  expect(document.querySelector('.dvw-tab-menu')).not.toBeNull()
  const items = [...document.querySelectorAll<HTMLButtonElement>('.dvw-tab-menu button')]
  expect(items.map(item => item.textContent)).toEqual(['关闭Ctrl+F4', '关闭其他', '关闭右侧标签页', '关闭已保存Ctrl+K U', '全部关闭Ctrl+K W'])
  await act(async () => items[4]!.click())
  expect(document.querySelector('.dvw-tab-menu')).toBeNull()
  expect(document.body.textContent).not.toContain('二进制文件不能在文本编辑器中打开')
})

it('does not reopen a hidden workbench when restoring its saved view', async () => {
  const service = await setup()
  await act(async () => root!.unmount()); root = undefined
  service.hide()
  await mount(service, false)
  expect(service.getSnapshot().visible).toBe(false)
})

it('shows one binary file message instead of an overlapping editor error', async () => {
  await setup(true)
  expect(document.body.textContent).toContain('二进制文件不能在文本编辑器中打开')
  expect(document.querySelector('.dvw-error')).toBeNull()
  expect(document.querySelector('.dvw-message')?.textContent).toBe('二进制文件不能在文本编辑器中打开')
  const closeTab = document.querySelector<HTMLElement>('.dvw-tab-close')
  expect(closeTab).not.toBeNull()
  await act(async () => closeTab!.click())
  expect(document.body.textContent).not.toContain('二进制文件不能在文本编辑器中打开')
})
