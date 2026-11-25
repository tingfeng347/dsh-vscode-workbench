// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { MonacoEditor, retainEditorModels, reviewLinePresentation } from '../src/client/MonacoEditor.tsx'
import type { editor } from 'monaco-editor'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// A minimal Monaco stand-in: enough surface to observe editor reuse, model
// swaps and view-state round trips without loading the real AMD bundle.
interface FakeModel { uri: { scheme: string; toString(): string }; value: string; disposed: boolean; attached: boolean; getValue(): string; setValue(value: string): void; getLineCount(): number; getLineContent(line: number): string; getLineMaxColumn(line: number): number; isAttachedToEditor(): boolean; dispose(): void }
interface FakeZone { afterLineNumber: number; heightInLines: number; domNode: HTMLElement; suppressMouseDown?: boolean }
interface FakeWidget { domNode: HTMLElement }
const actions: string[] = []
const fake = {
  created: 0,
  models: new Map<string, FakeModel>(),
  reviewDecorations: [] as Array<{ range: unknown; options: Record<string, unknown> }>,
  zones: [] as FakeZone[],
  widgets: [] as FakeWidget[],
  onMouseDown: undefined as undefined | ((event: { target: { position?: { lineNumber: number }; type?: number }; event?: {leftButton: boolean} }) => void),
  blameWidget: undefined as editor.IOverlayWidget | undefined,
  createOptions: undefined as undefined | { minimap?: { enabled?: boolean } },
  updatedOptions: [] as Array<{ minimap?: { enabled?: boolean } }>,
  editor: undefined as undefined | {
    model: FakeModel | null
    scroll: number
    focusCount: number
    selection?: unknown
  },
}
function createModel(value: string, _language: unknown, uri: FakeModel['uri']): FakeModel {
  const model: FakeModel = {
    uri, value, disposed: false, attached: false,
    getValue: () => model.value, setValue: next => { model.value = next },
    getLineCount: () => model.value.split('\n').length, getLineContent: line => model.value.split('\n')[line - 1] ?? '',
    getLineMaxColumn: line => (model.value.split('\n')[line - 1]?.length ?? 0) + 1,
    isAttachedToEditor: () => model.attached, dispose: () => { model.disposed = true; fake.models.delete(uri.toString()) },
  }
  fake.models.set(uri.toString(), model); return model
}
const monaco = {
  languages: { getLanguages: () => [], register() {}, onLanguage() {} },
  Uri: { parse: (value: string) => ({ scheme: value.split(':')[0]!, toString: () => value }) },
  Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
  KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 },
  editor: {
    ContentWidgetPositionPreference: { EXACT: 0, ABOVE: 1, BELOW: 2 },
    MouseTargetType: { CONTENT_TEXT: 6 },
    defineTheme() {}, setTheme() {}, createModel,
    getModel: (uri: { toString(): string }) => fake.models.get(uri.toString()) ?? null,
    getModels: () => [...fake.models.values()],
    create(_dom: HTMLElement, options?: Record<string, unknown>) {
      fake.created++
      fake.createOptions = options as { minimap?: { enabled?: boolean } } | undefined
      const editor = {
        model: null as FakeModel | null, scroll: 0, focusCount: 0, selection: undefined as unknown,
        getModel: () => editor.model,
        setModel(model: FakeModel | null) { if (editor.model) editor.model.attached = false; editor.model = model; if (model) model.attached = true; editor.scroll = 0 },
        saveViewState: () => ({ scroll: editor.scroll }), restoreViewState(state: { scroll: number }) { editor.scroll = state.scroll },
        setSelection(range: unknown) { editor.selection = range }, revealLineInCenter(line: number) { editor.scroll = line * 100 }, focus() { editor.focusCount++ },
        createDecorationsCollection: (entries: typeof fake.reviewDecorations = []) => {
          fake.reviewDecorations = entries
          return { clear() { fake.reviewDecorations = [] } }
        },
        changeViewZones(callback: (accessor: { addZone(zone: FakeZone): string; removeZone(id: string): void }) => void) {
          let nextId = 0
          callback({
            addZone(zone) { const id = `zone-${++nextId}`; fake.zones.push(zone); return id },
            removeZone() { fake.zones = [] },
          })
        },
        addContentWidget(widget: { getDomNode(): HTMLElement }) { fake.widgets.push({ domNode: widget.getDomNode() }) },
        removeContentWidget(widget: { getDomNode(): HTMLElement }) { fake.widgets = fake.widgets.filter(item => item.domNode !== widget.getDomNode()) },
        onDidChangeModelContent: () => ({ dispose() {} }),
        onMouseDown(callback: typeof fake.onMouseDown) { fake.onMouseDown = callback },
        getAction: () => null,
        addCommand() {}, addAction() { return { dispose() {} } },
        updateOptions(next: Record<string, unknown> = {}) { fake.updatedOptions.push(next as { minimap?: { enabled?: boolean } }) },
        getTargetAtClientPoint: () => ({ position: { lineNumber: 17, column: 10 } }), setPosition() {},
        getLayoutInfo: () => ({width:600,height:400,contentLeft:40,contentWidth:550,verticalScrollbarWidth:10,horizontalScrollbarHeight:10}),
        getScrollTop: () => editor.scroll,
        getTopForLineNumber: (line: number) => (line - 1) * 20,
        getVisibleRanges: () => [{startLineNumber:1,endLineNumber:editor.model?.getLineCount() ?? 1}],
        getScrolledVisiblePosition: (position: {column:number}) => ({left:40 + (position.column - 1) * 8}),
        addOverlayWidget(widget: editor.IOverlayWidget) { fake.blameWidget = widget },
        layoutOverlayWidget() {},
        removeOverlayWidget() { fake.blameWidget = undefined },
        onDidScrollChange: () => ({dispose() {}}), onDidLayoutChange: () => ({dispose() {}}),
        onDidChangeHiddenAreas: () => ({dispose() {}}), onKeyDown: () => ({dispose() {}}),
        trigger: (_source: string, id: string) => { actions.push(id) },
        dispose() { if (editor.model) editor.model.attached = false },
      }
      fake.editor = editor; return editor
    },
  },
}
let root: Root | undefined
let host: HTMLDivElement | undefined
beforeAll(() => {
  const loader = Object.assign((_ids: string[], done: () => void) => done(), { config() {} })
  Object.assign(window, { require: loader, monaco })
})
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host = undefined; fake.models.clear(); fake.created = 0; fake.reviewDecorations = []; fake.zones = []; fake.widgets = []; fake.onMouseDown = undefined; fake.createOptions = undefined; fake.updatedOptions = []; actions.length = 0; vi.restoreAllMocks() })
async function render(props: Partial<Parameters<typeof MonacoEditor>[0]> & { uri: string; value: string }) {
  if (root === undefined) { host = document.createElement('div'); root = createRoot(host) }
  await act(async () => { root!.render(<MonacoEditor theme="dark" onChange={() => {}} onSave={() => {}} {...props}/>) })
}

