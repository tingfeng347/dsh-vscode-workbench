import type { CancellationToken, editor, IDisposable, languages, Position, Uri } from 'monaco-editor'
import { websocketUrl } from './websocket.ts'
import { protocolLanguageId } from './lspLanguage.ts'
export { languageServerIdForPath } from './lspLanguage.ts'
import { projectModelPath, workspacePathFromModel } from './typescriptProject.ts'
import {
  completionItem, diagnosticMarkers, documentChanges, editorRange, markup, toLspPosition, toLspRange,
  type CompletionDefaults, type LspCodeAction, type LspCommand, type LspCompletion, type LspDiagnostic,
  type LspInlayHint, type LspRange, type LspTextEdit, type LspWorkspaceEdit, type ServerCapabilities,
} from './lspProtocol.ts'

type Monaco = typeof import('monaco-editor')

export interface LspServerStatus {
  id: string
  name: string
  languages: string[]
  installable: boolean
  installed: boolean
  hint?: string
  command?: string
  language?: { name: string; installed: boolean }
  pythonPath?: string
  shellTools?: { shellcheck: boolean; shfmt: boolean }
}

export interface LspRuntimeStatus {
  state: 'starting' | 'ready' | 'reconnecting' | 'failed'
  message?: string
}

interface Pending { finish(value: unknown, error?: unknown): void }
interface SyncedDocument {
  model: editor.ITextModel
  subscription: IDisposable
  diagnostics: LspDiagnostic[]
}
interface DiagnosticReport { uri: string; version?: number; diagnostics: LspDiagnostic[] }
type WorkspaceFile = { uri: Uri; model: editor.ITextModel; version: number }
export interface RenamePreviewFile {
  path: string
  changes: { line: number; before: string; after: string }[]
}
type WorkspaceTarget = { uri: Uri; version?: number | null; edits: LspTextEdit[] }

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: {
    workspaceFolders: true, configuration: true, applyEdit: true,
    workspaceEdit: { documentChanges: true },
  },
  textDocument: {
    synchronization: { didSave: true },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true, commitCharactersSupport: true, insertReplaceSupport: true,
        labelDetailsSupport: true, preselectSupport: true, tagSupport: { valueSet: [1] },
        insertTextModeSupport: { valueSet: [1, 2] }, documentationFormat: ['markdown', 'plaintext'],
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      },
      completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode', 'data'] },
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: { contextSupport: true, signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
    declaration: { linkSupport: true }, definition: { linkSupport: true }, implementation: { linkSupport: true },
    typeDefinition: { linkSupport: true }, references: {}, rename: { prepareSupport: true },
    codeAction: {
      dataSupport: true, isPreferredSupport: true, disabledSupport: true,
      codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'source', 'source.organizeImports'] } },
      resolveSupport: { properties: ['edit'] },
    },
    formatting: {}, rangeFormatting: {}, documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    inlayHint: { resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'] } },
    semanticTokens: {
      requests: { full: true, range: true },
      tokenTypes: ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable',
        'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string',
        'number', 'regexp', 'operator', 'decorator'],
      tokenModifiers: ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification',
        'documentation', 'defaultLibrary'],
      formats: ['relative'],
    },
    publishDiagnostics: { versionSupport: true, relatedInformation: true, tagSupport: { valueSet: [1, 2] }, codeDescriptionSupport: true },
  },
}

export function lspLocations(monaco: Monaco, result: unknown): languages.Location[] {
  if (result === null || result === undefined) return []
  return (Array.isArray(result) ? result : [result]).flatMap(item => {
    if (item === null || typeof item !== 'object') return []
    const uri = item.uri ?? item.targetUri
    const range = item.targetSelectionRange ?? item.range ?? item.targetRange
    if (typeof uri !== 'string' || range === undefined) return []
    try { return [{ uri: monaco.Uri.parse(uri), range: editorRange(monaco, range) }] } catch { return [] }
  })
}

interface LspOptions {
  onStatus?(id: string, status: LspRuntimeStatus | undefined): void
  onDiagnostics?(id: string, uri: string, markers: editor.IMarkerData[]): void
  loadModel?(uri: Uri, readExternal: () => Promise<string>): Promise<editor.ITextModel | undefined>
  trackWorkspaceEdits?(files: WorkspaceFile[]): Promise<void>
  configuration?(section: string | undefined): unknown
  previewRename?(files: RenamePreviewFile[], token: CancellationToken): Promise<boolean>
  retainEditModels?(uris: Uri[]): IDisposable
}

interface ConnectionOptions extends LspOptions {
  monaco: Monaco
  sessionId: string
  workspaceRoot: string
  server: LspServerStatus
  disconnected(error: Error): void
}

