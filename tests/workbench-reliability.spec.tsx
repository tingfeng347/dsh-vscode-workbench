// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Workbench } from '../src/client/Workbench.tsx'
import type { MonacoDiffEditor, MonacoEditor } from '../src/client/MonacoEditor.tsx'
import { settingsHost } from '../src/client/settingsHost.ts'
import { WorkbenchController } from '../src/client/service.ts'
import { disposeTypeScriptProject } from '../src/client/typescriptProject.ts'
import type { GitChange } from '../src/types.ts'

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
vi.mock('../src/client/MonacoEditor.tsx', () => ({
  MonacoEditor: (props: EditorProps) => { state.editor = props; return null },
  MonacoDiffEditor: (props: DiffProps) => { state.diff = props; return props.viewControls }, preloadMonaco: () => {}, retainEditorModels: () => {},
  isMacPlatform: () => false,
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
  await act(async () => { root!.render(<Workbench service={service} sessionId="s" cwd="/tmp/audit" dshPanelId={dshPanelId} onOpenDshPanel={handlers.open} onRestoreConversation={handlers.restore}/>) })
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
async function setup(binary = false, saved: Record<string, unknown> = { paths: ['a.txt'], active: 'a.txt' }, changes: typeof reviewChanges = [], gitChanges: GitChange[] = [], modelCatalog: FakeModelCatalog = defaultModelCatalog) {
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
    else if (method === 'fs.list' || method === 'lsp.status') value = []
    else if (method === 'git.status') value = { repository: '/tmp/audit', branch: 'master', ahead: 0, behind: 0, changes: gitChanges }
    else if (method === 'git.action' && body.action === 'diff') value = { diff: '', original: 'before', modified: 'after' }
    else if (method === 'git.action') value = body.action === 'log' ? [] : { repository: '/tmp/audit', branch: 'master', ahead: 0, behind: 0, changes: gitChanges }
    else if (method === 'commit.models') value = modelCatalog
    else if (method === 'git.commitMessage') value = { message: 'feat(git): generate the message directly' }
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

it('applies and persists the Git comparison style through Workbench settings', async () => {
  localStorage.setItem('dvw:workbench:snapshot:v1', JSON.stringify({ visible: true, view: 'git' }))
  await setup(false, { paths: [], view: 'git' }, [], [{ path: 'a.txt', index: '.', worktree: 'M', staged: false, untracked: false }])
  await act(async () => document.querySelector<HTMLElement>('.dvw-change')!.click())
  expect(state.diff).toMatchObject({ mode: 'inline', style: 'classic' })
  const settings = document.createElement('div')
  document.body.append(settings)
  await act(async () => settingsHost.set(settings))
  const selector = settings.querySelector<HTMLButtonElement>('button[aria-label^="Git 对比样式："]')!
  expect(selector.textContent).toContain('VS Code（默认）')
  await act(async () => selector.click())
  const jetBrainsStyle = Array.from(settings.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')).find(button=>button.textContent?.trim()==='IDEA / PyCharm')!
  await act(async () => jetBrainsStyle.click())
  expect(state.diff).toMatchObject({ mode: 'split', style: 'ribbon' })
  expect(localStorage.getItem('dvw:git-diff-style')).toBe('ribbon')
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
