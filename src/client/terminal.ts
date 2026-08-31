import type { TerminalInfo } from '../terminal.ts'

export interface TerminalConnection {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
  subscribe(listener: (output: { sequence: number; data: string; replay?: boolean }) => void): () => void
}

export interface TerminalWorkspaceSnapshot { terminals: readonly TerminalInfo[]; loading: boolean; error?: string }

/** Browser client for the workbench's local terminal transport. */
export interface TerminalWorkspace {
  refresh(): Promise<void>
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
  let answer: { ok?: boolean; value?: T; error?: { message?: string } }
  try { answer = JSON.parse(text) as { ok?: boolean; value?: T; error?: { message?: string } } } catch { throw new Error(`terminal request returned invalid JSON (${response.status})`) }
  if (!response.ok || answer.ok !== true) throw new Error(answer.error?.message ?? 'terminal request failed')
  return answer.value as T
}

class SocketConnection implements TerminalConnection {
  private readonly socket: WebSocket
  private readonly listeners = new Set<(output: { sequence: number; data: string; replay?: boolean }) => void>()
  private queue: string[] = []

  constructor(sessionId: string, id: string) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    this.socket = new WebSocket(`${protocol}://${location.host}/dsh-vscode-terminal/ws?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}`)
    this.socket.onopen = () => { for (const value of this.queue) this.socket.send(value); this.queue = [] }
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
  close(): void { this.socket.close() }
  subscribe(listener: (output: { sequence: number; data: string; replay?: boolean }) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
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

  async refresh(): Promise<void> {
    this.set({ ...this.snapshot, loading: true, error: undefined })
    try { this.set({ terminals: await request<TerminalInfo[]>('list', { sessionId: this.sessionId }), loading: false }) }
    catch (error) { this.set({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : String(error) }) }
  }

  async create(title?: string): Promise<TerminalInfo> { const terminal = await request<TerminalInfo>('create', { sessionId: this.sessionId, ...(title === undefined ? {} : { title }) }); await this.refresh(); return terminal }
  async close(id: string): Promise<void> { await request('close', { sessionId: this.sessionId, id }); await this.refresh() }
  async rename(id: string, title: string): Promise<void> { await request('rename', { sessionId: this.sessionId, id, title }); await this.refresh() }
  connect(id: string): TerminalConnection { return new SocketConnection(this.sessionId, id) }
  getSnapshot(): TerminalWorkspaceSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private set(snapshot: TerminalWorkspaceSnapshot): void { this.snapshot = snapshot; for (const listener of this.listeners) listener() }
}
