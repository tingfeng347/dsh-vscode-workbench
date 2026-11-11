/** Minimal Language Server Protocol client that rides a WebSocket bridge to a host-spawned server. */
import { websocketUrl } from './websocket.ts'

type Monaco = typeof import('monaco-editor')

/** One language server as reported by the host catalog. */
export interface LspServerStatus {
  id: string
  name: string
  languages: string[]
  installable: boolean
  installed: boolean
  hint?: string
  command?: string
  /** Manual servers report the language toolchain next to the server so the two are not confused. */
  language?: { name: string; installed: boolean }
}

interface Pending { resolve(value: unknown): void; reject(error: unknown): void }

/** LSP CompletionItemKind and SymbolKind share the numeric layout 1–25; Monaco's enums differ, so map explicitly. */
const COMPLETION_KIND: Record<number, import('monaco-editor').languages.CompletionItemKind> = {
  1: 17, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 18, 15: 14, 16: 15, 17: 16, 18: 19, 19: 20, 20: 21, 21: 22, 22: 23, 23: 24, 24: 25, 25: 6,
}

const SEVERITY: Record<number, import('monaco-editor').MarkerSeverity> = { 1: 8, 2: 4, 3: 2, 4: 1 }

function position(monaco: Monaco, value: import('monaco-editor').Position) {
  return { line: value.lineNumber - 1, character: value.column - 1 }
}

function range(monaco: Monaco, value: { start: { line: number; character: number }; end: { line: number; character: number } }) {
  const start = { lineNumber: value.start.line + 1, column: value.start.character + 1 }
  const end = { lineNumber: value.end.line + 1, column: value.end.character + 1 }
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
}

function hoverText(contents: unknown): string {
  const one = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (value !== null && typeof value === 'object') {
      const item = value as { value?: unknown; language?: unknown }
      if (typeof item.value === 'string') return item.language === undefined ? item.value : `\`\`\`${String(item.language)}\n${item.value}\n\`\`\``
    }
    return ''
  }
  return Array.isArray(contents) ? contents.map(one).filter(Boolean).join('\n\n') : one(contents)
}