it('shows the code minimap by default and follows the setting', async () => {
  await render({ uri: '/w/a.ts', value: 'a' })
  // The first Monaco load resolves across microtasks, so wait for the editor to exist.
  await vi.waitFor(() => expect(fake.created).toBe(1))
  expect(fake.createOptions).toMatchObject({ minimap: { enabled: true, side: 'right', maxColumn: 120 } })
  await render({ uri: '/w/a.ts', value: 'a', minimap: false })
  await vi.waitFor(() => expect(fake.updatedOptions.some(options => options.minimap?.enabled === false)).toBe(true))
  // The setting updates the existing instance instead of rebuilding Monaco.
  expect(fake.created).toBe(1)
})

it('reuses one editor across tabs and restores each tab scroll position', async () => {
  await render({ uri: '/w/a.ts', value: 'a' })
  fake.editor!.scroll = 640
  await render({ uri: '/w/b.ts', value: 'b' })
  expect(fake.editor!.model!.value).toBe('b')
  expect(fake.editor!.scroll).toBe(0)
  await render({ uri: '/w/a.ts', value: 'a' })
  expect(fake.created).toBe(1)
  expect(fake.editor!.scroll).toBe(640)
})

it('prefetches line attribution and displays clicks from the same block without a request or loading text', async () => {
  const blame = {kind:'commit',author:'Bai',timestamp:1_735_732_800,hash:'1a2b3c4d5678',subject:'Implement editor'}
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({ok:true,value:{startLine:1,lines:[blame,blame]}}))
  const file = {uri:'/w/blame.ts',value:'first\nsecond'}
  await render({...file,blame:{sessionId:'s',path:'blame.ts',revision:'r1',dirty:false}})
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
  fake.onMouseDown?.({target:{type:6,position:{lineNumber:2}},event:{leftButton:true}})
  expect(fetch).toHaveBeenCalledWith('/dsh-vscode/api/git.blameRange',expect.objectContaining({
    body:JSON.stringify({sessionId:'s',source:{kind:'document',path:'blame.ts',revision:'r1'},startLine:1,endLine:2}),
  }))
  expect(fake.blameWidget?.getPosition()).toEqual({preference:{top:20,left:104}})
  expect(fake.blameWidget?.getDomNode().textContent).toMatch(/Bai · .*2025.* · 1a2b3c4d · Implement editor/)
  fake.onMouseDown?.({target:{type:6,position:{lineNumber:1}},event:{leftButton:true}})
  expect(fake.blameWidget?.getDomNode().textContent).toContain('Implement editor')
  expect(fetch).toHaveBeenCalledOnce()
  await render(file)
  expect(fake.blameWidget).toBeUndefined()
})

