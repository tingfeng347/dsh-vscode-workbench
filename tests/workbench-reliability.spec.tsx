// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Workbench } from '../src/client/Workbench.tsx'
import type { MonacoEditor } from '../src/client/MonacoEditor.tsx'
import { WorkbenchController } from '../src/client/service.ts'
import { disposeTypeScriptProject } from '../src/client/typescriptProject.ts'

type EditorProps = Parameters<typeof MonacoEditor>[0]
const state = vi.hoisted(() => {
  const models = new Map<string, { getValue(): string; isAttachedToEditor(): boolean; isDisposed(): boolean; dispose(): void }>()
  const defaults = { setCompilerOptions() {}, setEagerModelSync() {}, setDiagnosticsOptions() {} }
  const monaco = {
    editor: {
      getModel: (uri: { toString(): string }) => models.get(uri.toString()) ?? null,
      createModel: (content: string, _language: string | undefined, uri: { toString(): string }) => {
        let disposed = false
        const model = {
          getValue: () => content,
          isAttachedToEditor: () => false,
          isDisposed: () => disposed,
          dispose: () => { disposed = true; models.delete(uri.toString()) },
        }
        models.set(uri.toString(), model)
        return model
      },
      registerEditorOpener: () => ({ dispose() {} }),
    },
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    languages: {
      typescript: {
        ScriptTarget: { ESNext: 1 }, ModuleKind: { ESNext: 1 },
        ModuleResolutionKind: { NodeJs: 1 }, JsxEmit: { ReactJSX: 1 },
        typescriptDefaults: defaults, javascriptDefaults: defaults,
      },
    },
  }
  return { editor: undefined as EditorProps | undefined, models, monaco }
})
// Monaco and the DSH conversation are external rendering integrations. Exercise
// the workbench's real state and HTTP client with a controlled network boundary.
vi.mock('../src/client/MonacoEditor.tsx', () => ({
  MonacoEditor: (props: EditorProps) => { state.editor = props; return null },
  MonacoDiffEditor: () => null, preloadMonaco: () => {}, retainEditorModels: () => {},
  loadMonaco: () => Promise.resolve(state.monaco),
}))
vi.mock('../src/client/DshConversationPanel.tsx', () => ({ DshConversationPanel: () => null, DshConversationTheme: () => null, DshReviewActions: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let disk = 'disk'
let revision = 'r1'
let completeSave: (() => void) | undefined
let projectSource = 'export const a = 1'
let projectReads = 0
let reviewChanges: Array<{
  id: string
  seq: number
  path: string
  before: string | null
  after: string
  created: boolean
}> = []
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
  disposeTypeScriptProject(state.monaco as never)
  state.models.clear()
  vi.unstubAllGlobals(); localStorage.clear(); document.body.replaceChildren(); sockets.length = 0
  vi.useRealTimers()
})
async function mount(service = new WorkbenchController(), visible = true, dshPanelId?: string, handlers: { open?(panelId: string): void; restore?(): void } = {}) {
  if (visible) service.show()
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit" dshPanelId={dshPanelId} onOpenDshPanel={handlers.open} onRestoreConversation={handlers.restore}/>) })
  return service
}
async function setup(binary = false, saved: Record<string, unknown> = { paths: ['a.txt'], active: 'a.txt' }, changes: typeof reviewChanges = []) {
  disk = 'disk'; revision = 'r1'; completeSave = undefined; state.editor = undefined
  projectSource = 'export const a = 1'; projectReads = 0; reviewChanges = changes
  localStorage.setItem('dvw:/tmp/audit', JSON.stringify(saved))
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: { body: string }) => {
    const method = url.split('/').at(-1)
    const body = JSON.parse(options.body) as Record<string, unknown>
    const doc = () => ({ path: 'a.txt', content: binary ? '' : disk, revision, size: binary ? 0 : disk.length, binary, tooLarge: false })
    let value: unknown
    if (method === 'workspace') value = { cwd: '/tmp/audit', name: 'audit' }
    else if (method === 'fs.list') value = []
    else if (method === 'git.status') value = { changes: [] }
    else if (method === 'fs.read') value = doc()
    else if (method === 'project.sources') { projectReads++; value = { files: [{ path: 'a.ts', content: projectSource }], truncated: false } }
    else if (method === 'review.feed') value = { cursor: 9, changes: reviewChanges, busy: false }
    else if (method === 'review.inspect') value = {
      path: 'a.txt',
      revision,
      content: disk,
      changes: (body.ids as string[]).map(id => ({ id })),
    }
    else if (method === 'review.reject') value = {
      path: 'a.txt',
      deleted: false,
      rejectedIds: body.ids,
      document: doc(),
    }
    else if (method === 'fs.save') return new Promise(resolve => {
      const content = String(body.content)
      completeSave = () => { disk = content; revision = 'r2'; resolve({ ok: true, json: async () => ({ ok: true, value: doc() }) }) }
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

it('opens a DSH generated-file link at its requested line in the workbench editor', async () => {
  await setup()
  await act(async () => {
    window.dispatchEvent(new CustomEvent('dvw-open-generated-file', {
      detail: { sessionId: 's', path: 'a.txt', line: 2 },
    }))
  })
  expect(state.editor).toMatchObject({ value: 'disk', line: 2, focusOnReveal: true })
  expect(document.querySelector<HTMLElement>('.dvw-tab[data-active="true"]')?.textContent).toContain('a.txt')
})

it('follows a newly discovered AI change after the one and a half second idle delay', async () => {
  vi.useFakeTimers()
  localStorage.setItem('dvw:ai-review', 'on')
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [{
    id: '8:0',
    seq: 8,
    path: 'a.txt',
    before: 'old',
    after: 'disk',
    created: false,
  }])

  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(state.editor?.review?.changes).toHaveLength(1)
  expect(document.querySelector('.dvw-review-toolbar')).toBeNull()
  expect(state.editor?.line).toBeUndefined()
  await act(async () => { await vi.advanceTimersByTimeAsync(1499) })
  expect(state.editor?.line).toBeUndefined()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(state.editor).toMatchObject({ line: 1, focusOnReveal: false })
  expect(state.editor?.review?.activeId).toBe('8:0')
})

it('postpones AI follow while the user is typing or scrolling', async () => {
  vi.useFakeTimers()
  localStorage.setItem('dvw:ai-review', 'on')
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [{
    id: '8:0',
    seq: 8,
    path: 'a.txt',
    before: 'old',
    after: 'disk',
    created: false,
  }])
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(state.editor?.review?.changes).toHaveLength(1)

  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(1499) })
  expect(state.editor?.line).toBeUndefined()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(state.editor).toMatchObject({ line: 1, focusOnReveal: false })
})

