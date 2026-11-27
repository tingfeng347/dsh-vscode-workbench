// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Workbench } from '../../src/client/workbench/Workbench.tsx'
import type { MonacoDiffEditor, MonacoEditor } from '../../src/client/editor/MonacoEditor.tsx'
import { settingsHost } from '../../src/client/settings/settingsHost.ts'
import { WorkbenchController } from '../../src/client/workbench/service.ts'
import { disposeTypeScriptProject } from '../../src/client/editor/typescriptProject.ts'
import type { FileEntry, GitChange } from '../../src/shared/types.ts'
import type { DshConversationMenus } from '../../src/client/dsh/DshConversationPanel.tsx'

type EditorProps = Parameters<typeof MonacoEditor>[0]
type DiffProps = Parameters<typeof MonacoDiffEditor>[0]
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
  return { editor: undefined as EditorProps | undefined, models, monaco, diff: undefined as DiffProps | undefined }
})
// Monaco and the DSH conversation are external rendering integrations. Exercise
// the workbench's real state and HTTP client with a controlled network boundary.
vi.mock('../../src/client/editor/MonacoEditor.tsx', () => ({
  MonacoEditor: (props: EditorProps) => { state.editor = props; return null },
  MonacoDiffEditor: (props: DiffProps) => { state.diff = props; return props.viewControls }, preloadMonaco: () => {}, retainEditorModels: () => {},
  isMacPlatform: () => false,
  loadMonaco: () => Promise.resolve(state.monaco),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let conversationMenu: Parameters<DshConversationMenus['register']>[0] | undefined
const conversationMenus: DshConversationMenus = { register: value => { conversationMenu = value; return () => { conversationMenu = undefined } } }
async function openConversation() {
  await act(async () => conversationMenu!.resolve({ sessionId: 's' })[0]!.run())
}
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
class FakeSocket extends EventTarget {
  static OPEN = 1
  constructor() { super(); sockets.push(this) }
  close() {}
  change(paths: string[]) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ paths }) })) }
}
afterEach(async () => {
  await act(async () => { root?.unmount() }); root = undefined
  settingsHost.set(undefined)
  state.diff = undefined
  disposeTypeScriptProject(state.monaco as never)
  state.models.clear()
  vi.unstubAllGlobals(); localStorage.clear(); document.body.replaceChildren(); sockets.length = 0
  vi.useRealTimers()
})
async function mount(service = new WorkbenchController(), visible = true, dshPanelId?: string, handlers: { open?(panelId: string): void; restore?(): void } = {}) {
  if (visible) service.show()
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit" conversationMenus={conversationMenus} dshPanelId={dshPanelId} onOpenDshPanel={handlers.open} onRestoreConversation={handlers.restore}/>) })
  return service
}
type FakeModelCatalog = {
  models: Array<{ provider: string; model: string; id: string; name: string; providerName: string; badge?: { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' } }>
  unavailable: Array<{ provider: string; providerName: string; message: string }>
  defaultModel?: { provider: string; model: string }
}
const defaultModelCatalog: FakeModelCatalog = {
  models: [
    { provider: 'deepseek-official', model: 'deepseek-pro', id: 'deepseek-pro', name: 'DeepSeek-V4-Pro', providerName: 'DeepSeek' },
    { provider: 'deepseek-official', model: 'deepseek-flash', id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', providerName: 'DeepSeek', badge: { text: '1017', tone: 'info' } },
  ],
  unavailable: [],
  defaultModel: { provider: 'deepseek-official', model: 'deepseek-flash' },
}
async function setup(
  binary = false,
  saved: Record<string, unknown> = { paths: ['a.txt'], active: 'a.txt' },
  changes: typeof reviewChanges = [],
  gitChanges: GitChange[] = [],
  modelCatalog: FakeModelCatalog = defaultModelCatalog,
  files: FileEntry[] = [],
  readFailure?: (path: string) => { code: string; message: string; status?: number } | undefined,
) {
  disk = 'disk'; revision = 'r1'; completeSave = undefined; state.editor = undefined
  projectSource = 'export const a = 1'; projectReads = 0; reviewChanges = changes
  localStorage.setItem('dvw:/tmp/audit', JSON.stringify(saved))
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: { body: string }) => {
    const method = url.split('/').at(-1)
    const body = JSON.parse(options.body) as Record<string, unknown>
    const doc = () => ({ path: typeof body.path === 'string' ? body.path : 'a.txt', content: binary ? '' : disk, revision, size: binary ? 0 : disk.length, binary, tooLarge: false })
    let value: unknown
    if (method === 'workspace') value = { cwd: '/tmp/audit', name: 'audit' }
    else if (method === 'fs.list') value = files
    else if (method === 'lsp.status' || method === 'ssh.connections') value = []
    else if (method === 'ssh.hosts') value = { hosts: [] }
    else if (method === 'git.status') value = { repository: '/tmp/audit', branch: 'master', ahead: 0, behind: 0, changes: gitChanges }
    else if (method === 'git.action' && body.action === 'diff') value = { diff: '', original: 'before', modified: 'after' }
    else if (method === 'git.action') value = body.action === 'log' ? [] : { repository: '/tmp/audit', branch: 'master', ahead: 0, behind: 0, changes: gitChanges }
    else if (method === 'commit.models') value = modelCatalog
    else if (method === 'git.commitMessage') value = { message: 'feat(git): generate the message directly' }
    else if (method === 'fs.read') {
      const path = typeof body.path === 'string' ? body.path : 'a.txt'
      const failure = readFailure?.(path)
      if (failure !== undefined) {
        return Response.json({
          ok: false,
          error: { code: failure.code, message: failure.message },
        }, { status: failure.status ?? 409 })
      }
      value = doc()
    }
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

function residentConversation() {
  const surface = document.createElement('section')
  surface.dataset.phase = 'active'
  surface.innerHTML = '<header>Greeting</header><div data-conversation-scroll>Existing reply</div><textarea>message draft</textarea>'
  document.body.prepend(surface)
  return surface
}

function dragData() {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none', dropEffect: 'none',
    get types() { return [...values.keys()] },
    setData(type: string, value: string) { values.set(type, value) },
    getData(type: string) { return values.get(type) ?? '' },
  }
}

async function dragTo(source: Element, target: Element, x = 300, y = 200, shared?: ReturnType<typeof dragData>) {
  const dataTransfer = dragData()
  const send = async (element: Element, type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperty(event, 'dataTransfer', { value: shared ?? dataTransfer })
    await act(async () => { element.dispatchEvent(event) })
    return event
  }
  await send(source, 'dragstart')
  const over = await send(target, 'dragover')
  const drop = await send(target, 'drop')
  await send(source, 'dragend')
  return { over, drop }
}

function layoutPane(pane: Element) {
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
}

it('opens the workspace switcher from an empty editor instead of a browser', async () => {
  await setup(false, { paths: [] })
  const actions = document.querySelector('.dvw-start-tools')!
  const buttons = [...actions.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons.map(button => button.textContent)).toEqual(['新建终端', '打开工作区'])
  await act(async () => buttons.find(button => button.textContent === '打开工作区')!.click())
  expect(document.querySelector('[role="dialog"][aria-label="打开工作区"]')).not.toBeNull()
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.querySelector('[role="dialog"][aria-label="打开工作区"]')).toBeNull()
})

it('closes only the selected empty editor group and preserves conversation and file drafts', async () => {
  residentConversation()
  await setup(false, {
    groups: [{ id: 'pane-1', paths: ['a.txt'], active: 'a.txt' }, { id: 'pane-2', paths: [] }, { id: 'pane-3', paths: [] }],
    focused: 'pane-1',
    layout: {
      kind: 'split', id: 's1', direction: 'row', ratio: 0.5, first: { kind: 'leaf', group: 'pane-1' },
      second: { kind: 'split', id: 's2', direction: 'column', ratio: 0.5, first: { kind: 'leaf', group: 'pane-2' }, second: { kind: 'leaf', group: 'pane-3' } },
    },
  })
  await act(async () => state.editor!.onChange('unsaved file draft'))
  await openConversation()
  const closeEmpty = (id: string) => document.querySelector<HTMLButtonElement>(`.dvw-pane[data-group="${id}"] button[title="关闭当前空白编辑组"]`)!
  await act(async () => closeEmpty('pane-2').click())
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(2)
  expect(document.querySelector('.dvw-pane[data-group="pane-2"]')).toBeNull()
  expect(document.querySelector('.dvw-pane[data-focused]')?.getAttribute('data-group')).toBe('pane-1')
  expect(document.querySelector('[data-dvw-conversation-tab]')).not.toBeNull()
  await act(async () => closeEmpty('pane-3').click())
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(1)
  expect(document.querySelector('[data-tab-path="a.txt"]')).not.toBeNull()
  expect(document.querySelector('[data-dvw-conversation-tab]')).not.toBeNull()
  expect(document.querySelectorAll('.dvw-split')).toHaveLength(0)
  await act(async () => document.querySelector<HTMLButtonElement>('[data-tab-path="a.txt"]')!.click())
  expect(state.editor!.value).toBe('unsaved file draft')
})

it('opens the official conversation from its More menu and returns it without dragging or losing drafts', async () => {
  const surface = residentConversation()
  const composer = surface.querySelector('textarea')!
  const parent = surface.parentElement
  const original = surface.innerHTML
  const service = await setup()
  const sidebarMarkup = surface.innerHTML
  await act(async () => state.editor!.onChange('unsaved file'))
  type Contribution = {
    target: 'sessionHeader'
    resolve(target: { sessionId: string }): readonly { label: string; run?(): void }[]
  }
  let contribution: Contribution | undefined
  const unregister = vi.fn()
  const menus = { register: vi.fn((value: Contribution) => { contribution = value; return unregister }) }
  await act(async () => root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit" conversationMenus={menus}/>))
  expect(contribution?.target).toBe('sessionHeader')
  expect(contribution!.resolve({ sessionId: 'other' })).toEqual([])
  const action = contribution!.resolve({ sessionId: 's' })[0]!
  expect(action.label).toBe('在编辑区打开对话')
  await act(async () => action.run!())
  expect(document.querySelectorAll('[data-dvw-conversation-tab]')).toHaveLength(1)
  expect(surface.dataset.dvwConversationPanel).toBe('editor')
  expect(surface.parentElement).toBe(parent)
  expect(surface.querySelector('textarea')).toBe(composer)
  expect(surface.innerHTML).toBe(original)
  expect(composer.value).toBe('message draft')
  await act(async () => document.querySelector<HTMLButtonElement>('[data-tab-path="a.txt"]')!.click())
  expect(state.editor!.value).toBe('unsaved file')
  await act(async () => document.querySelector<HTMLButtonElement>('[data-dvw-conversation-tab]')!.click())
  const back = contribution!.resolve({ sessionId: 's' })[0]!
  expect(back.label).toBe('移回侧栏')
  await act(async () => back.run!())
  expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
  expect(document.querySelector('.dvw-chat')).not.toBeNull()
  expect(surface.innerHTML).toBe(sidebarMarkup)
  expect(composer.value).toBe('message draft')
  expect(menus.register).toHaveBeenCalledTimes(1)
  await act(async () => service.hide())
  expect(unregister).toHaveBeenCalledTimes(1)
  expect(surface.innerHTML).toBe(original)
})

it('docks through the menu and leaves the official title row non-draggable', async () => {
  const surface = residentConversation()
  const composer = surface.querySelector('textarea')!
  const parent = surface.parentElement
  await setup()
  await act(async () => state.editor!.onChange('unsaved file'))
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  expect(surface.querySelector('header')!.hasAttribute('draggable')).toBe(false)
  expect(document.querySelector('[data-dvw-conversation-grip]')).toBeNull()
  await openConversation()
  expect(surface.querySelector('.dvw-conversation-dock-host')).toBeNull()
  expect(document.querySelector('.dvw-conversation-editor-toolbar')).toBeNull()
  const tab = document.querySelector<HTMLButtonElement>('[data-dvw-conversation-tab]')!
  expect(tab.dataset.active).toBe('true')
  expect(document.querySelector('.dvw-chat')).toBeNull()
  expect(surface.dataset.dvwConversationPanel).toBe('editor')
  expect(surface.parentElement).toBe(parent)
  expect(surface.querySelector('textarea')).toBe(composer)
  expect(composer.value).toBe('message draft')
  await act(async () => document.querySelector<HTMLButtonElement>('[data-tab-path="a.txt"]')!.click())
  expect(tab.dataset.active).toBe('false')
  expect(surface.hasAttribute('data-dvw-conversation-panel')).toBe(false)
  expect(state.editor!.value).toBe('unsaved file')
  await act(async () => tab.click())
  expect(surface.dataset.dvwConversationPanel).toBe('editor')
  await act(async () => tab.querySelector<HTMLElement>('.dvw-tab-close')!.click())
  expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
  expect(document.querySelector('.dvw-chat')).toBeNull()
  expect(surface.hasAttribute('data-dvw-conversation-panel')).toBe(false)
  expect(composer.value).toBe('message draft')
})

it('accepts a conversation drag into the middle and reorders it on the tab strip without splitting', async () => {
  residentConversation()
  await setup()
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  await openConversation()
  const { over, drop } = await dragTo(document.querySelector('[data-dvw-conversation-tab]')!, pane)
  expect(over.defaultPrevented).toBe(true)
  expect(drop.defaultPrevented).toBe(true)
  expect(document.querySelectorAll('[data-dvw-conversation-tab]')).toHaveLength(1)
  const file = document.querySelector<HTMLElement>('[data-tab-path]')!
  vi.spyOn(file, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 100, 35))
  await dragTo(document.querySelector('[data-dvw-conversation-tab]')!, pane.querySelector('.dvw-tabs')!, 200, 5)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(1)
  expect(pane.querySelector('.dvw-tab-list')!.lastElementChild).toBe(document.querySelector('[data-dvw-conversation-tab]'))
  expect(document.body.hasAttribute('data-dvw-editor-dragging')).toBe(false)
})

it('splits a conversation from the editor edge and collapses its empty group when closed', async () => {
  const surface = residentConversation()
  await setup()
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  await openConversation()
  await dragTo(document.querySelector('[data-dvw-conversation-tab]')!, pane, 595, 200)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(2)
  const conversationPane = document.querySelector('[data-dvw-conversation-tab]')!.closest('.dvw-pane')!
  expect(conversationPane).not.toBe(pane)
  expect(pane.querySelector('[data-tab-path="a.txt"]')).not.toBeNull()
  expect(surface.dataset.dvwConversationPanel).toBe('editor')
  await act(async () => conversationPane.querySelector<HTMLElement>('.dvw-tab-close')!.click())
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(1)
  expect(document.querySelector('[data-tab-path="a.txt"]')).not.toBeNull()
  expect(document.querySelector('.dvw-chat')).toBeNull()
})

it('closes the editor conversation tab without reopening the sidebar conversation', async () => {
  residentConversation()
  await setup()
  await openConversation()
  const tab = document.querySelector<HTMLButtonElement>('[data-dvw-conversation-tab]')!
  await act(async () => conversationMenu!.resolve({ sessionId: 's' })[1]!.run())
  expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
  expect(document.querySelector('.dvw-chat')).toBeNull()
  expect(document.querySelector('[data-dvw-conversation-panel]')).toBeNull()
  await act(async () => conversationMenu!.resolve({ sessionId: 's' })[0]!.run())
  await act(async () => document.querySelector<HTMLElement>('[data-dvw-conversation-tab] .dvw-tab-close')!.click())
  expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
  expect(document.querySelector('.dvw-chat')).toBeNull()
  await openConversation()
  await act(async () => document.querySelector<HTMLButtonElement>('[data-dvw-conversation-tab]')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })))
  expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
  expect(document.querySelector('.dvw-chat')).toBeNull()
  await act(async () => conversationMenu!.resolve({ sessionId: 's' })[0]!.run())
  expect(document.querySelector('[data-dvw-conversation-tab]')).not.toBeNull()
})