it('keeps an uncached click quiet and reuses the in-flight prefetch', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.spyOn(globalThis,'fetch').mockReturnValue(new Promise(resolve=>{ finish = resolve }))
  await render({uri:'/w/blame.ts',value:'first\nsecond',blame:{sessionId:'s',path:'blame.ts',revision:'r1',dirty:false}})
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
  fake.onMouseDown?.({target:{type:6,position:{lineNumber:2}},event:{leftButton:true}})
  expect(fake.blameWidget?.getDomNode().textContent).toBe('')
  expect(fetch).toHaveBeenCalledOnce()
  finish(Response.json({ok:true,value:{startLine:1,lines:[{kind:'uncommitted'},{kind:'uncommitted'}]}}))
  await vi.waitFor(()=>expect(fake.blameWidget?.getDomNode().textContent).toBe('尚未提交'))
})

it('reveals a new search hit in an open tab instead of its saved position', async () => {
  await render({ uri: '/w/a.ts', value: 'one\ntwo\nthree' })
  fake.editor!.scroll = 640
  await render({ uri: '/w/b.ts', value: 'b' })
  await render({ uri: '/w/a.ts', value: 'one\ntwo\nthree', line: 3, column: 1, highlight: 'three' })
  expect(fake.editor!.scroll).toBe(300)
  expect(fake.editor!.selection).toMatchObject({ startLineNumber: 3, startColumn: 1, endColumn: 6 })
})

it('selects the full requested line range when following a DSH reference', async () => {
  await render({ uri: '/w/a.ts', value: 'one\ntwo\nthree', line: 2, endLine: 3 })
  expect(fake.editor!.scroll).toBe(200)
  expect(fake.editor!.selection).toMatchObject({
    startLineNumber: 2,
    startColumn: 1,
    endLineNumber: 3,
    endColumn: 6,
  })
})

it('can follow a review location without taking editor focus', async () => {
  await render({ uri: '/w/a.ts', value: 'one\ntwo\nthree', line: 2, focusOnReveal: false })
  expect(fake.editor!.focusCount).toBe(0)
  expect(fake.editor!.scroll).toBe(200)
  await render({ uri: '/w/a.ts', value: 'one\ntwo\nthree', line: 3, focusOnReveal: true })
  expect(fake.editor!.focusCount).toBe(1)
  expect(fake.editor!.scroll).toBe(300)
})

it('presents only changed lines from a broad tool hunk', () => {
  expect(reviewLinePresentation(
    'head\nnew a\nsame\nnew b\ntail',
    {
      before: 'head\nold a\nsame\nold b\ntail',
      after: 'head\nnew a\nsame\nnew b\ntail',
    },
  )).toEqual({
    addedLines: [2, 4],
    deletedGroups: [
      { afterLineNumber: 1, lines: ['old a'] },
      { afterLineNumber: 3, lines: ['old b'] },
    ],
    controlAfterLine: 4,
  })
})