it('uses the file review bar to accept or reject every block in the active file', async () => {
  localStorage.setItem('dvw:ai-review-mode', 'all')
  localStorage.setItem('dvw:ai-review-follow', 'off')
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [
    { id: '8:0', seq: 8, path: 'a.txt', before: 'old', after: 'disk', created: false },
    { id: '8:1', seq: 8, path: 'a.txt', before: 'before', after: 'tail', created: false },
  ])
  await vi.waitFor(() => expect(document.querySelector('.dvw-review-filebar')).not.toBeNull())
  const bar = document.querySelector('.dvw-review-filebar')!
  expect(bar.textContent).toContain('AI 改动 · 2 处')
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons.map(button => button.textContent)).toEqual(['接受', '拒绝'])
  expect(buttons[0]!.title).toContain('Ctrl+Enter')
  expect(buttons[1]!.title).toContain('Ctrl+Backspace')
  await act(async () => buttons[0]!.click())
  expect(document.querySelector('.dvw-review-filebar')).toBeNull()
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
  expect(document.body.textContent).not.toContain('二进制文件无法在文本编辑器或差异视图中打开')
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
  expect(document.body.textContent).toContain('二进制文件无法在文本编辑器或差异视图中打开')
  expect(document.querySelector('.dvw-error')).toBeNull()
  expect(document.querySelector('.dvw-message')?.textContent).toBe('二进制文件无法在文本编辑器或差异视图中打开')
  const closeTab = document.querySelector<HTMLElement>('.dvw-tab-close')
  expect(closeTab).not.toBeNull()
  await act(async () => closeTab!.click())
  expect(document.body.textContent).not.toContain('二进制文件无法在文本编辑器或差异视图中打开')
})

it('keeps the official DSH tab open when switching to a file and back', async () => {
  const service = await setup()
  await act(async () => { root!.unmount() }); root = undefined
  const panel = document.createElement('div')
  panel.id = 'plugins'
  panel.setAttribute('data-global-panel', '')
  document.body.append(panel)
  await mount(service, true, 'plugins')
  const dshTab = () => document.querySelector<HTMLButtonElement>('[data-dvw-dsh-tab]')
  expect(dshTab()?.dataset.active).toBe('true')
  expect(panel.hasAttribute('data-dvw-dsh-hidden')).toBe(false)
  await act(async () => document.querySelector<HTMLButtonElement>('.dvw-tab:not([data-dvw-dsh-tab])')!.click())
  expect(dshTab()).not.toBeNull()
  expect(dshTab()?.dataset.active).toBe('false')
  expect(document.querySelector<HTMLButtonElement>('.dvw-tab:not([data-dvw-dsh-tab])')?.dataset.active).toBe('true')
  expect(panel.hasAttribute('data-dvw-dsh-hidden')).toBe(true)
  await act(async () => dshTab()!.click())
  expect(dshTab()?.dataset.active).toBe('true')
  expect(document.querySelector<HTMLButtonElement>('.dvw-tab:not([data-dvw-dsh-tab])')?.dataset.active).toBe('false')
  expect(panel.hasAttribute('data-dvw-dsh-hidden')).toBe(false)
})