it('keeps files and their editor group when the conversation tab closes', async () => {
  residentConversation()
  await setup()
  await openConversation()
  await act(async () => document.querySelector<HTMLElement>('[data-dvw-conversation-tab] .dvw-tab-close')!.click())
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(1)
  expect(document.querySelector('[data-tab-path="a.txt"]')).not.toBeNull()
  expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
  expect(document.querySelector('.dvw-chat')).toBeNull()
})

it('keeps quarter and bottom-half hit testing when the official layer stops drag events', async () => {
  residentConversation()
  await setup()
  await openConversation()
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  const dataTransfer = dragData()
  const send = async (target: Element, type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    await act(async () => { target.dispatchEvent(event) })
    return event
  }
  const tab = document.querySelector('[data-dvw-conversation-tab]')!
  await send(tab, 'dragstart', 300, 20)
  const blocker = document.createElement('div')
  blocker.id = 'official-overlay'
  blocker.style.cssText = 'position:fixed;inset:0;z-index:1000'
  blocker.addEventListener('dragover', event => { event.stopImmediatePropagation(); event.preventDefault() }, true)
  blocker.addEventListener('drop', event => { event.stopImmediatePropagation(); event.preventDefault() }, true)
  document.body.append(blocker)
  // React sees the synthetic capture through the overlay's coordinates even though its target is
  // outside the pane. The bottom half must preview before release.
  const bottom = await send(blocker, 'dragover', 300, 390)
  expect(bottom.defaultPrevented).toBe(true)
  await act(async () => {})
  expect(document.querySelector('.dvw-pane-drop')?.getAttribute('data-direction')).toBe('column')
  expect(document.querySelector('.dvw-pane-drop')?.getAttribute('data-position')).toBe('second')
  const dropped = await send(blocker, 'drop', 300, 390)
  expect(dropped.defaultPrevented).toBe(true)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(2)
  const conversationPane = document.querySelector('[data-dvw-conversation-tab]')!.closest('.dvw-pane')!
  expect(conversationPane.closest('.dvw-split')?.getAttribute('data-direction')).toBe('column')
  expect(conversationPane.parentElement).toBe(conversationPane.closest('.dvw-split')?.lastElementChild)
  blocker.remove()
})