function disableBuiltin(monaco: Monaco, language: string, capabilities: ServerCapabilities): IDisposable | undefined {
  const defaults = language === 'typescript' ? monaco.languages.typescript?.typescriptDefaults
    : language === 'javascript' ? monaco.languages.typescript?.javascriptDefaults
    : language === 'json' ? monaco.languages.json?.jsonDefaults
    : language === 'html' ? monaco.languages.html?.htmlDefaults
    : language === 'css' ? monaco.languages.css?.cssDefaults
    : language === 'scss' ? monaco.languages.css?.scssDefaults
    : language === 'less' ? monaco.languages.css?.lessDefaults : undefined
  if (defaults === undefined) return
  const previous = defaults.modeConfiguration as Record<string, boolean | undefined>
  const configuration = { ...previous }
  const overrides: Record<string, boolean | object | undefined> = {
    completionItems: capabilities.completionProvider,
    hovers: capabilities.hoverProvider,
    definitions: capabilities.definitionProvider,
    references: capabilities.referencesProvider,
    documentSymbols: capabilities.documentSymbolProvider,
    documentFormattingEdits: capabilities.documentFormattingProvider,
    documentRangeFormattingEdits: capabilities.documentRangeFormattingProvider,
    documentRangeFormatting: capabilities.documentRangeFormattingProvider,
    signatureHelp: capabilities.signatureHelpProvider,
    rename: capabilities.renameProvider,
    renameProvider: capabilities.renameProvider,
    codeActions: capabilities.codeActionProvider,
    inlayHints: capabilities.inlayHintProvider,
    diagnostics: true,
  }
  for (const key of Object.keys(previous)) if (overrides[key]) configuration[key] = false
  defaults.setModeConfiguration(configuration)
  return { dispose: () => defaults.setModeConfiguration(previous) }
}

export class LspConnection {
  private socket: WebSocket | undefined
  private nextId = 1
  private pending = new Map<number, Pending>()
  private documents = new Map<string, SyncedDocument>()
  private reportedUris = new Set<string>()
  private disposables: IDisposable[] = []
  private capabilities: ServerCapabilities = {}
  private stopped = false
  private initialized = false
  private readonly owner: string
  private readonly folders: { uri: string; name: string }[]

  constructor(private readonly options: ConnectionOptions) {
    this.owner = `lsp:${options.server.id}`
    this.folders = [{ uri: options.monaco.Uri.parse(projectModelPath('', options.workspaceRoot)).toString(), name: options.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? '/' }]
  }