it('hands the centre back to the conversation and reopens the panel from its tab', async () => {
  const service = await setup()
  await act(async () => { root!.unmount() }); root = undefined
  const panel = document.createElement('div')
  panel.id = 'plugins'
  panel.setAttribute('data-global-panel', '')
  document.body.append(panel)
  const restore = vi.fn()
  const open = vi.fn()
  await mount(service, true, 'plugins', { restore, open })
  const dshTab = () => document.querySelector<HTMLButtonElement>('[data-dvw-dsh-tab]')
  const fileTab = () => document.querySelector<HTMLButtonElement>('.dvw-tab:not([data-dvw-dsh-tab])')
  expect(restore).not.toHaveBeenCalled()
  // DSH unmounts its conversation while a global panel is selected, so showing a
  // file must deselect the panel or the right column stays blank.
  await act(async () => fileTab()!.click())
  expect(restore).toHaveBeenCalledTimes(1)
  // The host drops the panel from the centre; the workbench keeps it as a tab.
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit" onOpenDshPanel={open} onRestoreConversation={restore}/>) })
  expect(dshTab()).not.toBeNull()
  expect(dshTab()?.dataset.active).toBe('false')
  expect(fileTab()?.dataset.active).toBe('true')
  await act(async () => dshTab()!.click())
  expect(open).toHaveBeenCalledWith('plugins')
  expect(dshTab()?.dataset.active).toBe('true')
  expect(fileTab()?.dataset.active).toBe('false')
})

it('does not bounce the centre back to a DSH panel after the user leaves it', async () => {
  const service = await setup()
  await act(async () => { root!.unmount() }); root = undefined
  const panel = document.createElement('div')
  panel.id = 'plugins'
  panel.setAttribute('data-global-panel', '')
  document.body.append(panel)
  const open = vi.fn()
  await mount(service, true, 'plugins', { open })
  expect(open).not.toHaveBeenCalled()
  // DSH's own navigation (for example clicking the conversation) clears the
  // global panel. Reopening it here is what trapped users on the plugin page.
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit" onOpenDshPanel={open}/>) })
  expect(open).not.toHaveBeenCalled()
  expect(document.querySelector('[data-dvw-dsh-tab]')).toBeNull()
})

it('returns to the conversation from the DSH chat button while a panel is open', async () => {
  const service = await setup()
  await act(async () => { root!.unmount() }); root = undefined
  const panel = document.createElement('div')
  panel.id = 'plugins'
  panel.setAttribute('data-global-panel', '')
  document.body.append(panel)
  const restore = vi.fn()
  await mount(service, true, 'plugins', { restore })
  expect(document.querySelector('.dvw-chat')).toBeNull()
  const chat = document.querySelector<HTMLButtonElement>('[data-act-id="chat"]')
  expect(chat?.title).toBe('返回 DSH 对话 (Ctrl+Alt+B)')
  await act(async () => chat!.click())
  expect(restore).toHaveBeenCalledTimes(1)
  expect(document.querySelector<HTMLElement>('[data-dvw-dsh-tab]')?.dataset.active).toBe('false')
  expect(document.querySelector('.dvw-chat')).not.toBeNull()
})


it('refreshes each visible directory once per refresh click', async () => {
  await setup()
  vi.mocked(fetch).mockClear()
  await act(async () => document.querySelector<HTMLButtonElement>('button[title="刷新"]')!.click())
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/fs.list'))).toHaveLength(1)
})

it('does not read restored documents while hidden', async () => {
  const service = await setup()
  await act(async () => root!.unmount()); root = undefined
  service.hide()
  vi.mocked(fetch).mockClear()
  await mount(service, false)
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/fs.read'))).toHaveLength(0)
})

it('loads the active document in every visible pane', async () => {
  await setup(false, {
    groups: [
      { id: 'pane-1', paths: ['a.txt'], active: 'a.txt' },
      { id: 'pane-2', paths: ['b.txt'], active: 'b.txt' },
    ],
    layout: {
      kind: 'split', id: 'split-1', direction: 'horizontal', ratio: 0.5,
      first: { kind: 'leaf', group: 'pane-1' }, second: { kind: 'leaf', group: 'pane-2' },
    },
  })
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/fs.read'))).toHaveLength(2)
  expect(document.body.textContent).not.toContain('正在加载文件')
})

it('keeps concurrent reads of the same file scoped to each pane', async () => {
  await setup(false, {
    groups: [
      { id: 'pane-1', paths: ['a.txt'], active: 'a.txt' },
      { id: 'pane-2', paths: ['a.txt'], active: 'a.txt' },
    ],
    layout: {
      kind: 'split', id: 'split-1', direction: 'horizontal', ratio: 0.5,
      first: { kind: 'leaf', group: 'pane-1' }, second: { kind: 'leaf', group: 'pane-2' },
    },
  })
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/fs.read'))).toHaveLength(2)
  expect(document.body.textContent).not.toContain('正在加载文件')
})

it('reindexes retained TypeScript models after returning from hidden', async () => {
  localStorage.setItem('dvw:lsp:typescript', 'on')
  const service = await setup()
  const model = () => state.models.get('file:///tmp/audit/a.ts')
  expect(projectReads).toBe(1)
  expect(model()).toBeDefined()

  projectSource = 'export const a = 2'
  await act(async () => service.hide())
  await act(async () => service.show())

  expect(projectReads).toBe(2)
  expect(model()?.getValue()).toBe('export const a = 2')
})