/** Normalize definition/reference payloads (Location, LocationLink or arrays) into Monaco locations. */
export function lspLocations(monaco: Monaco, result: unknown): import('monaco-editor').languages.Location[] {
  if (result === null || result === undefined) return []
  const items = Array.isArray(result) ? result : [result]
  return items.flatMap(item => {
    if (item === null || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    const uri = typeof value.uri === 'string' ? value.uri : typeof value.targetUri === 'string' ? value.targetUri : undefined
    const at = (value.targetSelectionRange ?? value.range ?? value.targetRange) as Parameters<typeof range>[1] | undefined
    if (uri === undefined || at === undefined || typeof at !== 'object') return []
    try { return [{ uri: monaco.Uri.parse(uri), range: range(monaco, at) }] } catch { return [] }
  })
}

interface ConnectionOptions { monaco: Monaco; sessionId: string; workspaceRoot: string; status: LspServerStatus }

class LspConnection {
  private socket: WebSocket | undefined
  private nextId = 1
  private pending = new Map<number, Pending>()
  private versions = new Map<string, number>()
  private disposables: { dispose(): void }[] = []
  private closed = false

  constructor(private readonly options: ConnectionOptions) {}

  get languages(): string[] { return this.options.status.languages }

  /** Open the bridge, run the initialize handshake and register Monaco providers for the server's languages. */
  async start(): Promise<void> {
    const url = websocketUrl(`/dsh-vscode/ws/lsp?${new URLSearchParams({ sessionId: this.options.sessionId, server: this.options.status.id })}`)
    if (url === undefined) throw new Error('无法连接语言服务器：工作台地址未知')
    const socket = this.socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('语言服务器连接失败')), { once: true })
      socket.addEventListener('close', event => reject(new Error(event.reason || '语言服务器已关闭')), { once: true })
    })
    socket.addEventListener('message', event => this.receive(String(event.data)))
    socket.addEventListener('close', () => { this.closed = true; this.failPending() })
    await this.request('initialize', {
      processId: null, rootUri: this.options.monaco.Uri.file(this.options.workspaceRoot).toString(), rootPath: this.options.workspaceRoot,
      workspaceFolders: [{ uri: this.options.monaco.Uri.file(this.options.workspaceRoot).toString(), name: this.options.workspaceRoot.split(/[\\/]/).pop() ?? '' }],
      capabilities: { workspace: { workspaceFolders: true, configuration: true }, textDocument: { synchronization: { dynamicRegistration: false }, completion: { completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] } }, hover: { contentFormat: ['markdown', 'plaintext'] }, signatureHelp: {}, definition: { linkSupport: true }, references: {}, publishDiagnostics: { versionSupport: true } } },
    })
    this.notify('initialized', {})
    this.registerProviders()
    this.syncModels()
  }

  stop(): void {
    this.closed = true
    this.failPending()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    this.socket?.close()
    this.socket = undefined
  }

  private failPending(): void { for (const pending of this.pending.values()) pending.reject(new Error('语言服务器连接已关闭')); this.pending.clear() }

  private send(message: unknown): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)) }

  private notify(method: string, params: unknown): void { this.send({ jsonrpc: '2.0', method, params }) }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private receive(raw: string): void {
    let message: Record<string, unknown>
    try { message = JSON.parse(raw) as Record<string, unknown> } catch { return }
    if (typeof message.id === 'number' && message.method === undefined) {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) pending.reject(new Error((message.error as { message?: string }).message ?? 'language server error'))
      else pending.resolve(message.result)
      return
    }
    const method = typeof message.method === 'string' ? message.method : ''
    if (message.id !== undefined) {
      // Server-to-client requests we cannot serve yet; answer so the server never stalls.
      if (method === 'workspace/configuration') this.send({ jsonrpc: '2.0', id: message.id, result: [] })
      else if (method === 'workspace/applyEdit') this.send({ jsonrpc: '2.0', id: message.id, result: { applied: false } })
      else this.send({ jsonrpc: '2.0', id: message.id, result: null })
      return
    }
    if (method === 'textDocument/publishDiagnostics') this.publishDiagnostics(message.params as { uri: string; diagnostics: unknown[] })
  }

  private publishDiagnostics(params: { uri: string; diagnostics: unknown[] }): void {
    const monaco = this.options.monaco
    const uri = monaco.Uri.parse(params.uri).toString()
    const model = monaco.editor.getModel(monaco.Uri.parse(params.uri)) ?? monaco.editor.getModels().find(candidate => candidate.uri.toString() === uri)
    if (model === null || model === undefined) return
    const diagnostics = (params.diagnostics ?? []).map(item => {
      const diagnostic = item as { range: Parameters<typeof range>[1]; severity?: number; message: string; source?: string; code?: string | number }
      return {
        severity: SEVERITY[diagnostic.severity ?? 1] ?? 8,
        message: diagnostic.message,
        source: diagnostic.source,
        code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
        startLineNumber: diagnostic.range.start.line + 1, startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1, endColumn: diagnostic.range.end.character + 1,
      }
    })
    monaco.editor.setModelMarkers(model, 'lsp', diagnostics)
  }

  private registerProviders(): void {
    const monaco = this.options.monaco
    const params = (model: import('monaco-editor').editor.ITextModel, positionValue: import('monaco-editor').Position) => ({ textDocument: { uri: model.uri.toString() }, position: position(monaco, positionValue) })
    for (const language of this.languages) {
      this.disposables.push(
        monaco.languages.registerDefinitionProvider(language, {
          provideDefinition: async (model, positionValue, token) => token.isCancellationRequested ? [] : lspLocations(monaco, await this.request('textDocument/definition', params(model, positionValue)).catch(() => null)),
        }),
        monaco.languages.registerReferenceProvider(language, {
          provideReferences: async (model, positionValue, context, token) => token.isCancellationRequested ? [] : lspLocations(monaco, await this.request('textDocument/references', { ...params(model, positionValue), context: { includeDeclaration: context.includeDeclaration } }).catch(() => null)),
        }),
        monaco.languages.registerCompletionItemProvider(language, {
          triggerCharacters: ['.', ':', '(', '[', ' ', '/', '<'],
          provideCompletionItems: async (model, positionValue) => {
            const result = await this.request('textDocument/completion', params(model, positionValue)).catch(() => null) as { items?: unknown[] } | unknown[] | null
            const items = Array.isArray(result) ? result : result?.items ?? []
            const word = model.getWordUntilPosition(positionValue)
            const defaultRange = new monaco.Range(positionValue.lineNumber, word.startColumn, positionValue.lineNumber, word.endColumn)
            return { suggestions: items.flatMap(item => {
              if (item === null || typeof item !== 'object') return []
              const entry = item as { label: string | { label: string }; kind?: number; detail?: string; documentation?: unknown; insertText?: string; textEdit?: { newText?: string } }
              const label = typeof entry.label === 'string' ? entry.label : entry.label.label
              const text = entry.textEdit?.newText ?? entry.insertText ?? label
              return [{ label, kind: COMPLETION_KIND[entry.kind ?? 1] ?? 0, detail: entry.detail, documentation: entry.documentation === undefined ? undefined : hoverText(entry.documentation), insertText: text, range: defaultRange }]
            }) }
          },
        }),
        monaco.languages.registerSignatureHelpProvider(language, {
          signatureHelpTriggerCharacters: ['(', ',', '['],
          provideSignatureHelp: async (model, positionValue) => {
            const result = await this.request('textDocument/signatureHelp', params(model, positionValue)).catch(() => null) as { signatures?: { label: string; documentation?: unknown; parameters?: { label: string | [number, number] }[] }[]; activeSignature?: number; activeParameter?: number } | null
            if (result === null || result.signatures === undefined || result.signatures.length === 0) return undefined
            return {
              value: {
                signatures: result.signatures.map(signature => ({
                  label: signature.label,
                  documentation: signature.documentation === undefined ? undefined : hoverText(signature.documentation),
                  parameters: (signature.parameters ?? []).map(parameter => ({ label: typeof parameter.label === 'string' ? parameter.label : signature.label.slice(parameter.label[0], parameter.label[1]) })),
                })),
                activeSignature: result.activeSignature ?? 0,
                activeParameter: result.activeParameter ?? 0,
              },
              dispose() {},
            }
          },
        }),
        monaco.languages.registerHoverProvider(language, {
          provideHover: async (model, positionValue) => {
            const result = await this.request('textDocument/hover', params(model, positionValue)).catch(() => null) as { contents?: unknown; range?: Parameters<typeof range>[1] } | null
            const value = result?.contents === undefined ? '' : hoverText(result.contents)
            return value === '' ? undefined : { contents: [{ value }], range: result?.range === undefined ? undefined : range(monaco, result.range) }
          },
        }),
      )
    }
  }

  /** Open every existing model of this server's languages and follow new, edited and disposed models. */
  private syncModels(): void {
    const monaco = this.options.monaco
    const open = (model: import('monaco-editor').editor.ITextModel) => {
      if (!this.languages.includes(model.getLanguageId())) return
      const uri = model.uri.toString()
      if (this.versions.has(uri)) return
      this.versions.set(uri, 1)
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: model.getLanguageId(), version: 1, text: model.getValue() } })
      this.disposables.push(model.onDidChangeContent(() => {
        const version = (this.versions.get(uri) ?? 1) + 1
        this.versions.set(uri, version)
        this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text: model.getValue() }] })
      }))
    }
    for (const model of monaco.editor.getModels()) open(model)
    this.disposables.push(
      monaco.editor.onDidCreateModel(model => open(model)),
      monaco.editor.onWillDisposeModel(model => {
        const uri = model.uri.toString()
        if (!this.versions.delete(uri)) return
        this.notify('textDocument/didClose', { textDocument: { uri } })
        monaco.editor.setModelMarkers(model, 'lsp', [])
      }),
    )
  }
}