  async start(): Promise<void> {
    const url = websocketUrl(`/dsh-vscode/ws/lsp?${new URLSearchParams({ sessionId: this.options.sessionId, server: this.options.server.id })}`)
    if (url === undefined) throw new Error('无法连接语言服务器：工作台地址未知')
    const socket = this.socket = new WebSocket(url)
    socket.addEventListener('message', event => this.receive(String(event.data)))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接语言服务器超时')), 10_000)
      const connected = () => { clearTimeout(timer); resolve() }
      const failed = () => { clearTimeout(timer); reject(new Error('语言服务器连接失败')) }
      socket.addEventListener('open', connected, { once: true })
      socket.addEventListener('error', failed, { once: true })
      socket.addEventListener('close', event => {
        clearTimeout(timer)
        const error = new Error(event.reason || '语言服务器连接已关闭')
        reject(error)
        if (!this.stopped) this.options.disconnected(error)
      }, { once: true })
    })
    const result = await this.request<{ capabilities: ServerCapabilities }>('initialize', {
      processId: null,
      clientInfo: { name: 'DSH VS Code Workbench' },
      rootUri: this.folders[0]!.uri,
      rootPath: this.options.workspaceRoot,
      workspaceFolders: this.folders,
      capabilities: CLIENT_CAPABILITIES,
      ...(['json', 'css', 'html'].includes(this.options.server.id) ? { initializationOptions: { provideFormatter: true } } : {}),
    }, undefined, 30_000)
    if (this.stopped) return
    const { id, shellTools } = this.options.server
    this.capabilities = id === 'shell' && shellTools?.shfmt === false
      ? { ...result.capabilities, documentFormattingProvider: false, documentRangeFormattingProvider: false }
      : result.capabilities
    this.notify('initialized', {})
    const settings = id === 'json' ? {
      validate: { enable: true },
      schemas: this.options.monaco.languages.json?.jsonDefaults.diagnosticsOptions.schemas?.map(schema =>
        ({ url: schema.uri, fileMatch: schema.fileMatch, schema: schema.schema })),
    } : this.options.configuration?.(id)
    if (settings !== undefined) this.notify('workspace/didChangeConfiguration', { settings: { [id]: settings } })
    this.initialized = true
    this.registerProviders()
    this.syncModels()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    for (const pending of this.pending.values()) pending.finish(undefined, new Error('语言服务器连接已关闭'))
    for (const disposable of this.disposables.splice(0).reverse()) disposable.dispose()
    for (const model of this.documents.values()) this.closeDocument(model.model)
    for (const uri of this.reportedUris) this.options.onDiagnostics?.(this.options.server.id, uri, [])
    this.reportedUris.clear()
    this.socket?.close()
    this.socket = undefined
  }

  private send(message: object): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('语言服务器连接未就绪')
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', ...message }))
  }

  private notify(method: string, params: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ method, params })
  }

  private request<T>(method: string, params: unknown, token?: CancellationToken, timeout = 10_000): Promise<T> {
    if (this.stopped || token?.isCancellationRequested) return Promise.reject(new Error('语言服务请求已取消'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      let subscription: IDisposable | undefined
      const cancel = (error: Error) => { finish(undefined, error); this.notify('$/cancelRequest', { id }) }
      const timer = setTimeout(() => cancel(new Error(`${method} 请求超时`)), timeout)
      const finish = (value: unknown, error?: unknown) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        subscription?.dispose()
        if (error === undefined) resolve(value as T)
        else reject(error)
      }
      this.pending.set(id, { finish })
      subscription = token?.onCancellationRequested(() => cancel(new Error('语言服务请求已取消')))
      if (!this.pending.has(id)) { subscription?.dispose(); return }
      try { this.send({ id, method, params }) } catch (error) { finish(undefined, error) }
    })
  }

  private async receive(raw: string): Promise<void> {
    let message: Record<string, unknown>
    try {
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return
      message = parsed
    } catch { return }
    if (typeof message.id === 'number' && message.method === undefined) {
      const error = message.error as { message?: string } | null | undefined
      this.pending.get(message.id)?.finish(message.result, error == null ? undefined : new Error(error.message ?? '语言服务请求失败'))
      return
    }
    const method = message.method
    if (message.id !== undefined) {
      let response: { result: unknown } | { error: { code: number; message: string } }
      try {
        if (method === 'workspace/configuration') {
          const params = message.params as { items: { section?: string }[] }
          response = { result: params.items.map(item => this.options.configuration?.(item.section) ?? null) }
        } else if (method === 'workspace/workspaceFolders') {
          response = { result: this.folders }
        } else if (method === 'workspace/applyEdit') {
          const edit = await this.workspaceEdit((message.params as { edit: LspWorkspaceEdit }).edit)
          this.applyEdit(edit)
          response = { result: { applied: true } }
        } else if (method === 'window/workDoneProgress/create' || method === 'window/showMessageRequest') {
          response = { result: null }
        } else {
          response = { error: { code: -32601, message: 'Method not supported' } }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        response = method === 'workspace/applyEdit'
          ? { result: { applied: false, failureReason: reason } }
          : { error: { code: -32603, message: reason } }
      }
      if (this.socket?.readyState === WebSocket.OPEN) this.send({ id: message.id, ...response })
    } else if (method === 'textDocument/publishDiagnostics') {
      try { this.publishDiagnostics(message.params as DiagnosticReport) } catch { /* Ignore invalid diagnostics. */ }
    }
  }

  private publishDiagnostics(params: DiagnosticReport): void {
    const { monaco, onDiagnostics, server } = this.options
    const uri = monaco.Uri.parse(params.uri).toString()
    if (workspacePathFromModel(this.options.workspaceRoot, uri) === undefined) return
    const document = this.documents.get(uri)
    if (params.version !== undefined && document !== undefined && params.version !== document.model.getVersionId()) return
    if (document !== undefined) document.diagnostics = params.diagnostics
    const markers = diagnosticMarkers(monaco, params.diagnostics)
    if (document !== undefined) monaco.editor.setModelMarkers(document.model, this.owner, markers)
    if (markers.length === 0) this.reportedUris.delete(uri)
    else this.reportedUris.add(uri)
    onDiagnostics?.(server.id, uri, markers)
  }

  private tracks(model: editor.ITextModel): boolean {
    return model.uri.scheme === 'file'
      && this.options.server.languages.includes(model.getLanguageId())
      && workspacePathFromModel(this.options.workspaceRoot, model.uri.toString()) !== undefined
  }

  private openDocument(model: editor.ITextModel): void {
    if (!this.tracks(model)) return
    const uri = model.uri.toString()
    if (this.documents.has(uri)) return
    const sync = this.capabilities.textDocumentSync
    const kind = typeof sync === 'number' ? sync : sync?.change ?? 0
    const subscription = model.onDidChangeContent(event => {
      if (kind === 0 || event.changes.length === 0) return
      this.notify('textDocument/didChange', { textDocument: { uri, version: model.getVersionId() }, contentChanges: documentChanges(model, event, kind) })
    })
    this.documents.set(uri, { model, subscription, diagnostics: [] })
    if (typeof sync === 'number' ? sync !== 0 : sync?.openClose) {
      const languageId = protocolLanguageId(model.getLanguageId(), model.uri.path ?? uri)
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: model.getVersionId(), text: model.getValue() } })
    }
  }

  private closeDocument(model: editor.ITextModel): void {
    const uri = model.uri.toString()
    const entry = this.documents.get(uri)
    if (entry === undefined) return
    this.documents.delete(uri)
    entry.subscription.dispose()
    this.options.monaco.editor.setModelMarkers(model, this.owner, [])
    const sync = this.capabilities.textDocumentSync
    if (typeof sync === 'number' ? sync !== 0 : sync?.openClose) this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  saved(uri: string, text: string): void {
    const sync = this.capabilities.textDocumentSync
    const save = typeof sync === 'object' ? sync.save : undefined
    if (this.initialized && save && this.documents.has(uri)) {
      this.notify('textDocument/didSave', { textDocument: { uri }, ...(typeof save === 'object' && save.includeText ? { text } : {}) })
    }
  }

  private syncModels(): void {
    const { editor } = this.options.monaco
    for (const model of editor.getModels()) this.openDocument(model)
    this.disposables.push(
      editor.onDidCreateModel(model => this.openDocument(model)),
      editor.onWillDisposeModel(model => this.closeDocument(model)),
      editor.onDidChangeModelLanguage(({ model }) => { this.closeDocument(model); this.openDocument(model) }),
    )
  }

  private async query<T>(model: editor.ITextModel, method: string, params: object, token: CancellationToken): Promise<T | undefined> {
    if (!this.tracks(model)) return
    this.openDocument(model)
    const version = model.getVersionId()
    const value = await this.request<T>(method, { ...params, textDocument: { uri: model.uri.toString() } }, token).catch(() => undefined)
    return this.stopped || token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version ? undefined : value
  }

  private async locations(model: editor.ITextModel, method: string, params: object, token: CancellationToken): Promise<languages.Location[]> {
    const version = model.getVersionId()
    const result = await this.query<unknown>(model, method, params, token)
    const locations = lspLocations(this.options.monaco, result)
    // Monaco's standalone Peek only knows models that have been loaded.
    const targets = [...new Map(locations.map(location => [location.uri.toString(), location.uri])).values()]
    await Promise.all(targets.slice(0, 20).map(uri => this.loadModel(uri).catch(() => undefined)))
    return !this.stopped && !token.isCancellationRequested && !model.isDisposed() && version === model.getVersionId() ? locations : []
  }

  private loadModel(uri: Uri): Promise<editor.ITextModel | undefined> {
    if (uri.scheme !== 'file') return Promise.resolve(undefined)
    const existing = this.options.monaco.editor.getModel(uri)
    return existing === null
      ? this.options.loadModel?.(uri, () => this.request<string>('dvw/readFile', { uri: uri.toString() })) ?? Promise.resolve(undefined)
      : Promise.resolve(existing)
  }

  private async workspaceEdit(value: LspWorkspaceEdit | null | undefined, token?: CancellationToken, preview = false): Promise<languages.WorkspaceEdit> {
    const targets: WorkspaceTarget[] = []
    if (value?.documentChanges === undefined) {
      for (const [uri, edits] of Object.entries(value?.changes ?? {})) targets.push({ uri: this.options.monaco.Uri.parse(uri), edits })
    }
    for (const change of value?.documentChanges ?? []) {
      if ('kind' in change) throw new Error('此操作包含工作台暂不支持的文件创建、移动或删除')
      targets.push({ uri: this.options.monaco.Uri.parse(change.textDocument.uri), version: change.textDocument.version, edits: change.edits })
    }
    const retained = this.options.retainEditModels?.(targets.map(target => target.uri))
    try { return await this.prepareTextEdits(targets, token, preview) }
    finally { retained?.dispose() }
  }

  private async prepareTextEdits(targets: WorkspaceTarget[], token: CancellationToken | undefined, preview: boolean): Promise<languages.WorkspaceEdit> {
    const files = await Promise.all(targets.map(async target => {
      const path = workspacePathFromModel(this.options.workspaceRoot, target.uri.toString())
      if (path === undefined) throw new Error('无法修改工作区以外的文件')
      const current = this.options.monaco.editor.getModel(target.uri)
      const version = current?.getVersionId()
      if (target.version != null && target.version !== version) throw new Error('文件已经变化，请重新执行操作')
      const model = current ?? await this.loadModel(target.uri)
      if (model === undefined || model.isDisposed()) throw new Error('无法读取重构涉及的文件')
      return { ...target, path, model, version: version ?? model.getVersionId() }
    }))
    if (this.stopped || token?.isCancellationRequested) throw new Error('操作已取消')
    const byFile = new Map<string, Array<{ start: number; end: number }>>()
    const edits = files.flatMap(file => file.edits.map(edit => {
      const range = editorRange(this.options.monaco, edit.range)
      const validated = file.model.validateRange(range)
      if (!range.equalsRange(validated) || file.model.getVersionId() !== file.version) throw new Error('文件已经变化，请重新执行操作')
      const intervals = byFile.get(file.path) ?? []
      intervals.push({ start: file.model.getOffsetAt(range.getStartPosition()), end: file.model.getOffsetAt(range.getEndPosition()) })
      byFile.set(file.path, intervals)
      return { resource: file.uri, textEdit: { range, text: edit.newText }, versionId: file.version }
    }))
    for (const intervals of byFile.values()) {
      intervals.sort((a, b) => a.start - b.start || a.end - b.end)
      if (intervals.some((interval, index) => index > 0 && interval.start < intervals[index - 1]!.end)) throw new Error('语言服务器返回了重叠的编辑')
    }
    if (preview && token !== undefined && byFile.size > 1 && this.options.previewRename !== undefined) {
      const accepted = await this.options.previewRename(files.map(file => ({
        path: file.path,
        changes: file.edits.map(edit => ({
          line: edit.range.start.line + 1, before: file.model.getValueInRange(editorRange(this.options.monaco, edit.range)), after: edit.newText,
        })),
      })), token)
      if (!accepted) return { edits: [] }
    }
    if (this.stopped || token?.isCancellationRequested) throw new Error('操作已取消')
    await this.options.trackWorkspaceEdits?.(files)
    if (this.stopped || token?.isCancellationRequested) throw new Error('操作已取消')
    if (files.some(file => file.model.isDisposed() || file.model.getVersionId() !== file.version)) throw new Error('文件已经变化，请重新执行操作')
    return { edits }
  }

  private applyEdit(workspaceEdit: languages.WorkspaceEdit): void {
    const models = new Map<editor.ITextModel, editor.ISingleEditOperation[]>()
    for (const edit of workspaceEdit.edits) {
      if (!('textEdit' in edit)) throw new Error('不支持此文件操作')
      const model = this.options.monaco.editor.getModel(edit.resource)
      if (model === null || model.getVersionId() !== edit.versionId) throw new Error('文件已经变化，请重新执行操作')
      const changes = models.get(model) ?? []
      changes.push({ range: edit.textEdit.range, text: edit.textEdit.text })
      models.set(model, changes)
    }
    for (const [model, edits] of models) {
      model.pushStackElement()
      model.pushEditOperations([], edits, () => [])
      model.pushStackElement()
    }
  }

  private registerProviders(): void {
    const { monaco, server } = this.options
    const capabilities = this.capabilities
    const add = (disposable: IDisposable | undefined) => { if (disposable !== undefined) this.disposables.push(disposable) }
    const at = (position: Position) => ({ position: toLspPosition(position) })
    const formats = (edits: LspTextEdit[] | null | undefined) => (edits ?? []).map(edit => ({ range: editorRange(monaco, edit.range), text: edit.newText }))
    const fetchCompletion = new WeakMap<languages.CompletionItem, { raw: LspCompletion; model: editor.ITextModel; version: number }>()
    const fetchHint = new WeakMap<languages.InlayHint, { raw: LspInlayHint; model: editor.ITextModel; version: number }>()
    const fetchAction = new WeakMap<languages.CodeAction, { raw: LspCodeAction; model: editor.ITextModel; version: number }>()
    const commandId = `dvw.lsp.execute.${server.id}`
    const actionCommandId = `${commandId}.action`
    const command = (raw?: LspCommand): languages.Command | undefined => {
      if (raw === undefined || !capabilities.executeCommandProvider?.commands.includes(raw.command)) return undefined
      return { id: commandId, title: raw.title, arguments: [raw] }
    }
    const inlayHint = (raw: LspInlayHint): languages.InlayHint => ({
      label: typeof raw.label === 'string' ? raw.label : raw.label.map(part => ({
        label: part.value, tooltip: markup(part.tooltip), command: command(part.command),
        location: part.location === undefined ? undefined : lspLocations(monaco, part.location)[0],
      })),
      position: { lineNumber: raw.position.line + 1, column: raw.position.character + 1 },
      kind: raw.kind, tooltip: markup(raw.tooltip), textEdits: raw.textEdits?.map(edit => ({ range: editorRange(monaco, edit.range), text: edit.newText })),
      paddingLeft: raw.paddingLeft, paddingRight: raw.paddingRight,
    })
    if (capabilities.executeCommandProvider !== undefined) {
      add(monaco.editor.registerCommand(commandId, async (_accessor, value: LspCommand) => {
        if (!capabilities.executeCommandProvider?.commands.includes(value.command)) return
        return this.request('workspace/executeCommand', { command: value.command, arguments: value.arguments })
      }))
    }
    for (const language of server.languages) {
      add(disableBuiltin(monaco, language, capabilities))
      const selector = { language, scheme: 'file' }
      if (capabilities.definitionProvider) add(monaco.languages.registerDefinitionProvider(selector, {
        provideDefinition: (model, pos, token) => this.locations(model, 'textDocument/definition', at(pos), token),
      }))
      if (capabilities.declarationProvider) add(monaco.languages.registerDeclarationProvider(selector, {
        provideDeclaration: (model, pos, token) => this.locations(model, 'textDocument/declaration', at(pos), token),
      }))
      if (capabilities.typeDefinitionProvider) add(monaco.languages.registerTypeDefinitionProvider(selector, {
        provideTypeDefinition: (model, pos, token) => this.locations(model, 'textDocument/typeDefinition', at(pos), token),
      }))
      if (capabilities.implementationProvider) add(monaco.languages.registerImplementationProvider(selector, {
        provideImplementation: (model, pos, token) => this.locations(model, 'textDocument/implementation', at(pos), token),
      }))
      if (capabilities.referencesProvider) add(monaco.languages.registerReferenceProvider(selector, {
        provideReferences: (model, pos, context, token) => this.locations(model, 'textDocument/references', { ...at(pos), context }, token),
      }))
      if (capabilities.completionProvider) add(monaco.languages.registerCompletionItemProvider(selector, {
        triggerCharacters: capabilities.completionProvider.triggerCharacters,
        provideCompletionItems: async (model, pos, context, token) => {
          const result = await this.query<LspCompletion[] | { items: LspCompletion[]; isIncomplete?: boolean; itemDefaults?: CompletionDefaults } | null>(
            model, 'textDocument/completion', {
              ...at(pos),
              context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter },
            }, token)
          if (result == null) return undefined
          const list = Array.isArray(result) ? { items: result } : result
          const word = model.getWordUntilPosition(pos)
          const fallback = new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn)
          return { incomplete: list.isIncomplete, suggestions: list.items.filter(raw => typeof raw?.label === 'string').map(raw => {
            const item = completionItem(monaco, raw, fallback, list.itemDefaults)
            fetchCompletion.set(item, { raw: { ...raw, data: raw.data ?? list.itemDefaults?.data }, model, version: model.getVersionId() })
            item.command = command(raw.command)
            return item
          }) }
        },
        resolveCompletionItem: capabilities.completionProvider.resolveProvider ? async (item, token) => {
          const original = fetchCompletion.get(item)
          if (original === undefined || original.model.isDisposed() || original.model.getVersionId() !== original.version) return item
          const result = await this.request<LspCompletion | null>('completionItem/resolve', original.raw, token).catch(() => null)
          if (result === null || token.isCancellationRequested || original.model.isDisposed() || original.model.getVersionId() !== original.version) return item
          return {
            ...item,
            detail: result.detail ?? item.detail,
            documentation: markup(result.documentation) ?? item.documentation,
            additionalTextEdits: result.additionalTextEdits === undefined ? item.additionalTextEdits : formats(result.additionalTextEdits),
            command: command(result.command) ?? item.command,
          }
        } : undefined,
      }))
      if (capabilities.signatureHelpProvider) add(monaco.languages.registerSignatureHelpProvider(selector, {
        signatureHelpTriggerCharacters: capabilities.signatureHelpProvider.triggerCharacters,
        signatureHelpRetriggerCharacters: capabilities.signatureHelpProvider.retriggerCharacters,
        provideSignatureHelp: async (model, pos, token, context) => {
          type Signature = { label: string; documentation?: unknown; parameters?: { label: string | [number, number]; documentation?: unknown }[]; activeParameter?: number }
          const result = await this.query<{ signatures: Signature[]; activeSignature?: number; activeParameter?: number } | null>(
            model, 'textDocument/signatureHelp', { ...at(pos), context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger, activeSignatureHelp: context.activeSignatureHelp } }, token)
          if (!result?.signatures.length) return undefined
          return {
            value: {
              signatures: result.signatures.map(signature => ({
                label: signature.label, documentation: markup(signature.documentation),
                parameters: (signature.parameters ?? []).map(parameter => ({ label: parameter.label, documentation: markup(parameter.documentation) })),
              })),
              activeSignature: result.activeSignature ?? 0,
              activeParameter: result.signatures[result.activeSignature ?? 0]?.activeParameter ?? result.activeParameter ?? 0,
            },
            dispose() {},
          }
        },
      }))
      if (capabilities.hoverProvider) add(monaco.languages.registerHoverProvider(selector, {
        provideHover: async (model, pos, token) => {
          const result = await this.query<{ contents: unknown; range?: LspRange } | null>(model, 'textDocument/hover', at(pos), token)
          if (result == null) return undefined
          const contents = (Array.isArray(result.contents) ? result.contents : [result.contents]).flatMap(value => markup(value) ?? [])
          return contents.length === 0 ? undefined : { contents, range: result.range === undefined ? undefined : editorRange(monaco, result.range) }
        },
      }))
      if (capabilities.documentFormattingProvider) add(monaco.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: async (model, options, token) =>
          formats(await this.query<LspTextEdit[]>(model, 'textDocument/formatting', { options }, token)),
      }))
      if (capabilities.documentRangeFormattingProvider) add(monaco.languages.registerDocumentRangeFormattingEditProvider(selector, {
        provideDocumentRangeFormattingEdits: async (model, range, options, token) =>
          formats(await this.query<LspTextEdit[]>(model, 'textDocument/rangeFormatting', { range: toLspRange(range), options }, token)),
      }))
      if (capabilities.renameProvider) add(monaco.languages.registerRenameProvider(selector, {
        resolveRenameLocation: typeof capabilities.renameProvider === 'object' && capabilities.renameProvider.prepareProvider
          ? async (model, pos, token) => {
            const result = await this.query<LspRange | { range: LspRange; placeholder: string } | { defaultBehavior: boolean } | null>(model, 'textDocument/prepareRename', at(pos), token)
            if (result == null) return { range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: '', rejectReason: '此处无法重命名' }
            if ('defaultBehavior' in result) return undefined
            const range = editorRange(monaco, 'range' in result ? result.range : result)
            return { range, text: 'placeholder' in result ? result.placeholder : model.getValueInRange(range) }
          } : undefined,
        provideRenameEdits: async (model, pos, newName, token) => {
          try {
            const result = await this.query<LspWorkspaceEdit | null>(model, 'textDocument/rename', { ...at(pos), newName }, token)
            return result == null ? { edits: [], rejectReason: '语言服务器未返回重命名更改' } : await this.workspaceEdit(result, token, true)
          } catch (error) {
            return { edits: [], rejectReason: String(error) }
          }
        },
      }))
      if (capabilities.codeActionProvider) add(monaco.languages.registerCodeActionProvider(selector, {
        provideCodeActions: async (model, range, context, token) => {
          const diagnostics = this.documents.get(model.uri.toString())?.diagnostics.filter(item => monaco.Range.areIntersectingOrTouching(range, editorRange(monaco, item.range))) ?? []
          const raw = await this.query<(LspCodeAction | LspCommand)[] | null>(model, 'textDocument/codeAction', {
            range: toLspRange(range), context: { diagnostics, only: context.only ? [context.only] : undefined, triggerKind: context.trigger },
          }, token)
          const actions = (raw ?? []).map(item => {
            if (typeof item.command === 'string') {
              const executable = command(item as LspCommand)
              return executable === undefined ? undefined : { title: item.title, command: executable }
            }
            const action = item as LspCodeAction
            const converted: languages.CodeAction = { title: action.title, kind: action.kind, isPreferred: action.isPreferred, disabled: action.disabled?.reason, command: command(action.command) }
            if (action.edit !== undefined) {
              // Resolve file contents only when the action is selected, never while showing the lightbulb.
              converted.command = { id: actionCommandId, title: action.title, arguments: [action, model, model.getVersionId()] }
            } else {
              fetchAction.set(converted, { raw: action, model, version: model.getVersionId() })
            }
            return converted
          })
          return { actions: actions.filter(action => action !== undefined), dispose() {} }
        },
        resolveCodeAction: typeof capabilities.codeActionProvider === 'object' && capabilities.codeActionProvider.resolveProvider ? async (action, token) => {
          const original = fetchAction.get(action)
          if (original === undefined || original.model.isDisposed() || original.model.getVersionId() !== original.version) return action
          const resolved = await this.request<LspCodeAction | null>('codeAction/resolve', original.raw, token).catch(() => null)
          if (resolved === null || token.isCancellationRequested) return action
          if (resolved.edit === undefined) return { ...action, command: command(resolved.command) ?? action.command }
          return { ...action, command: { id: actionCommandId, title: action.title, arguments: [resolved, original.model, original.version] } }
        } : undefined,
      }, { providedCodeActionKinds: typeof capabilities.codeActionProvider === 'object' ? capabilities.codeActionProvider.codeActionKinds : undefined }))
      if (capabilities.inlayHintProvider) add(monaco.languages.registerInlayHintsProvider(selector, {
        provideInlayHints: async (model, range, token) => {
          const hints = await this.query<LspInlayHint[] | null>(model, 'textDocument/inlayHint', { range: toLspRange(range) }, token)
          return { hints: (hints ?? []).map(raw => {
            const hint = inlayHint(raw)
            fetchHint.set(hint, { raw, model, version: model.getVersionId() })
            return hint
          }), dispose() {} }
        },
        resolveInlayHint: typeof capabilities.inlayHintProvider === 'object' && capabilities.inlayHintProvider.resolveProvider
          ? async (hint, token) => {
            const original = fetchHint.get(hint)
            if (original === undefined || original.model.isDisposed() || original.model.getVersionId() !== original.version) return hint
            const resolved = await this.request<LspInlayHint>('inlayHint/resolve', original.raw, token).catch(() => undefined)
            return resolved == null || token.isCancellationRequested || original.model.isDisposed() || original.model.getVersionId() !== original.version
              ? hint : inlayHint(resolved)
          } : undefined,
      }))
      const semanticTokens = capabilities.semanticTokensProvider
      type TokenResult = { data: number[]; resultId?: string }
      if (semanticTokens?.full) add(monaco.languages.registerDocumentSemanticTokensProvider(selector, {
        getLegend: () => semanticTokens.legend,
        provideDocumentSemanticTokens: async (model, _last, token) => {
          const result = await this.query<TokenResult | null>(model, 'textDocument/semanticTokens/full', {}, token)
          return result == null ? undefined : { data: Uint32Array.from(result.data), resultId: result.resultId }
        },
        releaseDocumentSemanticTokens() {},
      }))
      if (semanticTokens?.range) add(monaco.languages.registerDocumentRangeSemanticTokensProvider(selector, {
        getLegend: () => semanticTokens.legend,
        provideDocumentRangeSemanticTokens: async (model, range, token) => {
          const result = await this.query<TokenResult | null>(model, 'textDocument/semanticTokens/range', { range: toLspRange(range) }, token)
          return result == null ? undefined : { data: Uint32Array.from(result.data), resultId: result.resultId }
        },
      }))
      if (capabilities.documentSymbolProvider) add(monaco.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols: (model, token) => this.documentSymbols(model, token),
      }))
    }
    if (capabilities.codeActionProvider) add(monaco.editor.registerCommand(actionCommandId, async (_accessor, action: LspCodeAction, model: editor.ITextModel, version: number) => {
      if (model.isDisposed() || model.getVersionId() !== version) throw new Error('文件已经变化，请重新执行操作')
      if (action.edit !== undefined) this.applyEdit(await this.workspaceEdit(action.edit))
      if (command(action.command) !== undefined) await this.request('workspace/executeCommand', { command: action.command!.command, arguments: action.command!.arguments })
    }))
  }

  async documentSymbols(model: editor.ITextModel, token: CancellationToken): Promise<languages.DocumentSymbol[]> {
    if (!this.capabilities.documentSymbolProvider) return []
    const { monaco } = this.options
    const convert = (symbol: LspSymbol): languages.DocumentSymbol => {
      const range = editorRange(monaco, symbol.range ?? symbol.location!.range)
      return {
        name: symbol.name, detail: symbol.detail ?? '', kind: Math.max(0, symbol.kind - 1),
        tags: symbol.deprecated || symbol.tags?.includes(1) ? [monaco.languages.SymbolTag.Deprecated] : [],
        range, selectionRange: symbol.selectionRange === undefined ? range : editorRange(monaco, symbol.selectionRange),
        children: symbol.children?.map(convert), containerName: symbol.containerName,
      }
    }
    return (await this.query<LspSymbol[] | null>(model, 'textDocument/documentSymbol', {}, token) ?? []).map(convert)
  }
}

