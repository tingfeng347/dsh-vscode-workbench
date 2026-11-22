import type { CancellationToken, editor, languages } from 'monaco-editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LspManager } from '../src/client/lsp.ts'
import type { ServerCapabilities } from '../src/client/lspProtocol.ts'

interface Message { id?: number; method: string; params: Record<string, unknown> }

class FakeSocket extends EventTarget {
  static OPEN = 1
  static instances: FakeSocket[] = []
  static capabilities: ServerCapabilities
  readyState = FakeSocket.OPEN
  sent: Message[] = []

  constructor() {
    super()
    FakeSocket.instances.push(this)
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  send(raw: string) {
    const message: Message = JSON.parse(raw)
    this.sent.push(message)
    if (message.method === 'initialize') {
      queueMicrotask(() => this.reply(message.id, { capabilities: FakeSocket.capabilities }))
    }
  }

  receive(message: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })) }
  reply(id: number | undefined, result: unknown) { this.receive({ jsonrpc: '2.0', id, result }) }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

class Range {
  constructor(readonly startLineNumber: number, readonly startColumn: number, readonly endLineNumber: number, readonly endColumn: number) {}
  equalsRange(other: Range) { return JSON.stringify(this) === JSON.stringify(other) }
  getStartPosition() { return { lineNumber: this.startLineNumber, column: this.startColumn } }
  getEndPosition() { return { lineNumber: this.endLineNumber, column: this.endColumn } }
}

const parse = (value: string) => ({ scheme: 'file', toString: () => value })
const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }
const documentUri = 'file:///repo/a.py'
const nextUri = 'file:///repo/b.py'
const server = { id: 'python', name: 'Pyright', languages: ['python'], installed: true, installable: true }
const pos = { lineNumber: 1, column: 3 } as import('monaco-editor').Position
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } satisfies CancellationToken

function model(uri: string, initial: string, language = 'python') {
  let version = 1
  let value = initial
  let change: ((event: editor.IModelContentChangedEvent) => void) | undefined
  return {
    uri: parse(uri),
    getLanguageId: () => language,
    getVersionId: () => version,
    getValue: () => value,
    getValueInRange: (range: Range) => value.slice(range.startColumn - 1, range.endColumn - 1),
    getWordUntilPosition: () => ({ startColumn: 2, endColumn: 3, word: 'pa' }),
    isDisposed: () => false,
    getOffsetAt: ({ column }: { column: number }) => column - 1,
    validateRange: (range: Range) => range,
    onDidChangeContent(listener: typeof change) {
      change = listener
      return { dispose() { change = undefined } }
    },
    update(next: string) {
      value = next
      version++
      change?.({ changes: [{ range: new Range(1, 2, 1, 3), rangeOffset: 1, rangeLength: 1, text: 'x' }], versionId: version, eol: '\n', isFlush: false, isUndoing: false, isRedoing: false, isEolChange: false })
    },
  }
}

type Model = ReturnType<typeof model>
function fixture(models: Model[], options?: ConstructorParameters<typeof LspManager>[3]) {
  const completion = vi.fn<(selector: languages.LanguageSelector, provider: languages.CompletionItemProvider) => { dispose(): void }>(() => ({ dispose() {} }))
  const rename = vi.fn<(selector: languages.LanguageSelector, provider: languages.RenameProvider) => { dispose(): void }>(() => ({ dispose() {} }))
  const hover = vi.fn(() => ({ dispose() {} }))
  const formatting = vi.fn(() => ({ dispose() {} }))
  const noopEvent = () => ({ dispose() {} })
  const markers = vi.fn()
  const monaco = {
    Range,
    Uri: { parse },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    editor: {
      getModels: () => models,
      getModel: (uri: { toString(): string }) => models.find(model => model.uri.toString() === uri.toString()) ?? null,
      onDidCreateModel: noopEvent,
      onDidChangeModelLanguage: noopEvent,
      onWillDisposeModel: noopEvent,
      setModelMarkers: markers,
    },
    languages: {
      CompletionItemKind: { Text: 18, Class: 5, Snippet: 27 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4, KeepWhitespace: 1 },
      CompletionItemTag: { Deprecated: 1 },
      registerCompletionItemProvider: completion,
      registerRenameProvider: rename,
      registerHoverProvider: hover,
      registerDocumentFormattingEditProvider: formatting,
    },
  } as unknown as typeof import('monaco-editor')
  const manager = new LspManager(monaco, 'a', '/repo', options)
  disposables.push(manager)
  return { manager, completion, hover, rename, markers, formatting }
}