it.each([
  { x: 300, direction: 'column', position: 'second', vertical: null, panes: 2 },
  { x: 20, direction: 'row', position: 'first', vertical: 'second', panes: 3 },
  { x: 580, direction: 'row', position: 'second', vertical: 'second', panes: 3 },
])('previews and drops into the lower file region when the host claims native drag events: $x', async ({ x, direction, position, vertical, panes }) => {
  const hostCapture = (event: Event) => {
    if ((event as MouseEvent).clientY < 200) return
    event.preventDefault()
    // The host can stop propagation before React's root capture listener runs.
    event.stopPropagation()
  }
  document.addEventListener('dragover', hostCapture, true)
  document.addEventListener('drop', hostCapture, true)
  try {
    await setup()
    const pane = document.querySelector('.dvw-pane')!
    layoutPane(pane)
    const dataTransfer = dragData()
    const tab = pane.querySelector('[data-tab-path]')!
    const body = pane.querySelector('.dvw-editor-body')!
    const send = async (target: Element, type: string, y: number, clientX = x) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: y })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      await act(async () => { target.dispatchEvent(event) })
    }
    await send(tab, 'dragstart', 20)
    await send(body, 'dragover', 40, 300)
    expect(document.querySelector('.dvw-pane-drop')?.getAttribute('data-position')).toBe('first')
    await send(body, 'dragover', 380)
    const preview = document.querySelector('.dvw-pane-drop')
    expect(preview?.getAttribute('data-direction')).toBe(direction)
    expect(preview?.getAttribute('data-position')).toBe(position)
    expect(preview?.getAttribute('data-vertical')).toBe(vertical)
    await send(body, 'drop', 380)
    expect(document.querySelectorAll('.dvw-pane')).toHaveLength(panes)
    expect(document.querySelector('.dvw-pane-drop')).toBeNull()
    await send(tab, 'dragend', 380)
  } finally {
    document.removeEventListener('dragover', hostCapture, true)
    document.removeEventListener('drop', hostCapture, true)
  }
})

it('keeps a conversation group when its last file closes or moves away', async () => {
  residentConversation()
  await setup(false, {
    groups: [{ id: 'pane-1', paths: ['a.txt'], active: 'a.txt' }, { id: 'pane-2', paths: ['b.txt'], active: 'b.txt' }],
    focused: 'pane-1',
    layout: { kind: 'split', id: 's1', direction: 'row', ratio: 0.5, first: { kind: 'leaf', group: 'pane-1' }, second: { kind: 'leaf', group: 'pane-2' } },
  })
  await openConversation()
  const first = document.querySelector('.dvw-pane[data-group="pane-1"]')!
  const second = document.querySelector('.dvw-pane[data-group="pane-2"]')!
  vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 400))
  vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 0, 300, 400))
  // Moving a file out of a conversation group must retain the conversation's leaf.
  await dragTo(first.querySelector('[data-tab-path="a.txt"]')!, second.querySelector('.dvw-tabs')!, 450, 10)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(2)
  expect(first.querySelector('[data-dvw-conversation-tab]')).not.toBeNull()
  expect(first.querySelector('[data-tab-path]')).toBeNull()
  // Move it back and close it while it is active.
  await dragTo(second.querySelector('[data-tab-path="a.txt"]')!, first.querySelector('.dvw-tabs')!, 150, 10)
  await act(async () => first.querySelector<HTMLElement>('[data-tab-path="a.txt"] .dvw-tab-close')!.click())
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(2)
  expect(first.querySelector<HTMLElement>('[data-dvw-conversation-tab]')!.dataset.active).toBe('true')
  expect(first.querySelector('.dvw-tabs')!.hasAttribute('data-empty')).toBe(false)
})

it('moves the one conversation tab between groups and clears it on a session change', async () => {
  residentConversation()
  const service = await setup()
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  await openConversation()
  await dragTo(document.querySelector('[data-dvw-conversation-tab]')!, pane, 595, 200)
  const target = document.querySelector('.dvw-pane[data-group="pane-1"]')!
  layoutPane(target)
  await dragTo(document.querySelector('[data-dvw-conversation-tab]')!, target, 300, 200)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(1)
  expect(document.querySelectorAll('[data-dvw-conversation-tab]')).toHaveLength(1)
  await act(async () => root!.render(<Workbench service={service} sessionId="other" cwd="/tmp/audit"/>))
  expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
  expect(document.querySelector('.dvw-chat')).not.toBeNull()
})