export class LspManager {
  private connections = new Map<string, LspConnection>()
  private failures = new Map<string, string>()

  constructor(private readonly monaco: Monaco, private readonly sessionId: string, private readonly workspaceRoot: string) {}

  /** Start servers that are installed and not already running; stop any that were uninstalled. */
  async sync(servers: LspServerStatus[]): Promise<string[]> {
    const messages: string[] = []
    for (const server of servers) {
      if (!server.installed) { this.stop(server.id); continue }
      if (this.connections.has(server.id)) continue
      const connection = new LspConnection({ monaco: this.monaco, sessionId: this.sessionId, workspaceRoot: this.workspaceRoot, status: server })
      this.connections.set(server.id, connection)
      try { await connection.start(); this.failures.delete(server.id) }
      catch (error) {
        this.connections.delete(server.id); connection.stop()
        const message = error instanceof Error ? error.message : String(error)
        if (this.failures.get(server.id) !== message) { this.failures.set(server.id, message); messages.push(`${server.name}：${message}`) }
      }
    }
    const installed = new Set(servers.filter(server => server.installed).map(server => server.id))
    for (const id of [...this.connections.keys()]) if (!installed.has(id)) this.stop(id)
    return messages
  }

  stop(id: string): void {
    this.connections.get(id)?.stop()
    this.connections.delete(id)
  }

  dispose(): void { for (const id of [...this.connections.keys()]) this.stop(id) }
}

/** Language server that handles a workspace path, derived from its extension or well-known filename. */
export function languageServerIdForPath(path: string): string | undefined {
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile'
  const extension = name.includes('.') ? name.split('.').at(-1) : undefined
  if (extension === undefined) return undefined
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(extension)) return 'typescript'
  if (extension === 'py' || extension === 'pyi') return 'python'
  if (extension === 'php') return 'php'
  if (['sh', 'bash', 'zsh', 'ksh'].includes(extension)) return 'shell'
  if (extension === 'yaml' || extension === 'yml') return 'yaml'
  if (extension === 'json' || extension === 'jsonc') return 'json'
  if (['css', 'scss', 'less'].includes(extension)) return 'css'
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'go') return 'go'
  if (extension === 'rs') return 'rust'
  if (['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx'].includes(extension)) return 'cpp'
  if (extension === 'java') return 'java'
  if (extension === 'cs') return 'csharp'
  if (extension === 'lua') return 'lua'
  return undefined
}