interface LspSymbol {
  name: string
  detail?: string
  kind: number
  range?: LspRange
  selectionRange?: LspRange
  location?: { range: LspRange }
  tags?: number[]
  deprecated?: boolean
  containerName?: string
  children?: LspSymbol[]
}

interface Runtime {
  server: LspServerStatus
  connection?: LspConnection
  retry?: ReturnType<typeof setTimeout>
  attempts: number
}

export class LspManager {
  private runtimes = new Map<string, Runtime>()
  private subscriptions: IDisposable[]

  constructor(private readonly monaco: Monaco, private sessionId: string, private readonly workspaceRoot: string, private readonly options: LspOptions = {}) {
    this.subscriptions = [
      monaco.editor.onDidCreateModel(model => this.activate(model)),
      monaco.editor.onDidChangeModelLanguage(({ model }) => this.activate(model)),
    ]
  }

  sync(servers: LspServerStatus[], sessionId: string): void {
    this.sessionId = sessionId
    const installed = new Map(servers.filter(server => server.installed).map(server => [server.id, server]))
    for (const id of this.runtimes.keys()) if (!installed.has(id)) this.stop(id)
    for (const [id, server] of installed) {
      const runtime = this.runtimes.get(id)
      if (runtime === undefined) this.runtimes.set(id, { server, attempts: 0 })
      else {
        const previousTools = runtime.server.shellTools
        runtime.server = server
        if (runtime.connection !== undefined && (previousTools?.shfmt !== server.shellTools?.shfmt
          || previousTools?.shellcheck !== server.shellTools?.shellcheck)) this.restart(id)
      }
    }
    for (const model of this.monaco.editor.getModels()) this.activate(model)
  }