it.each(['关闭已保存', '全部关闭'])('keeps the conversation reachable after the file menu action %s', async action => {
  residentConversation()
  await setup()
  await openConversation()
  const file = document.querySelector<HTMLButtonElement>('[data-tab-path="a.txt"]')!
  await act(async () => {
    file.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
  const button = [...document.querySelectorAll<HTMLButtonElement>('.dvw-tab-menu button')].find(button => button.textContent?.startsWith(action))!
  await act(async () => button.click())
  expect(document.querySelector('[data-tab-path]')).toBeNull()
  if (action === '全部关闭') {
    expect(document.querySelector('[data-dvw-conversation-tab]')).toBeNull()
    expect(document.querySelector('.dvw-chat')).not.toBeNull()
  } else {
    expect(document.querySelector<HTMLElement>('[data-dvw-conversation-tab]')?.dataset.active).toBe('true')
    expect(document.querySelector('[data-dvw-conversation-panel=editor]')).not.toBeNull()
  }
})

it('clears the editor drop preview and restores conversation hit testing after a cancelled drag', async () => {
  residentConversation()
  await setup()
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  await openConversation()
  const dataTransfer = dragData()
  const send = (target: Element, type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 595, clientY: 200 })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    target.dispatchEvent(event)
  }
  await act(async () => send(document.querySelector('[data-dvw-conversation-tab]')!, 'dragstart'))
  await act(async () => send(pane, 'dragover'))
  expect(document.body.hasAttribute('data-dvw-editor-dragging')).toBe(true)
  expect(document.querySelector('.dvw-pane-drop')).not.toBeNull()
  await act(async () => window.dispatchEvent(new Event('dragend')))
  expect(document.body.hasAttribute('data-dvw-editor-dragging')).toBe(false)
  expect(document.querySelector('.dvw-pane-drop')).toBeNull()
  expect(document.querySelector('[data-dvw-conversation-tab]')).not.toBeNull()
})

it.each([
  [10, 60, 'first', 'first'], [590, 60, 'second', 'first'],
  [10, 390, 'first', 'second'], [590, 390, 'second', 'second'],
] as const)('drops conversation and file tabs into the quarter at %s/%s', async (x, y, horizontal, vertical) => {
  const surface = residentConversation()
  await setup()
  await openConversation()
  const original = document.querySelector('.dvw-pane')!
  layoutPane(original)
  await dragTo(document.querySelector('[data-dvw-conversation-tab]')!, original, x, y)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(3)
  const conversationPane = document.querySelector('[data-dvw-conversation-tab]')!.closest('.dvw-pane')!
  const column = conversationPane.closest('.dvw-split')!
  expect(column.getAttribute('data-direction')).toBe('column')
  const half = column.closest('.dvw-slot')!
  expect(half.parentElement?.getAttribute('data-direction')).toBe('row')
  expect((horizontal === 'first' ? half.parentElement?.firstElementChild : half.parentElement?.lastElementChild)).toBe(half)
  expect((vertical === 'first' ? column.firstElementChild : column.lastElementChild)).toBe(conversationPane.parentElement)
  expect(surface.querySelector('textarea')!.value).toBe('message draft')
  // The unused quarter is a usable target, rather than a duplicate file or conversation.
  const empty = [...document.querySelectorAll('.dvw-pane')].find(pane => pane.getAttribute('data-group') !== 'pane-1' && pane !== conversationPane)!
  const emptyId = empty.getAttribute('data-group')
  layoutPane(empty)
  await dragTo(document.querySelector('[data-tab-path="a.txt"]')!, empty, 300, 200)
  expect(document.querySelector(`.dvw-pane[data-group="${emptyId}"] [data-tab-path="a.txt"]`)).not.toBeNull()
  expect(document.querySelectorAll('[data-dvw-conversation-tab]')).toHaveLength(1)
})

it.each(['tab', 'tree'] as const)('supports a quarter split for a file dragged from the %s', async source => {
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [], [], defaultModelCatalog, [{ name: 'b.txt', path: 'b.txt', kind: 'file' }])
  await act(async () => state.editor!.onChange('unsaved quarter draft'))
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  const drag = source === 'tab' ? document.querySelector('[data-tab-path="a.txt"]')! : document.querySelector('[data-tree-path="b.txt"]')!
  await dragTo(drag, pane, 590, 390)
  if (source === 'tree') await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(3)
  const path = source === 'tab' ? 'a.txt' : 'b.txt'
  const target = document.querySelector(`[data-tab-path="${path}"]`)!.closest('.dvw-pane')!
  expect(target.closest('.dvw-split')?.getAttribute('data-direction')).toBe('column')
  expect(target.parentElement).toBe(target.closest('.dvw-split')?.lastElementChild)
  if (source === 'tab') expect(state.editor!.value).toBe('unsaved quarter draft')
})

it('refuses a quarter that would exceed the six-pane cap while retaining center drops', async () => {
  await setup(false, { paths: ['a.txt', 'b.txt'], active: 'a.txt' })
  const pane = document.querySelector('.dvw-pane')!
  layoutPane(pane)
  await dragTo(document.querySelector('[data-tab-path="a.txt"]')!, pane, 590, 390)
  const target = document.querySelector('[data-tab-path="a.txt"]')!.closest('.dvw-pane')!
  layoutPane(target)
  await dragTo(document.querySelector('[data-tab-path="a.txt"]')!, target, 590, 390)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(5)
  const latest = document.querySelector('[data-tab-path="a.txt"]')!.closest('.dvw-pane')!
  layoutPane(latest)
  await dragTo(document.querySelector('[data-tab-path="a.txt"]')!, latest, 590, 390)
  expect(document.querySelectorAll('.dvw-pane')).toHaveLength(5)
  await dragTo(document.querySelector('[data-tab-path="b.txt"]')!, latest, 300, 200)
  expect(document.querySelectorAll('.dvw-pane').length).toBeLessThanOrEqual(5)
})

it('opens a DSH generated-file link at its requested line in the workbench editor', async () => {
  await setup()
  await act(async () => {
    window.dispatchEvent(new CustomEvent('dvw-open-generated-file', {
      detail: { sessionId: 's', path: 'a.txt', line: 2, endLine: 3 },
    }))
  })
  expect(state.editor).toMatchObject({ value: 'disk', line: 2, endLine: 3, focusOnReveal: true })
  expect(document.querySelector<HTMLElement>('.dvw-tab[data-active="true"]')?.textContent).toContain('a.txt')
})

it('closes stale remote tabs instead of surfacing a disconnected SSH error', async () => {
  const stale = 'ssh://dead/root/stale.txt'
  const live = 'ssh://live/root/live.txt'
  await setup(
    false,
    { paths: [stale, live], active: stale },
    [],
    [],
    defaultModelCatalog,
    [],
    path => path === stale
      ? { code: 'ssh-disconnected', message: 'SSH 连接已断开，请重新连接' }
      : undefined,
  )

  await vi.waitFor(() => {
    expect(document.querySelector(`[data-tab-path="${stale}"]`)).toBeNull()
  })
  expect(document.querySelector(`[data-tab-path="${live}"]`)).not.toBeNull()
  expect(document.querySelector('.dvw-error')).toBeNull()
  expect(document.body.textContent).not.toContain('SSH 连接已断开')
})

