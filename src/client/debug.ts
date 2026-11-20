/** Debug session client: one websocket to the host bridge plus the state the panel renders. */
import { websocketUrl } from './websocket.ts'

export interface DebugBreakpoint { line: number; condition?: string }
export interface DebugFrame { id: string; name: string; path?: string; line?: number; column?: number }
export interface DebugScope { name: string; reference: string }
export interface DebugVariable { name: string; value: string; type: string; reference?: string }
export type DebugState = 'idle' | 'starting' | 'running' | 'stopped' | 'ended'

export interface DebugSnapshot {
  state: DebugState
  reason?: string
  frames: DebugFrame[]
  frameId?: string
  scopes: DebugScope[]
  variables: Record<string, DebugVariable[]>
  console: Array<{ kind: 'input' | 'result' | 'error' | 'output'; text: string }>
  /** File path → breakpoints, newest first line order kept sorted for display. */
  breakpoints: Record<string, DebugBreakpoint[]>
  exceptionMode: 'none' | 'uncaught' | 'all'
  sessionId?: string
  target?: 'node' | 'python'
  /** File whose breakpoints the editor gutter edits. */
  activePath?: string
  adapterId?: string
  adapters: Array<{ id: string; label: string; languages: string[]; available: boolean; hint?: string }>
}

const EMPTY: DebugSnapshot = { state: 'idle', frames: [], scopes: [], variables: {}, console: [], breakpoints: {}, exceptionMode: 'uncaught', adapters: [] }

/** Which adapter claims a file, mirroring the host registry for the UI default. */
export function guessAdapter(path: string | undefined): string {
  const extension = path === undefined ? undefined : /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension === undefined) return 'node'
  if (['py'].includes(extension)) return 'python'
  if (['cs', 'fs', 'vb'].includes(extension)) return 'dotnet'
  if (['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'].includes(extension)) return 'cpp'
  return 'node'
}