  private activate(model: editor.ITextModel): void {
    if (model.uri.scheme !== 'file' || workspacePathFromModel(this.workspaceRoot, model.uri.toString()) === undefined) return
    for (const runtime of this.runtimes.values()) {
      if (runtime.server.languages.includes(model.getLanguageId()) && runtime.connection === undefined && runtime.retry === undefined && runtime.attempts <= 3) this.start(runtime)
    }
  }

  private start(runtime: Runtime): void {
    const { server } = runtime
    let readyAt: number | undefined
    const disconnected = (error: Error) => {
      if (this.runtimes.get(server.id) !== runtime || runtime.connection !== connection) return
      runtime.connection = undefined
      connection.stop()
      if (readyAt !== undefined && Date.now() - readyAt > 30_000) runtime.attempts = 0
      runtime.attempts++
      if (runtime.attempts > 3) {
        this.options.onStatus?.(server.id, { state: 'failed', message: error.message })
        return
      }
      this.options.onStatus?.(server.id, { state: 'reconnecting', message: error.message })
      runtime.retry = setTimeout(() => {
        runtime.retry = undefined
        if (this.runtimes.get(server.id) === runtime) this.start(runtime)
      }, 500 * 2 ** (runtime.attempts - 1))
    }
    const connection = new LspConnection({ ...this.options, monaco: this.monaco, sessionId: this.sessionId, workspaceRoot: this.workspaceRoot, server, disconnected })
    runtime.connection = connection
    this.options.onStatus?.(server.id, { state: 'starting' })
    void connection.start().then(() => {
      if (runtime.connection !== connection) return
      readyAt = Date.now()
      this.options.onStatus?.(server.id, { state: 'ready' })
    }).catch(error => disconnected(error instanceof Error ? error : new Error(String(error))))
  }

  async documentSymbols(uri: Uri, token: CancellationToken): Promise<languages.DocumentSymbol[]> {
    const model = this.monaco.editor.getModel(uri)
    if (model === null) return []
    const runtime = [...this.runtimes.values()].find(entry => entry.server.languages.includes(model.getLanguageId()))
    return await runtime?.connection?.documentSymbols(model, token) ?? []
  }

  saved(uri: string, text: string): void {
    for (const runtime of this.runtimes.values()) runtime.connection?.saved(uri, text)
  }

  restart(id: string): void {
    const runtime = this.runtimes.get(id)
    if (runtime === undefined) return
    this.stop(id)
    this.runtimes.set(id, { server: runtime.server, attempts: 0 })
    for (const model of this.monaco.editor.getModels()) this.activate(model)
  }

  private stop(id: string): void {
    const runtime = this.runtimes.get(id)
    if (runtime === undefined) return
    this.runtimes.delete(id)
    clearTimeout(runtime.retry)
    runtime.connection?.stop()
    this.options.onStatus?.(id, undefined)
  }

  dispose(): void {
    for (const disposable of this.subscriptions.splice(0)) disposable.dispose()
    for (const id of this.runtimes.keys()) this.stop(id)
  }
}