it('renders SSH images through the remote file preview route', async () => {
  const image = 'ssh://live/images/orchard.jpg'
  await setup(false, { paths: [image], active: image })

  const preview = await vi.waitFor(() => {
    const value = document.querySelector<HTMLImageElement>('.dvw-image-preview img')
    expect(value).not.toBeNull()
    return value!
  })
  expect(preview.src).toContain('/dsh-vscode/ssh/file?')
  expect(preview.src).toContain('connectionId=live')
  expect(preview.src).toContain(`path=${encodeURIComponent('images/orchard.jpg')}`)
  expect(state.editor).toBeUndefined()
  expect(document.body.textContent).not.toContain('该格式文件暂时无法预览')
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

it('opens the DSH conversation with a file reference when asking from a change block', async () => {
  localStorage.setItem('dvw:ai-review-mode', 'all')
  localStorage.setItem('dvw:ai-review-follow', 'off')
  localStorage.setItem('dvw:dsh-chat-visible', 'closed')
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [
    { id: '8:0', seq: 8, path: 'a.txt', before: 'old', after: 'disk', created: false },
    { id: '8:1', seq: 8, path: 'a.txt', before: 'before', after: 'tail', created: false },
  ])
  await vi.waitFor(() => expect(state.editor?.review?.changes).toHaveLength(2))
  expect(document.querySelector('.dvw-review-filebar')).toBeNull()
  const review = state.editor!.review!
  expect(review.onAsk).toBeTypeOf('function')
  const composer = document.createElement('textarea')
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  card.append(composer)
  const panel = document.createElement('div')
  panel.dataset.dvwConversationPanel = ''
  panel.append(card)
  document.body.append(panel)
  await act(async () => review.onAsk!(review.changes[0]!))
  await vi.waitFor(() => expect(composer.value).toBe('`a.txt:1` '))
  expect(document.querySelector('.dvw-chat')).not.toBeNull()
  expect(document.querySelector('.dvw-file-ai-menu')).toBeNull()
  await act(async () => review.onKeep('8:0'))
})

it('asks about a Git diff by inserting its reference into the visible DSH composer', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  localStorage.setItem('dvw:dsh-chat-visible', 'closed')
  await setup(false, { paths: [], view: 'git' }, [], [
    { path: 'a.txt', index: '.', worktree: 'M', staged: false, untracked: false },
  ])
  const row = await vi.waitFor(() => {
    const value = document.querySelector<HTMLElement>('.dvw-git .dvw-change')
    expect(value).not.toBeNull()
    return value!
  })
  await act(async () => row.click())
  const composer = document.createElement('textarea')
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  card.append(composer)
  const panel = document.createElement('div')
  panel.dataset.dvwConversationPanel = ''
  panel.append(card)
  document.body.append(panel)
  await act(async () => state.diff!.reviewActions!.onAsk({ startLine: 3, endLine: 5 }))
  await vi.waitFor(() => expect(composer.value).toBe('`a.txt:3-5` '))
  expect(document.querySelector('.dvw-chat')).not.toBeNull()
  expect(document.querySelector('.dvw-file-ai-menu')).toBeNull()
})

it('applies and persists the Git comparison style through Workbench settings', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: [], view: 'git' }, [], [{ path: 'a.txt', index: '.', worktree: 'M', staged: false, untracked: false }])
  await act(async () => document.querySelector<HTMLElement>('.dvw-change')!.click())
  expect(state.diff).toMatchObject({ mode: 'split', style: 'ribbon' })
  const settings = document.createElement('div')
  document.body.append(settings)
  await act(async () => settingsHost.set(settings))
  const selector = settings.querySelector<HTMLButtonElement>('button[aria-label^="Git 对比样式："]')!
  expect(selector.textContent).toContain('IDEA / PyCharm（默认）')
  await act(async () => selector.click())
  const options = Array.from(settings.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]'))
  expect(options.map(option => option.textContent?.trim())).toEqual(['IDEA / PyCharm（默认）', 'VS Code'])
  const vsCodeStyle = options.find(button => button.textContent?.trim() === 'VS Code')!
  await act(async () => vsCodeStyle.click())
  expect(state.diff).toMatchObject({ mode: 'inline', style: 'classic' })
  expect(localStorage.getItem('dvw:git-diff-style')).toBe('classic')
})

it('compares a staged file against HEAD from the staged changes group', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: [], view: 'git' }, [], [{
    path: 'a.txt', index: 'M', worktree: '.', staged: true, untracked: false,
  }])

  const row = await vi.waitFor(() => {
    const value = document.querySelector<HTMLElement>('.dvw-git .dvw-change')
    expect(value?.textContent).toContain('a.txt')
    return value!
  })
  await act(async () => row.click())

  expect(state.diff).toMatchObject({
    original: 'before',
    modified: 'after',
    sourcePath: 'a.txt',
    versions: ['HEAD', '暂存区'],
  })
  expect(document.querySelector('[data-tab-path="diff:staged:a.txt"]')).not.toBeNull()
  const request = vi.mocked(fetch).mock.calls
    .map(([, options]) => JSON.parse(String(options?.body)) as Record<string, unknown>)
    .find(body => body.action === 'diff')
  expect(request).toMatchObject({ action: 'diff', path: 'a.txt', value: 'staged' })
})

it('shows a new commit before the commit action finishes', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: [], view: 'git' }, [], [{
    path: 'a.txt', index: 'M', worktree: '.', staged: true, untracked: false,
  }])
  const input = await vi.waitFor(() => {
    const value = document.querySelector<HTMLTextAreaElement>('.dvw-commit-input')
    expect(value).not.toBeNull()
    return value!
  })

  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  let finishHistory!: (response: Response) => void
  let historyStarted = false
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>
    if (body.action === 'commit') {
      // The commit itself completed in Git. Reading the new history remains pending.
      return Response.json({
        ok: true,
        value: { repository: '/tmp/audit', branch: 'master', ahead: 1, behind: 0, changes: [] },
      })
    }
    if (body.action === 'log' && vi.mocked(fetch).mock.calls.some(([, request]) =>
      (JSON.parse(String(request?.body)) as Record<string, unknown>).action === 'commit')) {
      historyStarted = true
      return new Promise<Response>(resolve => { finishHistory = resolve })
    }
    return originalFetch(url, options)
  })

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, 'feat(git): show immediately')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => document.querySelector<HTMLButtonElement>('.dvw-commit-button')!.click())

  await vi.waitFor(() => expect(historyStarted).toBe(true))
  expect(input.value).toBe('feat(git): show immediately')

  await act(async () => finishHistory(Response.json({
    ok: true,
    value: [{
      hash: 'abcdef123456', author: 'Test', date: '2026-11-23T00:00:00Z',
      subject: 'feat(git): show immediately', parents: [], refs: ['HEAD -> master'],
    }],
  })))
  await vi.waitFor(() => expect(document.querySelector('.dvw-graph-subject')?.textContent).toBe('feat(git): show immediately'))
  expect(input.value).toBe('')
})

it.each([
  ['plain event', () => new Event('dvw-files-changed')],
  ['custom event without paths', () => new CustomEvent('dvw-files-changed', { detail: undefined })],
] as const)('closes a stale Git diff after a whole-workspace refresh (%s)', async (_name, changeEvent) => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: [], view: 'git' }, [], [{
    path: 'a.txt', index: '.', worktree: 'M', staged: false, untracked: false,
  }])

  const change = await vi.waitFor(() => {
    const row = document.querySelector<HTMLElement>('.dvw-git .dvw-change')
    expect(row?.textContent).toContain('a.txt')
    return row!
  })
  await act(async () => change.click())
  expect(document.querySelector('[data-tab-path="diff:a.txt"]')).not.toBeNull()

  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>
    if (body.action === 'status') {
      return Response.json({
        ok: true,
        value: { repository: '/tmp/audit', branch: 'master', ahead: 0, behind: 0, changes: [] },
      })
    }
    return originalFetch(url, options)
  })

  await act(async () => window.dispatchEvent(changeEvent()))
  await vi.waitFor(() => expect(document.querySelector('[data-tab-path="diff:a.txt"]')).toBeNull())
  expect(document.querySelector('.dvw-overlay')).not.toBeNull()
})

