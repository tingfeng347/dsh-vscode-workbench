// @vitest-environment jsdom
import type { CancellationToken, editor, languages, Position } from 'monaco-editor'
import type { GenerateOptions, PreparedLlmCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { registerInlineCompletion } from '../src/client/inlineCompletion.ts'
import { completionInsertText, generateInlineCompletion } from '../src/inline-completion.ts'

const position = { lineNumber: 1, column: 5 } as Position
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as CancellationToken
const explicit = { triggerKind: 1, selectedSuggestionInfo: undefined } as languages.InlineCompletionContext

function setup(mode: 'auto' | 'manual') {
  const value = 'sum(1)'
  const uri = { toString: () => 'file:///work/demo.ts' }
  const model = {
    uri, isDisposed: () => false, getVersionId: () => 1, getLanguageId: () => 'typescript',
    getOffsetAt: (point: Position) => point.column - 1,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getValueLength: () => value.length,
    getValueInRange: (range: { startColumn: number; endColumn: number }) => value.slice(range.startColumn - 1, range.endColumn - 1),
  } as unknown as editor.ITextModel
  const trigger = vi.fn()
  const changeModel = vi.fn((_callback: () => void) => ({ dispose() {} }))
  const on = () => ({ dispose() {} })
  const instance = {
    getModel: vi.fn((): editor.ITextModel | null => model),
    hasTextFocus: () => true, getPosition: () => position,
    getSelections: () => [{ isEmpty: () => true }],
    getContribution: () => null,
    addAction: vi.fn(on), trigger, updateOptions: vi.fn(),
    onDidChangeModel: changeModel, onDidChangeModelContent: on, onDidChangeCursorSelection: on,
    onDidBlurEditorWidget: on, onDidCompositionStart: on, onDidCompositionEnd: on, onKeyDown: on,
  }
  const register = vi.fn((_selector: unknown, _provider: languages.InlineCompletionsProvider) => ({ dispose() {} }))
  const monaco = {
    languages: { registerInlineCompletionsProvider: register, InlineCompletionTriggerKind: { Explicit: 1 } },
    KeyMod: { Alt: 1 }, KeyCode: { Backslash: 2, Escape: 3 },
    Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
  } as unknown as typeof import('monaco-editor')
  const disposable = registerInlineCompletion(monaco, instance as unknown as editor.IStandaloneCodeEditor, { mode, cwd: '/work', sessionId: 's' })
  return { model, instance, changeModel, disposable, provide: register.mock.calls[0]![1].provideInlineCompletions }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('uses the unsaved Monaco buffer and only serves explicit requests in manual mode', async () => {
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ ok: true, value: { text: '2, ' } }))
  vi.stubGlobal('fetch', fetch)
  const { model, disposable, provide } = setup('manual')
  try {
    expect(await provide(model, position, { ...explicit, triggerKind: 0 }, token)).toBeUndefined()
    expect(await provide(model, position, { ...explicit, selectedSuggestionInfo: {} as languages.SelectedSuggestionInfo }, token)).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(await provide(model, position, explicit, token)).toEqual({
      items: [{ insertText: '2, ', range: { startLineNumber: 1, endLineNumber: 1, startColumn: 5, endColumn: 5 } }],
    })
    const [url, request] = fetch.mock.calls[0]!
    expect(url).toBe('/dsh-vscode/api/editor.inlineCompletion')
    expect(JSON.parse(String(request.body))).toEqual({ sessionId: 's', path: 'demo.ts', language: 'typescript', prefix: 'sum(', suffix: '1)' })
  } finally { disposable.dispose() }
})

it('debounces automatic requests and discards a response after switching files', async () => {
  vi.useFakeTimers()
  let respond!: (value: Response) => void
  const fetch = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(resolve => { respond = resolve }))
  vi.stubGlobal('fetch', fetch)
  const { model, instance, changeModel, disposable, provide } = setup('auto')
  try {
    const result = provide(model, position, { ...explicit, triggerKind: 0 }, token)
    await vi.advanceTimersByTimeAsync(249)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledOnce()
    instance.getModel.mockReturnValue(null)
    changeModel.mock.calls[0]![0]()
    expect(fetch.mock.calls[0]![1].signal?.aborted).toBe(true)
    respond(Response.json({ ok: true, value: { text: '2, ' } }))
    expect(await result).toBeUndefined()
  } finally { disposable.dispose() }
})

it('preserves indentation and avoids repeating the same-line suffix', () => {
  expect(completionInsertText('   return 1\n', '\n}')).toBe('   return 1\n')
  expect(completionInsertText('value)', ')')).toBe('value')
  expect(completionInsertText('x\n  y', ')')).toBe('x')
  expect(completionInsertText('   ', '')).toBe('')
})

it('sends a single completion prompt through the prepared DSH model call', async () => {
  const selection = { provider: 'gateway', model: 'coder' }
  const context = { path: 'demo.ts', language: 'typescript', prefix: 'sum(', suffix: ')' }
  const signal = new AbortController().signal
  const stream = vi.fn(async function* (_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'text-delta', index: 0, text: '1, 2' }
    yield { type: 'text-delta', index: 0, text: ')' }
  })
  const prepareCall = vi.fn(async (): Promise<PreparedLlmCall> => ({
    config: selection, stream, adapterDefaults: {},
    retryPolicy: { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
  }))
  const fallback = vi.fn(async function* () { throw new Error('Expected the prepared call') })
  expect(await generateInlineCompletion({ prepareCall, stream: fallback }, selection, context, signal)).toBe('1, 2')
  expect(prepareCall).toHaveBeenCalledWith(selection, signal, expect.any(Function))
  expect(stream).toHaveBeenCalledWith(expect.objectContaining({
    ...selection, signal, messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(context) }] }],
  }))
  expect(fallback).not.toHaveBeenCalled()
})
