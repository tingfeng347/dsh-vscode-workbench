import type { TerminalInfo } from '../terminal.ts'
import { ApiError, withSessionRetry } from './api.ts'
import { websocketUrl } from './websocket.ts'

export interface TerminalConnection {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
  subscribe(listener: (output: { sequence: number; data: string; replay?: boolean }) => void): () => void
  subscribeError(listener: (message: string) => void): () => void
}

export interface TerminalWorkspaceSnapshot { terminals: readonly TerminalInfo[]; loading: boolean; error?: string }

/** Browser client for the workbench's local terminal transport. */
export interface TerminalWorkspace {
  refresh(): Promise<boolean>
  create(title?: string): Promise<TerminalInfo>
  close(id: string): Promise<void>
  rename(id: string, title: string): Promise<void>
  connect(id: string): TerminalConnection
  getSnapshot(): TerminalWorkspaceSnapshot
  subscribe(listener: () => void): () => void
}

async function request<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/dsh-vscode-terminal/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await response.text()
  let answer: { ok?: boolean; value?: T; error?: { code?: string; message?: string } }
  try { answer = JSON.parse(text) as { ok?: boolean; value?: T; error?: { code?: string; message?: string } } } catch { throw new Error(`terminal request returned invalid JSON (${response.status})`) }
  if (!response.ok || answer.ok !== true) throw new ApiError(answer.error?.code ?? 'terminal-request-failed', answer.error?.message ?? 'terminal request failed')
  return answer.value as T
}

class SocketConnection implements TerminalConnection {
  private readonly socket: WebSocket
  private readonly listeners = new Set<(output: { sequence: number; data: string; replay?: boolean }) => void>()
  private readonly errorListeners = new Set<(message: string) => void>()
  private closed = false
  private queue: string[] = []

  constructor(sessionId: string, id: string) {
    const url = websocketUrl(`/dsh-vscode-terminal/ws?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}`)
    if (url === undefined) throw new Error('无法连接终端：桌面端没有发布本地 Host 地址')
    this.socket = new WebSocket(url)
    this.socket.onopen = () => { for (const value of this.queue) this.socket.send(value); this.queue = [] }
    this.socket.onerror = () => { for (const listener of this.errorListeners) listener('终端 WebSocket 连接失败') }
    this.socket.onclose = () => { if (!this.closed) for (const listener of this.errorListeners) listener('终端 WebSocket 连接已断开') }
    this.socket.onmessage = event => {
      try {
        const value = JSON.parse(String(event.data)) as { type?: unknown; sequence?: unknown; data?: unknown }
        if (typeof value.sequence !== 'number' || typeof value.data !== 'string') return
        for (const listener of this.listeners) listener({ sequence: value.sequence, data: value.data, replay: value.type === 'replay' })
      } catch { /* Ignore malformed WebSocket messages from a disconnected server. */ }
    }
  }

  private send(value: unknown): void { const text = JSON.stringify(value); if (this.socket.readyState === WebSocket.OPEN) this.socket.send(text); else this.queue.push(text) }
  write(data: string): void { this.send({ type: 'input', data }) }
  resize(cols: number, rows: number): void { this.send({ type: 'resize', cols, rows }) }
  close(): void { this.closed = true; this.socket.close() }
  subscribe(listener: (output: { sequence: number; data: string; replay?: boolean }) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  subscribeError(listener: (message: string) => void): () => void { this.errorListeners.add(listener); return () => this.errorListeners.delete(listener) }
}

/** Identify automatic terminal-emulator replies that must not be echoed during replay. */
export function isTerminalProtocolReply(data: string): boolean {
  return /^\x1b\](?:10|11|12);(?:rgb:[\da-f]{4}\/[\da-f]{4}\/[\da-f]{4}|#[\da-f]{6})(?:\x07|\x1b\\)$/i.test(data)
    || /^\x1b\[\??[\d;]*[cR]$/.test(data)
}

/** Maintain one terminal collection for a DSH session. */
export class TerminalWorkspaceController implements TerminalWorkspace {
  private snapshot: TerminalWorkspaceSnapshot = { terminals: [], loading: false }
  private readonly listeners = new Set<() => void>()

  constructor(private readonly sessionId: string) {}

  async refresh(): Promise<boolean> {
    this.set({ ...this.snapshot, loading: true, error: undefined })
    try {
      this.set({ terminals: await withSessionRetry(() => request<TerminalInfo[]>('list', { sessionId: this.sessionId })), loading: false })
      return true
    } catch (error) {
      this.set({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  async create(title?: string): Promise<TerminalInfo> {
    try { const terminal = await withSessionRetry(() => request<TerminalInfo>('create', { sessionId: this.sessionId, ...(title === undefined ? {} : { title }) })); await this.refresh(); return terminal }
    catch (error) { this.set({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : String(error) }); throw error }
  }
  async close(id: string): Promise<void> { await withSessionRetry(() => request('close', { sessionId: this.sessionId, id })); await this.refresh() }
  async rename(id: string, title: string): Promise<void> { await withSessionRetry(() => request('rename', { sessionId: this.sessionId, id, title })); await this.refresh() }
  connect(id: string): TerminalConnection { return new SocketConnection(this.sessionId, id) }
  getSnapshot(): TerminalWorkspaceSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private set(snapshot: TerminalWorkspaceSnapshot): void { this.snapshot = snapshot; for (const listener of this.listeners) listener() }
}