it('shares the diff layout across new and existing files and restores it after reopening', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  localStorage.setItem('dvw:git-diff-style', 'ribbon')
  const service = await setup(false, { paths: [], view: 'git' }, [], ['a.txt', 'b.txt'].map(path => ({
    path, index: '.', worktree: 'M', staged: false, untracked: false,
  })))
  const openDiff = async (path: string) => {
    const change = Array.from(document.querySelectorAll<HTMLElement>('.dvw-change'))
      .find(row => row.textContent?.includes(path))!
    await act(async () => change.click())
    expect(state.diff?.sourcePath).toBe(path)
  }
  const choose = async (mode: 'inline' | 'split') => {
    await act(async () => document.querySelector<HTMLButtonElement>(`.dvw-diff-mode-button[data-mode="${mode}"]`)!.click())
    expect(state.diff?.mode).toBe(mode)
  }

  await openDiff('a.txt')
  expect(state.diff?.mode).toBe('split')
  await choose('inline')
  await openDiff('b.txt')
  expect(state.diff?.mode).toBe('inline')
  await choose('split')
  await act(async () => document.querySelector<HTMLButtonElement>('[data-tab-path="diff:a.txt"]')!.click())
  expect(state.diff).toMatchObject({ sourcePath: 'a.txt', mode: 'split' })
  await choose('inline')
  await act(async () => root!.unmount())
  await mount(service)
  await openDiff('b.txt')
  expect(state.diff?.mode).toBe('inline')
})

it('only offers to launch the source file when switching between a file and its Git diff', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: ['a.js'], active: 'a.js' }, [], [
    { path: 'a.js', index: '.', worktree: 'M', staged: false, untracked: false },
  ])
  const actions = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.dvw-status-action'))
  expect(actions().map(button => button.disabled)).toEqual([false, false])
  await act(async () => document.querySelector<HTMLElement>('.dvw-change')!.click())
  expect(actions().map(button => button.disabled)).toEqual([true, true])
  await act(async () => document.querySelector<HTMLButtonElement>('[data-tab-path="a.js"]')!.click())
  expect(actions().map(button => button.disabled)).toEqual([false, false])
})

it('uses one persisted switch for line blame in both the file editor and Git diffs', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: ['a.txt'], active: 'a.txt', view: 'git' }, [], [
    { path: 'a.txt', index: '.', worktree: 'M', staged: false, untracked: false },
  ])
  expect(state.editor?.blame).toMatchObject({sessionId:'s',path:'a.txt',revision:'r1',dirty:false})
  await act(async () => document.querySelector<HTMLElement>('.dvw-change')!.click())
  expect(state.diff?.blameSessionId).toBe('s')
  const settings = document.createElement('div')
  document.body.append(settings)
  await act(async () => settingsHost.set(settings))
  const toggle = settings.querySelector<HTMLButtonElement>('button[aria-label="逐行提交信息"]')!
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  await act(async () => toggle.click())
  expect(state.diff?.blameSessionId).toBeUndefined()
  expect(localStorage.getItem('dvw:git-line-blame')).toBe('false')
  await act(async () => document.querySelector<HTMLButtonElement>('button[data-tab-path="a.txt"]')!.click())
  expect(state.editor?.blame).toBeUndefined()
})

it('turns the code minimap off from settings and keeps it off after a reload', async () => {
  await setup()
  await vi.waitFor(() => expect(state.editor).toBeDefined())
  // The switch defaults to on, matching VS Code.
  expect(state.editor?.minimap).toBe(true)
  const settings = document.createElement('div')
  document.body.append(settings)
  await act(async () => settingsHost.set(settings))
  const toggle = settings.querySelector<HTMLButtonElement>('button[aria-label="代码缩略图"]')!
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  await act(async () => toggle.click())
  // The open editor follows the switch without reopening the tab.
  expect(state.editor?.minimap).toBe(false)
  expect(localStorage.getItem('dvw:editor-minimap')).toBe('off')
  // A fresh mount reads the persisted preference instead of the default.
  await act(async () => root!.unmount())
  state.editor = undefined
  await mount()
  // Read through a function so TypeScript does not keep the `undefined` narrowing.
  const reloadedEditor = () => state.editor
  await vi.waitFor(() => expect(reloadedEditor()).toBeDefined())
  expect(reloadedEditor()?.minimap).toBe(false)
})

it('shows an empty staged commit as a centered recovery dialog and can stage everything', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [], [{
    path: 'a.txt', index: '?', worktree: '?', staged: false, untracked: true,
  }])
  const input = await vi.waitFor(() => {
    const value = document.querySelector<HTMLTextAreaElement>('.dvw-commit-input')
    expect(value).not.toBeNull()
    return value!
  })
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, 'initial commit')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => document.querySelector<HTMLButtonElement>('.dvw-commit-button')!.click())
  const dialog = await vi.waitFor(() => {
    const value = document.querySelector<HTMLElement>('.dvw-git-error-dialog')
    expect(value).not.toBeNull()
    return value!
  })
  expect(document.querySelector('.dvw-side .dvw-git-error-dialog')).toBeNull()
  expect(dialog.parentElement?.classList.contains('dvw-git-dialog-layer')).toBe(true)
  expect(dialog.textContent).toContain('没有已暂存的更改')
  expect(dialog.textContent).toContain('暂存全部并提交')
  const requestsBefore = vi.mocked(fetch).mock.calls
    .map(([, options]) => JSON.parse(String(options?.body)) as { action?: string })
    .map(body => body.action)
  expect(requestsBefore).not.toContain('commit')
  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '暂存全部并提交')!.click())
  await vi.waitFor(() => {
    const actions = vi.mocked(fetch).mock.calls
      .map(([, options]) => JSON.parse(String(options?.body)) as { action?: string })
      .map(body => body.action)
    expect(actions).toContain('stage.all')
    expect(actions).toContain('commit')
  })
})

it('lets the host resolve the current chat model until the user configures one', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [], [{
    path: 'a.txt', index: '?', worktree: '?', staged: false, untracked: true,
  }])
  const generate = await vi.waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>('.dvw-commit-ai')
    expect(button).not.toBeNull()
    expect(button!.disabled).toBe(false)
    return button!
  })
  await act(async () => generate.click())
  await vi.waitFor(() => {
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/git.commitMessage'))
    expect(request).toBeDefined()
    const body = JSON.parse(String(request![1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      sessionId: 's',
      detail: 'standard',
      language: 'auto',
    })
    expect(body).not.toHaveProperty('provider')
    expect(body).not.toHaveProperty('model')
  })
  expect(document.querySelector<HTMLTextAreaElement>('.dvw-commit-input')?.value).toBe('feat(git): generate the message directly')
  expect(localStorage.getItem('dvw:commit-model')).toBeNull()
})