export class DebugController {
  private snapshot: DebugSnapshot = EMPTY
  private socket: WebSocket | undefined
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): DebugSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<DebugSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Remember the session the panel belongs to, so F5 works before any breakpoint click. */
  setSession(sessionId: string): void {
    if (sessionId === '') return
    this.connect(sessionId)
  }

  /** Open the bridge for a session; connecting twice keeps the newest socket. */
  connect(sessionId: string): void {
    if (this.socket !== undefined && this.snapshot.sessionId === sessionId) return
    this.closeSocket()
    const url = websocketUrl(`/dsh-vscode/ws/debug?sessionId=${encodeURIComponent(sessionId)}`)
    if (url === undefined) return
    const socket = this.socket = new WebSocket(url)
    this.update({ sessionId })
    socket.onopen = () => { this.flush(); this.send({ type: 'adapters' }) }
    socket.onmessage = event => {
      try { this.receive(JSON.parse(String(event.data)) as Record<string, unknown>) } catch { /* ignore malformed frames */ }
    }
    socket.onerror = () => { this.update({ console: [...this.snapshot.console, { kind: 'error', text: '无法连接调试服务（WebSocket）' }] }) }
    socket.onclose = () => { if (this.socket === socket) { this.socket = undefined; this.update({ state: this.snapshot.state === 'idle' ? 'idle' : 'ended' }) } }
  }

  /** Messages raised before the socket finishes connecting would be dropped, so they are queued. */
  private readonly pending: Record<string, unknown>[] = []

  private send(message: Record<string, unknown>): void {
    const socket = this.socket
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(message)); return }
    if (socket !== undefined && socket.readyState === WebSocket.CLOSED) return
    this.pending.push(message)
  }

  private flush(): void {
    const socket = this.socket
    if (socket?.readyState !== WebSocket.OPEN) return
    for (const message of this.pending.splice(0)) socket.send(JSON.stringify(message))
  }

  private receive(message: Record<string, unknown>): void {
    switch (message.type) {
      case 'state':
        this.update({ state: message.state as DebugState, reason: message.reason as string | undefined, ...(message.state === 'ended' ? { frames: [], scopes: [], variables: {}, frameId: undefined } : {}) })
        break
      case 'stack': {
        const frames = (message.frames ?? []) as DebugFrame[]
        this.update({ frames, frameId: frames[0]?.id })
        if (frames[0] !== undefined) this.send({ type: 'scopes', frameId: frames[0].id })
        break
      }
      case 'scopes':
        this.update({ scopes: (message.scopes ?? []) as DebugScope[] })
        for (const scope of (message.scopes ?? []) as DebugScope[]) this.send({ type: 'variables', reference: scope.reference })
        break
      case 'variables':
        this.update({ variables: { ...this.snapshot.variables, [String(message.reference)]: (message.variables ?? []) as DebugVariable[] } })
        break
      case 'evaluated':
        this.update({ console: [...this.snapshot.console, { kind: 'result', text: String(message.result ?? '') }] })
        break
      case 'output':
        if (message.category === 'console' || message.category === 'stdout') this.update({ console: [...this.snapshot.console, { kind: 'output', text: String(message.text ?? '') }] })
        break
      case 'breakpoints': {
        const path = String(message.path)
        this.update({ breakpoints: { ...this.snapshot.breakpoints, [path]: this.snapshot.breakpoints[path] ?? [] } })
        break
      }
      case 'error':
        this.update({ console: [...this.snapshot.console, { kind: 'error', text: String(message.message ?? '调试错误') }] })
        break
      case 'adapters':
        this.update({ adapters: (message.adapters ?? []) as DebugSnapshot['adapters'] })
        break
      case 'ended':
        this.update({ state: 'ended' })
        break
    }
  }

  start(sessionId: string, program: string, cwd: string, adapterId?: string): void {
    this.connect(sessionId === '' ? this.snapshot.sessionId ?? '' : sessionId)
    const adapter = adapterId ?? this.snapshot.adapterId ?? guessAdapter(program)
    this.update({ state: 'starting', console: [], adapterId: adapter })
    this.send({ type: 'start', adapterId: adapter, program, cwd, breakpoints: this.snapshot.breakpoints })
  }

  /** The active file decides the default adapter, unless the user picked one explicitly. */
  setActive(path: string | undefined): void {
    const adapterId = this.snapshot.adapterId === undefined || this.snapshot.adapterId === guessAdapter(this.snapshot.activePath)
      ? guessAdapter(path)
      : this.snapshot.adapterId
    if (this.snapshot.activePath !== path || this.snapshot.adapterId !== adapterId) this.update({ activePath: path, adapterId })
  }

  setAdapter(id: string): void { this.update({ adapterId: id }) }

  attach(sessionId: string, port: number): void {
    this.connect(sessionId)
    this.update({ state: 'starting', target: 'node', console: [] })
    this.send({ type: 'attach', target: 'node', port })
  }

  run(sessionId: string, program: string, cwd: string): void {
    this.connect(sessionId === '' ? this.snapshot.sessionId ?? '' : sessionId)
    this.update({ state: 'running', console: [], frames: [], scopes: [], variables: {} })
    this.send({ type: 'run', program, cwd })
  }

  stop(): void { this.send({ type: 'stop' }); this.update({ state: 'ended', frames: [], scopes: [], variables: {} }) }
  resume(): void { this.send({ type: 'resume' }) }
  pause(): void { this.send({ type: 'pause' }) }
  step(kind: 'next' | 'in' | 'out'): void { this.send({ type: 'step', kind }) }

  selectFrame(frameId: string): void {
    this.update({ frameId, scopes: [], variables: {} })
    this.send({ type: 'scopes', frameId })
  }

  expand(reference: string): void { if (this.snapshot.variables[reference] === undefined) this.send({ type: 'variables', reference }) }

  evaluate(expression: string): void {
    const text = expression.trim()
    if (text === '') return
    this.update({ console: [...this.snapshot.console, { kind: 'input', text }] })
    this.send({ type: 'evaluate', expression: text, frameId: this.snapshot.frameId })
  }

  /** Toggle a line breakpoint for a file and push the whole file's set to the runtime. */
  toggleBreakpoint(sessionId: string, path: string, line: number): void {
    this.connect(sessionId)
    const current = this.snapshot.breakpoints[path] ?? []
    const next = current.some(row => row.line === line)
      ? current.filter(row => row.line !== line)
      : [...current, { line }].sort((left, right) => left.line - right.line)
    this.update({ breakpoints: { ...this.snapshot.breakpoints, [path]: next } })
    this.send({ type: 'setBreakpoints', path, breakpoints: next })
  }

  setCondition(path: string, line: number, condition: string): void {
    const current = this.snapshot.breakpoints[path] ?? []
    const next = current.map(row => row.line === line ? { ...row, condition: condition.trim() === '' ? undefined : condition.trim() } : row)
    this.update({ breakpoints: { ...this.snapshot.breakpoints, [path]: next } })
    this.send({ type: 'setBreakpoints', path, breakpoints: next })
  }

  breakpointsFor(path: string): DebugBreakpoint[] { return this.snapshot.breakpoints[path] ?? [] }

  setExceptionMode(mode: 'none' | 'uncaught' | 'all'): void {
    this.update({ exceptionMode: mode })
    this.send({ type: 'setExceptionBreakpoints', mode })
  }

  clearConsole(): void { this.update({ console: [] }) }

  private closeSocket(): void {
    try { this.socket?.close() } catch { /* already closed */ }
    this.socket = undefined
  }

  dispose(): void { this.closeSocket(); this.listeners.clear() }
}
/** One controller per window: the panel, the gutter and the shortcuts all share it. */
export const debugController = new DebugController()