it('paints AI additions and removed blocks with block-level keep and reject controls', async () => {
  const onFocus = vi.fn()
  const onKeep = vi.fn()
  const onReject = vi.fn()
  const onAsk = vi.fn()
  await render({
    uri: '/w/a.ts',
    value: 'head\nconst added = true\ntail',
    review: {
      changes: [{
        id: '8:0',
        seq: 8,
        path: 'src/a.ts',
        before: 'const added = false',
        after: 'const added = true',
        created: false,
      }],
      activeId: '8:0',
      onFocus,
      onKeep,
      onReject,
      onAsk,
    },
  })

  expect(fake.reviewDecorations).toHaveLength(1)
  expect(fake.reviewDecorations[0]!.options).toMatchObject({
    isWholeLine: true,
    className: 'dvw-review-line-added dvw-review-line-active',
    linesDecorationsClassName: 'dvw-review-gutter-added',
  })
  expect(fake.zones).toHaveLength(1)
  expect(fake.zones[0]!.afterLineNumber).toBe(1)
  expect(fake.zones[0]!.domNode.querySelector('.dvw-review-removed')?.textContent).toBe('const added = false')
  expect(fake.zones[0]!.domNode.hasAttribute('data-conflict')).toBe(false)
  expect(fake.zones[0]!.domNode.getAttribute('data-active')).toBe('')

  const removedZone = fake.zones[0]!.domNode
  const actionWidget = fake.widgets[0]!.domNode
  await act(async () => fake.onMouseDown!({ target: { position: { lineNumber: 2 } } }))
  await act(async () => removedZone.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  const buttons = [...actionWidget.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons.map(button => button.textContent)).toEqual(['允许', '拒绝', '询问 AI'])
  expect(actionWidget.hasAttribute('data-conflict')).toBe(false)
  const editorHost = document.createElement('div')
  const editorGesture = vi.fn()
  editorHost.addEventListener('pointerdown', editorGesture)
  editorHost.addEventListener('mousedown', editorGesture)
  editorHost.append(actionWidget)
  actionWidget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  actionWidget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  expect(editorGesture).not.toHaveBeenCalled()
  await act(async () => buttons[0]!.click())
  await act(async () => buttons[1]!.click())
  await act(async () => buttons[2]!.click())

  expect(onFocus).toHaveBeenCalledWith('8:0')
  expect(onKeep).toHaveBeenCalledWith('8:0')
  expect(onReject).toHaveBeenCalledWith('8:0')
  expect(onAsk).toHaveBeenCalledOnce()
})

it('allows reversing a tracked insertion and disables it while the file is busy', async () => {
  const review = {
    changes: [{
      id: '8:0',
      seq: 8,
      path: 'src/a.ts',
      before: null,
      after: 'inserted',
      created: false,
    }],
    activeId: '8:0',
    rejectDisabled: false,
    onFocus() {},
    onKeep() {},
    onReject() {},
  }
  await render({ uri: '/w/a.ts', value: 'head\ninserted\ntail', review })
  expect([...fake.widgets[0]!.domNode.querySelectorAll<HTMLButtonElement>('button')][1]!.disabled).toBe(false)

  await render({ uri: '/w/a.ts', value: 'head\ninserted\ntail', review: { ...review, rejectDisabled: true } })
  expect([...fake.widgets[0]!.domNode.querySelectorAll<HTMLButtonElement>('button')][1]!.disabled).toBe(true)
})

it('disposes models of closed tabs but keeps open and attached ones', async () => {
  await render({ uri: '/w/a.ts', value: 'a' })
  await render({ uri: '/w/b.ts', value: 'b' })
  createModel('x', undefined, monaco.Uri.parse('dvw-diff-original:///w/x.ts'))
  retainEditorModels([])
  expect([...fake.models.keys()].sort()).toEqual(['dvw-diff-original:///w/x.ts', 'file:///w/b.ts'])
  retainEditorModels(['/w/b.ts'])
  await act(async () => root?.unmount()); root = undefined
  retainEditorModels(['/w/b.ts'])
  expect(fake.models.has('file:///w/b.ts')).toBe(true)
  retainEditorModels([])
  expect(fake.models.has('file:///w/b.ts')).toBe(false)
})

it('turns a macOS Control-click into go-to-definition', async () => {
  vi.spyOn(Navigator.prototype, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
  await render({ uri: '/w/a.ts', value: 'a' })
  const editorRoot = host!.firstElementChild!
  editorRoot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true, clientX: 10, clientY: 20 }))
  expect(actions).toEqual(['editor.action.revealDefinition'])
})

it('leaves Command-click and non-Mac Control-click to Monaco', async () => {
  vi.spyOn(Navigator.prototype, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
  await render({ uri: '/w/a.ts', value: 'a' })
  const editorRoot = host!.firstElementChild!
  editorRoot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, metaKey: true }))
  expect(actions).toEqual([])
})

it('jumps from the Control-click context-menu event when mousedown carries no Ctrl state', async () => {
  vi.spyOn(Navigator.prototype, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
  await render({ uri: '/w/a.ts', value: 'a' })
  const editorRoot = host!.firstElementChild!
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ctrlKey: true, clientX: 10, clientY: 20 })
  editorRoot.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(true)
  expect(actions).toEqual(['editor.action.revealDefinition'])
})