it('resizes the graph split by pointer and keyboard and restores it after collapsing the graph', async () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  try {
    await setup()
    await act(async () => { document.querySelector<HTMLButtonElement>('button[title="源代码管理"]')!.click() })
    const handle = () => document.querySelector<HTMLElement>('.dvw-scm-resizer')
    const position = () => handle()?.getAttribute('aria-valuenow')
    const pointer = (type: string, clientY: number) => new MouseEvent(type, { bubbles: true, button: 0, clientY })
    expect(position()).toBe('300')
    await act(async () => {
      handle()!.dispatchEvent(pointer('pointerdown', 300))
      window.dispatchEvent(pointer('pointermove', 220))
    })
    expect(position()).toBe('220')
    await act(async () => { window.dispatchEvent(pointer('pointerup', 220)) })
    const graph = document.querySelector<HTMLButtonElement>('.dvw-graph .dvw-group-toggle')!
    await act(async () => { graph.click() })
    expect(handle()).toBeNull()
    await act(async () => { graph.click() })
    expect(position()).toBe('220')
    await act(async () => { handle()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(position()).toBe('230')
    await act(async () => { handle()!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(position()).toBe('300')
  } finally {
    height.mockRestore()
  }
})

it('switches between Terminal and Problems from the bottom panel header', async () => {
  const service = await setup()
  await act(async () => {
    service.registerBottomPanel({ id: 'terminal', title: '终端', component: () => <div data-test-terminal>终端内容</div> })
    service.toggleBottomPanel('terminal')
  })
  const header = document.querySelector('.dvw-bottom-head')!
  const buttons = header.querySelectorAll('button')
  const [terminal, problems, close] = buttons
  expect(Array.from(buttons, button => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['终端', '问题', '关闭底部面板'])
  expect(terminal!.getAttribute('aria-pressed')).toBe('true')
  const terminalContent = document.querySelector('[data-test-terminal]')!
  await act(async () => problems!.click())
  expect(terminalContent.closest('[hidden]')).not.toBeNull()
  expect(problems!.getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('.dvw-bottom-body')?.textContent).toContain('没有发现问题')
  await act(async () => problems!.click())
  expect(service.getSnapshot().bottomPanel).toBe('problems')
  await act(async () => terminal!.click())
  expect(document.querySelector('.dvw-bottom-body')?.textContent).toBe('终端内容')
  await act(async () => close!.click())
  expect(service.getSnapshot().bottomPanel).toBeUndefined()
})

it('keeps exactly one SSH explorer mounted when switching between Git and SSH', async () => {
  const service = await setup()
  const panel = document.querySelector('.dvw-ssh')
  expect(panel).not.toBeNull()
  for (const view of ['git', 'ssh', 'git', 'ssh'] as const) {
    await act(async () => service.show(view))
    expect([...document.querySelectorAll('.dvw-ssh')]).toEqual([panel])
  }
})

it('keeps the SSH terminal mounted and reachable while debugging', async () => {
  const service = await setup()
  let mounts = 0
  let unmounts = 0
  function SshTerminal() {
    useEffect(() => {
      mounts += 1
      return () => { unmounts += 1 }
    }, [])
    return <div data-test-ssh>SSH 会话内容</div>
  }
  await act(async () => {
    service.registerBottomPanel({ id: 'ssh-terminal', title: 'SSH 终端', component: SshTerminal })
    service.registerBottomPanel({ id: 'debug', title: '调试', component: () => <div data-test-debug>调试内容</div> })
    service.toggleBottomPanel('ssh-terminal')
  })
  const sshTab = () => Array.from(document.querySelectorAll<HTMLElement>('.dvw-bottom-head .dvw-bottom-title')).find(tab => tab.textContent === 'SSH 终端')
  const debugTab = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.dvw-bottom-head button')).find(button => button.textContent === '调试')
  expect(sshTab()?.textContent).toBe('SSH 终端')
  expect(mounts).toBe(1)
  await act(async () => debugTab()!.click())
  expect(service.getSnapshot().bottomPanel).toBe('debug')
  expect(sshTab()?.textContent).toBe('SSH 终端')
  expect(document.querySelector('[data-test-ssh]')?.closest('[hidden]')).not.toBeNull()
  expect(document.querySelector('[data-test-debug]')).not.toBeNull()
  expect(unmounts).toBe(0)
  await act(async () => sshTab()!.click())
  expect(service.getSnapshot().bottomPanel).toBe('ssh-terminal')
  expect(document.querySelector('[data-test-ssh]')?.closest('[hidden]')).toBeNull()
  expect(mounts).toBe(1)
})

it('puts branch controls in the status bar and commit metadata in the hover card', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({visible:true, view:'git'}))
  await setup(false, {}, [], [{path:'src/a.txt', index:'?', worktree:'?', staged:false, untracked:true}])
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const {action} = JSON.parse(String(options?.body)) as {action?:string}
    if (action === 'log') return Response.json({ok:true,value:[{
      hash:'abcdef123456', author:'Author', date:'2026-01-01T00:00:00Z', subject:'Commit title', parents:[], refs:['HEAD -> main','origin/main','tag: v1'],
    }]})
    if (action === 'commit.summary') return Response.json({ok:true,value:{files:1,added:2,removed:3}})
    return originalFetch(url, options)
  })
  await act(async () => document.querySelector<HTMLButtonElement>('[title="刷新提交图表"]')!.click())
  const row = await vi.waitFor(() => {
    const row = document.querySelector<HTMLButtonElement>('.dvw-graph-row')
    expect(row?.textContent).toBe('Commit title')
    return row!
  })
  expect(document.querySelector('.dvw-status [title="切换分支"]')).not.toBeNull()
  expect(document.querySelector('.dvw-scm-head .dvw-group-toggle')?.textContent).toBe('提交')
  expect(document.querySelector('.dvw-git .dvw-group-head .dvw-group-toggle')?.textContent).toBe('更改')
  expect(document.querySelector('.dvw-graph .dvw-count')).toBeNull()
  expect(document.querySelector('.dvw-git .dvw-group-head')?.lastElementChild?.textContent).toBe('1')
  await act(async () => { row.focus(); await new Promise(resolve => setTimeout(resolve,350)) })
  const hover = document.querySelector('.dvw-commit-hover')
  expect(hover?.textContent).toContain('Author')
  expect(Array.from(hover!.querySelectorAll('.dvw-ref'), item => item.textContent)).toEqual(['HEAD -> main','origin/main','tag: v1'])
  expect(hover?.textContent).toContain('已更改 1 个文件')
  await act(async () => { row.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})) })
  expect(document.querySelector('.dvw-commit-hover')).toBeNull()
})

it('stops generation and ignores a late response without changing the draft', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({visible:true, view:'git'}))
  await setup(false, {}, [], [{path:'a.txt', index:'?', worktree:'?', staged:false, untracked:true}])
  const button = await vi.waitFor(() => {
    const element = document.querySelector<HTMLButtonElement>('.dvw-commit-ai')
    expect(element?.disabled).toBe(false)
    return element!
  })
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  await act(async () => button.click())
  const signal = vi.mocked(fetch).mock.calls.at(-1)?.[1]?.signal
  expect(button.getAttribute('aria-label')).toBe('停止生成提交信息')
  await act(async () => button.click())
  expect(signal?.aborted).toBe(true)
  await act(async () => finish(Response.json({ok:true,value:{message:'cancelled'}})))
  expect(document.querySelector<HTMLTextAreaElement>('.dvw-commit-input')?.value).toBe('')
  expect(button.getAttribute('aria-label')).toBe('生成提交信息')
  expect(document.querySelector('.dvw-git-error-dialog')).toBeNull()
})

it('uses an explicitly configured commit model instead of the active chat model', async () => {
  localStorage.setItem('dvw:commit-model', JSON.stringify({ provider: 'deepseek-official', model: 'deepseek-pro' }))
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [], [{
    path: 'a.txt', index: '?', worktree: '?', staged: false, untracked: true,
  }])
  const generate = await vi.waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>('.dvw-commit-ai')
    expect(button?.disabled).toBe(false)
    return button!
  })
  await act(async () => generate.click())
  await vi.waitFor(() => {
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/git.commitMessage'))
    expect(JSON.parse(String(request![1]?.body))).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-pro',
    })
  })
})