const disposables: LspManager[] = []
beforeEach(() => {
  FakeSocket.instances = []
  FakeSocket.capabilities = {}
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('location', { protocol: 'http:', host: 'dsh.test' })
})
afterEach(() => {
  for (const manager of disposables.splice(0)) manager.dispose()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Monaco language server client', () => {
  it('uses server capabilities and preserves replacement ranges, snippets, imports and lazy details', async () => {
    FakeSocket.capabilities = { textDocumentSync: 2, completionProvider: { triggerCharacters: ['.'], resolveProvider: true } }
    const document = model(documentUri, 'abc')
    const { manager, completion, hover } = fixture([document])
    manager.sync([server], 'a')
    await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce())
    expect(hover).not.toHaveBeenCalled()
    const [, provider] = completion.mock.calls[0]!
    expect(provider.triggerCharacters).toEqual(['.'])
    const socket = FakeSocket.instances[0]!
    const request = provider.provideCompletionItems(document as unknown as editor.ITextModel, pos, { triggerKind: 1, triggerCharacter: '.' }, token)
    const sent = socket.sent.at(-1)!
    expect(sent).toMatchObject({ method: 'textDocument/completion', params: { context: { triggerKind: 2, triggerCharacter: '.' } } })
    socket.reply(sent.id, { isIncomplete: true, items: [{
      label: 'path', kind: 15, sortText: '0001', insertTextFormat: 2,
      textEdit: { range, newText: 'path($1)' }, additionalTextEdits: [{ range, newText: 'import os\n' }],
    }] })
    const list = await request
    expect(list).toMatchObject({ incomplete: true, suggestions: [{
      label: 'path', kind: 27, sortText: '0001', insertText: 'path($1)', insertTextRules: 4,
      range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 4 },
      additionalTextEdits: [{ text: 'import os\n' }],
    }] })
    const details = provider.resolveCompletionItem!(list!.suggestions[0]!, token)
    const resolve = socket.sent.at(-1)!
    expect(resolve.method).toBe('completionItem/resolve')
    socket.reply(resolve.id, { detail: 'module os.path' })
    await expect(details).resolves.toMatchObject({ detail: 'module os.path', insertText: 'path($1)' })
  })

  it('enables the external HTML and CSS formatters and sends JSONC to the JSON server', async () => {
    FakeSocket.capabilities = { textDocumentSync: 2 }
    const documents = [
      model('file:///repo/a.html', '<main></main>', 'html'),
      model('file:///repo/a.scss', 'a{color:red}', 'scss'),
      model('file:///repo/a.jsonc', '{ /* comment */ }', 'json'),
    ]
    const { manager } = fixture(documents)
    manager.sync([
      { ...server, id: 'html', languages: ['html'] },
      { ...server, id: 'css', languages: ['css', 'scss', 'less'] },
      { ...server, id: 'json', languages: ['json'] },
    ], 'a')
    await vi.waitFor(() => {
      expect(FakeSocket.instances).toHaveLength(3)
      for (const socket of FakeSocket.instances) {
        expect(socket.sent[0]).toMatchObject({ method: 'initialize', params: { initializationOptions: { provideFormatter: true } } })
      }
      expect(FakeSocket.instances[2]!.sent).toContainEqual(expect.objectContaining({
        method: 'textDocument/didOpen', params: { textDocument: expect.objectContaining({ languageId: 'jsonc' }) },
      }))
      expect(FakeSocket.instances[2]!.sent).toContainEqual(expect.objectContaining({
        method: 'workspace/didChangeConfiguration', params: { settings: { json: { validate: { enable: true } } } },
      }))
    })
  })

  it('only offers Bash formatting once shfmt is available', async () => {
    FakeSocket.capabilities = { textDocumentSync: 1, documentFormattingProvider: true }
    const { manager, formatting } = fixture([model('file:///repo/a.sh', 'echo test', 'shell')])
    const shell = { ...server, id: 'shell', languages: ['shell'], shellTools: { shellcheck: false, shfmt: false } }
    manager.sync([shell], 'a')
    await vi.waitFor(() => expect(FakeSocket.instances[0]?.sent).toContainEqual(expect.objectContaining({ method: 'textDocument/didOpen' })))
    expect(formatting).not.toHaveBeenCalled()
    manager.sync([{ ...shell, shellTools: { shellcheck: false, shfmt: true } }], 'a')
    await vi.waitFor(() => expect(formatting).toHaveBeenCalledOnce())
  })

  it('sends incremental changes and saves, and discards stale diagnostics and completions', async () => {
    FakeSocket.capabilities = { textDocumentSync: { openClose: true, change: 2, save: { includeText: true } }, completionProvider: {} }
    const document = model(documentUri, 'abc')
    const { manager, completion, markers } = fixture([document])
    manager.sync([server], 'a')
    await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce())
    const socket = FakeSocket.instances[0]!
    const [, provider] = completion.mock.calls[0]!
    const request = provider.provideCompletionItems(document as unknown as editor.ITextModel, pos, { triggerKind: 0 }, token)
    const id = socket.sent.at(-1)!.id
    document.update('axc')
    manager.saved(documentUri, 'axc')
    expect(socket.sent.slice(-2)).toMatchObject([
      { method: 'textDocument/didChange', params: { textDocument: { uri: documentUri, version: 2 }, contentChanges: [{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, text: 'x' }] } },
      { method: 'textDocument/didSave', params: { textDocument: { uri: documentUri }, text: 'axc' } },
    ])
    socket.reply(id, [{ label: 'stale' }])
    await expect(request).resolves.toBeUndefined()
    for (const version of [1, 2]) {
      socket.receive({ method: 'textDocument/publishDiagnostics', params: { uri: documentUri, version, diagnostics: [{ range, message: String(version) }] } })
    }
    expect(markers).toHaveBeenCalledExactlyOnceWith(document, 'lsp:python', [expect.objectContaining({ message: '2' })])
    let cancel: (() => void) | undefined
    const cancellable: CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested(listener) { cancel = () => listener(undefined); return { dispose() {} } },
    }
    const cancelled = provider.provideCompletionItems(document as unknown as editor.ITextModel, pos, { triggerKind: 0 }, cancellable)
    const pending = socket.sent.at(-1)!.id
    cancel?.()
    expect(socket.sent.at(-1)).toMatchObject({ method: '$/cancelRequest', params: { id: pending } })
    await expect(cancelled).resolves.toBeUndefined()
  })

  it('only starts a relevant language, reopens drafts after failure and releases it on uninstall', async () => {
    vi.useFakeTimers()
    FakeSocket.capabilities = { textDocumentSync: 2 }
    const document = model(documentUri, 'abc')
    const status = vi.fn()
    const { manager } = fixture([document], { onStatus: status })
    manager.sync([server, { ...server, id: 'go', languages: ['go'] }], 'a')
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.instances).toHaveLength(1)
    manager.sync([server], 'b')
    expect(FakeSocket.instances).toHaveLength(1)
    FakeSocket.instances[0]!.close()
    document.update('unsaved')
    manager.sync([server], 'b')
    await vi.advanceTimersByTimeAsync(550)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1]!.sent).toContainEqual(expect.objectContaining({
      method: 'textDocument/didOpen', params: { textDocument: { uri: documentUri, languageId: 'python', version: 2, text: 'unsaved' } },
    }))
    manager.sync([], 'b')
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(status).toHaveBeenLastCalledWith('python', undefined)
  })

  it('prepares cross-file rename against current buffers and only tracks edits after preview approval', async () => {
    FakeSocket.capabilities = { textDocumentSync: 2, renameProvider: true }
    const document = model(documentUri, 'abc')
    const second = model(nextUri, 'abc')
    const trackWorkspaceEdits = vi.fn(async () => {})
    const previewRename = vi.fn(async () => true)
    const { manager, rename } = fixture([document, second], { previewRename, trackWorkspaceEdits })
    manager.sync([server], 'a')
    await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce())
    const socket = FakeSocket.instances[0]!
    const [, provider] = rename.mock.calls[0]!
    const result = provider.provideRenameEdits(document as unknown as editor.ITextModel, pos, 'target', token)
    socket.reply(socket.sent.at(-1)!.id, { changes: { [documentUri]: [{ range, newText: 'target' }], [nextUri]: [{ range, newText: 'target' }] } })
    expect(await result).toMatchObject({ edits: [{ versionId: 1, textEdit: { text: 'target' } }, { versionId: 1, textEdit: { text: 'target' } }] })
    expect(previewRename).toHaveBeenCalledWith([
      { path: 'a.py', changes: [{ line: 1, before: 'bc', after: 'target' }] },
      { path: 'b.py', changes: [{ line: 1, before: 'bc', after: 'target' }] },
    ], token)
    expect(trackWorkspaceEdits).toHaveBeenCalledOnce()
    previewRename.mockResolvedValueOnce(false)
    const cancelled = provider.provideRenameEdits(document as unknown as editor.ITextModel, pos, 'target', token)
    socket.reply(socket.sent.at(-1)!.id, { changes: { [documentUri]: [{ range, newText: 'target' }], [nextUri]: [{ range, newText: 'target' }] } })
    await expect(cancelled).resolves.toEqual({ edits: [] })
    expect(trackWorkspaceEdits).toHaveBeenCalledOnce()
  })
})
