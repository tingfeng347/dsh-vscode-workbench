// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { MonacoEditor, retainEditorModels } from '../src/client/MonacoEditor.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// A minimal Monaco stand-in: enough surface to observe editor reuse, model
// swaps and view-state round trips without loading the real AMD bundle.
interface FakeModel { uri: { scheme: string; toString(): string }; value: string; disposed: boolean; attached: boolean; getValue(): string; setValue(value: string): void; getLineCount(): number; getLineContent(line: number): string; isAttachedToEditor(): boolean; dispose(): void }
const actions: string[] = []
const fake = { created: 0, models: new Map<string, FakeModel>(), editor: undefined as undefined | { model: FakeModel | null; scroll: number; selection?: unknown } }
function createModel(value: string, _language: unknown, uri: FakeModel['uri']): FakeModel {
  const model: FakeModel = {
    uri, value, disposed: false, attached: false,
    getValue: () => model.value, setValue: next => { model.value = next },
    getLineCount: () => model.value.split('\n').length, getLineContent: line => model.value.split('\n')[line - 1] ?? '',
    isAttachedToEditor: () => model.attached, dispose: () => { model.disposed = true; fake.models.delete(uri.toString()) },
  }
  fake.models.set(uri.toString(), model); return model
}
const monaco = {
  Uri: { parse: (value: string) => ({ scheme: value.split(':')[0]!, toString: () => value }) },
  Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
  KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 },
  editor: {
    defineTheme() {}, setTheme() {}, createModel,
    getModel: (uri: { toString(): string }) => fake.models.get(uri.toString()) ?? null,
    getModels: () => [...fake.models.values()],
    create() {
      fake.created++
      const editor = {
        model: null as FakeModel | null, scroll: 0, selection: undefined as unknown,
        getModel: () => editor.model,
        setModel(model: FakeModel | null) { if (editor.model) editor.model.attached = false; editor.model = model; if (model) model.attached = true; editor.scroll = 0 },
        saveViewState: () => ({ scroll: editor.scroll }), restoreViewState(state: { scroll: number }) { editor.scroll = state.scroll },
        setSelection(range: unknown) { editor.selection = range }, revealLineInCenter(line: number) { editor.scroll = line * 100 }, focus() {},
        createDecorationsCollection: () => ({ clear() {} }), onDidChangeModelContent: () => ({ dispose() {} }), addCommand() {}, addAction() { return { dispose() {} } }, updateOptions() {},
        getTargetAtClientPoint: () => ({ position: { lineNumber: 17, column: 10 } }), setPosition() {},
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
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host = undefined; fake.models.clear(); fake.created = 0; actions.length = 0; vi.restoreAllMocks() })
async function render(props: Partial<Parameters<typeof MonacoEditor>[0]> & { uri: string; value: string }) {
  if (root === undefined) { host = document.createElement('div'); root = createRoot(host) }
  await act(async () => { root!.render(<MonacoEditor theme="dark" onChange={() => {}} onSave={() => {}} {...props}/>) })
}

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

it('reveals a new search hit in an open tab instead of its saved position', async () => {
  await render({ uri: '/w/a.ts', value: 'one\ntwo\nthree' })
  fake.editor!.scroll = 640
  await render({ uri: '/w/b.ts', value: 'b' })
  await render({ uri: '/w/a.ts', value: 'one\ntwo\nthree', line: 3, column: 1, highlight: 'three' })
  expect(fake.editor!.scroll).toBe(300)
  expect(fake.editor!.selection).toMatchObject({ startLineNumber: 3, startColumn: 1, endColumn: 6 })
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