it('uses the same model catalog with independent AI completion settings', async () => {
  const service = await setup()
  expect(state.editor?.aiCompletion).toBeUndefined()
  const settings = document.createElement('div')
  document.body.append(settings)
  await act(async () => settingsHost.set(settings))
  const selector = (label: string) => settings.querySelector<HTMLButtonElement>(`button[aria-label^="${label}："]`)
  const pick = async (label: string, value: string) => {
    const button = await vi.waitFor(() => {
      expect(selector(label)).not.toBeNull()
      return selector(label)!
    })
    await act(async () => button.click())
    const option = [...settings.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')]
      .find(item => item.textContent?.trim() === value)!
    await act(async () => option.click())
  }
  await pick('AI 代码补全触发方式', '自动补全')
  await pick('AI 代码补全模型', 'DeepSeek-V4-Pro')
  expect(selector('提交信息生成模型')?.textContent).toContain('跟随 DSH 聊天模型')
  expect(localStorage.getItem('dvw:commit-model')).toBeNull()
  expect(localStorage.getItem('dvw:inline-completion-mode')).toBe('auto')
  await act(async () => settingsHost.set(undefined))
  expect(state.editor?.aiCompletion).toEqual({
    mode: 'auto', sessionId: 's', cwd: '/tmp/audit', model: { provider: 'deepseek-official', model: 'deepseek-pro' },
  })
  await act(async () => root!.unmount())
  await mount(service)
  expect(state.editor?.aiCompletion?.model?.model).toBe('deepseek-pro')
})

it('keeps a saved generation model when its provider is temporarily unavailable', async () => {
  const saved = { provider: 'deepseek-official', model: 'deepseek-pro' }
  localStorage.setItem('dvw:commit-model', JSON.stringify(saved))
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: ['a.txt'], active: 'a.txt' }, [], [], {
    models: [],
    unavailable: [{ provider: 'deepseek-official', providerName: 'DeepSeek', message: '连接超时' }],
  })
  await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/commit.models'))).toBe(true))
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.dvw-commit-ai')?.disabled).toBe(true))
  expect(JSON.parse(localStorage.getItem('dvw:commit-model')!)).toEqual(saved)
  expect(document.querySelector<HTMLButtonElement>('.dvw-commit-ai')?.title).toContain('当前不可用')
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
  await act(async () => sockets.at(-1)!.dispatchEvent(new Event('open')))
  expect(state.editor!.value).toBe('recovered draft')
  expect(document.body.textContent).toContain('磁盘文件已变化')
})

it('keeps the explorer and unsaved document loaded when switching sessions in the same workspace', async () => {
  const service = await setup(false, undefined, [], [], undefined, [{ path: 'a.txt', name: 'a.txt', kind: 'file' }])
  await act(async () => state.editor!.onChange('same workspace draft'))
  vi.mocked(fetch).mockClear()
  await act(async () => { root!.render(<Workbench service={service} sessionId="other-session" cwd="/tmp/audit"/>) })
  expect(state.editor?.value).toBe('same workspace draft')
  expect(document.querySelector('[data-tree-path="a.txt"]')).not.toBeNull()
  const reloads = vi.mocked(fetch).mock.calls.filter(([url]) => /\/(?:workspace|fs\.read)$/.test(String(url)))
  expect(reloads).toHaveLength(0)
})

it('preserves other session drafts across consecutive switches while a workspace is still loading', async () => {
  const service = await setup()
  vi.useFakeTimers()
  const otherDrafts = JSON.stringify([{ path: 'other.txt', content: 'saved', draft: 'other session precious draft', revision: 'r0' }])
  localStorage.setItem('dvw:drafts:other-session:/tmp/audit', otherDrafts)
  const originalFetch = fetch
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => url.endsWith('/workspace')
    ? new Promise(() => {})
    : originalFetch(url, options))
  await act(async () => state.editor!.onChange('outgoing draft'))
  await act(async () => { root!.render(<Workbench service={service} sessionId="other-session" cwd="/tmp/other"/>) })
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/third"/>) })
  expect(localStorage.getItem('dvw:drafts:other-session:/tmp/audit')).toBe(otherDrafts)
  expect(localStorage.getItem('dvw:drafts:s:/tmp/audit')).toContain('outgoing draft')
})

it.each(['s', 'other-session'])('flushes the outgoing draft before a fast workspace switch in %s', async nextSession => {
  const service = await setup()
  vi.useFakeTimers()
  const originalFetch = fetch
  let currentCwd = '/tmp/other'
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => url.endsWith('/workspace')
    ? Promise.resolve(Response.json({ ok: true, value: { cwd: currentCwd, name: 'fixture' } }))
    : originalFetch(url, options))
  await act(async () => state.editor!.onChange('unsaved before switching'))
  await act(async () => { root!.render(<Workbench service={service} sessionId={nextSession} cwd={currentCwd}/>) })
  expect(localStorage.getItem('dvw:drafts:s:/tmp/audit')).toContain('unsaved before switching')
  currentCwd = '/tmp/audit'
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd={currentCwd}/>) })
  expect(state.editor?.value).toBe('unsaved before switching')
})

it('reloads a clean document when its path changes on disk', async () => {
  await setup()
  disk = 'updated by DSH'; revision = 'external'
  await act(async () => sockets.at(-1)!.change(['a.txt']))
  expect(state.editor!.value).toBe('updated by DSH')
})

it('reloads external changes through the authenticated desktop socket carrier', async () => {
  const carrier = Object.assign(new EventTarget(), { readyState: 1, send: vi.fn(), close: vi.fn() })
  const createWebSocket = vi.fn(() => carrier)
  vi.stubGlobal('__DSH_TRANSPORT__', { streamBaseUrl: 'http://127.0.0.1:4312', createWebSocket })
  await setup()
  await act(async () => carrier.dispatchEvent(new Event('open')))
  expect(carrier.send).toHaveBeenCalledWith(JSON.stringify({ type: 'watch', version: 1, paths: ['', 'a.txt'] }))
  disk = 'desktop external edit'; revision = 'external'
  await act(async () => carrier.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ type: 'files.changed', paths: ['a.txt'] }),
  })))
  expect(state.editor!.value).toBe('desktop external edit')
  expect(createWebSocket).toHaveBeenCalledWith(expect.stringContaining('/dsh-vscode/ws/files?sessionId=s'))
})

it('shows a retry action after a local read fails and opens the recovered document', async () => {
  let failed = true
  await setup(false, undefined, [], [], undefined, [], () => failed
    ? { code: 'unavailable', message: 'temporary read failure', status: 503 }
    : undefined)
  expect(document.querySelector('.dvw-editor-body')?.textContent).toContain('temporary read failure')
  const retry = [...document.querySelectorAll<HTMLButtonElement>('.dvw-editor-body button')]
    .find(button => button.textContent === '重试读取文件')
  expect(retry).toBeDefined()
  failed = false
  await act(async () => retry!.click())
  expect(state.editor?.value).toBe('disk')
  expect(document.querySelector('.dvw-editor-body')?.textContent).not.toContain('正在加载文件')
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

it.each([
  { paths: ['a.txt', 'b.txt', 'c.txt'], active: 'a.txt' },
  { groups: [{ id: 'pane-1', paths: ['a.txt', 'b.txt', 'c.txt'], active: 'a.txt' }] },
])('keeps inactive restored documents lazy until their tab is selected: %j', async saved => {
  await setup(false, saved)
  const reads = () => vi.mocked(fetch).mock.calls
    .filter(([url]) => String(url).endsWith('/fs.read'))
    .map(([, options]) => JSON.parse(String(options!.body)).path)
  expect(reads()).toEqual(['a.txt'])
  const tab = document.querySelector<HTMLButtonElement>('[data-tab-path="b.txt"]')!
  await act(async () => tab.click())
  expect(reads()).toEqual(['a.txt', 'b.txt'])
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

it('opens HTML source in a text editor through the Explorer menu', async () => {
  await setup(false, { paths: [] }, [], [], defaultModelCatalog, [{ path: 'index.html', name: 'index.html', kind: 'file' }])
  const row = document.querySelector('[data-tree-path="index.html"]')
  expect(row).not.toBeNull()
  await act(async () => row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const action = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === '打开 HTML 源码')
  expect(action).toBeDefined()
  await act(async () => action!.click())
  expect(state.editor?.uri).toBe('file:///tmp/audit/index.html')
})
