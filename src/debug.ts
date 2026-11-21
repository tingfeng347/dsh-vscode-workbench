/**
 * Debug host: owns the real debugging session and speaks one normalized protocol to the
 * workbench UI, so the client never has to know whether it is talking CDP (Node) or DAP (Python).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { delimiter, dirname, join as joinPath } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { frameLsp, lspFrameParser } from './lsp.ts'

export interface DebugBreakpoint { line: number; condition?: string }
export interface DebugFrame { id: string; name: string; path?: string; line?: number; column?: number }
export interface DebugScope { name: string; reference: string }
export interface DebugVariable { name: string; value: string; type: string; reference?: string }

export type DebugIncoming =
  | { type: 'start'; target?: 'node'; adapterId?: string; program: string; args?: string[]; cwd: string; stopOnEntry?: boolean; breakpoints?: Record<string, DebugBreakpoint[]> }
  | { type: 'attach'; target: 'node'; port: number; cwd: string }
  | { type: 'run'; program: string; cwd: string; args?: string[] }
  | { type: 'adapters' }
  | { type: 'stop' }
  | { type: 'setBreakpoints'; path: string; breakpoints: DebugBreakpoint[] }
  | { type: 'setExceptionBreakpoints'; mode: 'none' | 'uncaught' | 'all' }
  | { type: 'resume' }
  | { type: 'pause' }
  | { type: 'step'; kind: 'next' | 'in' | 'out' }
  | { type: 'stack'; threadId: number }
  | { type: 'scopes'; frameId: string }
  | { type: 'variables'; reference: string }
  | { type: 'evaluate'; expression: string; frameId?: string }

export type DebugOutgoing =
  | { type: 'state'; state: 'starting' | 'running' | 'stopped' | 'ended'; reason?: string }
  | { type: 'stack'; frames: DebugFrame[] }
  | { type: 'scopes'; frameId: string; scopes: DebugScope[] }
  | { type: 'variables'; reference: string; variables: DebugVariable[] }
  | { type: 'evaluated'; result: string; reference?: string }
  | { type: 'breakpoints'; path: string; verified: boolean[] }
  | { type: 'output'; category: 'stdout' | 'stderr' | 'console'; text: string }
  | { type: 'error'; message: string }
  | { type: 'ended'; code?: number }
  | { type: 'adapters'; adapters: Array<{ id: string; label: string; languages: string[]; available: boolean; hint?: string }> }

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A silent adapter must not wedge the serial command queue, so every DAP/CDP call has a deadline. */
const DAP_REQUEST_TIMEOUT_MS = 10_000
const DAP_LAUNCH_TIMEOUT_MS = 30_000
const CDP_REQUEST_TIMEOUT_MS = 10_000

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isBreakpointList = (value: unknown): value is DebugBreakpoint[] =>
  Array.isArray(value) && value.every(row => {
    if (typeof row !== 'object' || row === null) return false
    const candidate = row as { line?: unknown; condition?: unknown }
    return typeof candidate.line === 'number' && Number.isInteger(candidate.line) && candidate.line > 0
      && (candidate.condition === undefined || typeof candidate.condition === 'string')
  })

const isBreakpointMap = (value: unknown): value is Record<string, DebugBreakpoint[]> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every(isBreakpointList)

/**
 * The debug socket is a network boundary: the panel is the only intended client, but anything on
 * the same origin can open it. Reject frames that do not match the documented message shapes
 * instead of trusting a `JSON.parse` cast.
 */
export function parseDebugMessage(raw: string | Buffer): DebugIncoming | undefined {
  let value: unknown
  try { value = JSON.parse(String(raw)) } catch { return undefined }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  const text = (field: string): string | undefined => {
    const found = message[field]
    return typeof found === 'string' && found !== '' ? found : undefined
  }
  const cwd = typeof message.cwd === 'string' ? message.cwd : ''
  switch (message.type) {
    case 'start': {
      const program = text('program')
      if (program === undefined) return undefined
      if (message.adapterId !== undefined && text('adapterId') === undefined) return undefined
      if (message.args !== undefined && !isStringArray(message.args)) return undefined
      if (message.breakpoints !== undefined && !isBreakpointMap(message.breakpoints)) return undefined
      return {
        type: 'start', program, cwd, adapterId: text('adapterId'), args: message.args as string[] | undefined,
        stopOnEntry: message.stopOnEntry === true, breakpoints: message.breakpoints as Record<string, DebugBreakpoint[]> | undefined,
      }
    }
    case 'attach': {
      const port = Number(message.port)
      if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined
      return { type: 'attach', target: 'node', port, cwd }
    }
    case 'run': {
      const program = text('program')
      if (program === undefined) return undefined
      if (message.args !== undefined && !isStringArray(message.args)) return undefined
      return { type: 'run', program, cwd, args: message.args as string[] | undefined }
    }
    case 'setBreakpoints': {
      const path = text('path')
      if (path === undefined || !isBreakpointList(message.breakpoints)) return undefined
      return { type: 'setBreakpoints', path, breakpoints: message.breakpoints }
    }
    case 'setExceptionBreakpoints':
      return message.mode === 'none' || message.mode === 'uncaught' || message.mode === 'all' ? { type: 'setExceptionBreakpoints', mode: message.mode } : undefined
    case 'step':
      return message.kind === 'next' || message.kind === 'in' || message.kind === 'out' ? { type: 'step', kind: message.kind } : undefined
    case 'scopes': {
      const frameId = text('frameId')
      return frameId === undefined ? undefined : { type: 'scopes', frameId }
    }
    case 'variables': {
      const reference = text('reference')
      return reference === undefined ? undefined : { type: 'variables', reference }
    }
    case 'evaluate': {
      const expression = text('expression')
      if (expression === undefined) return undefined
      return { type: 'evaluate', expression, frameId: text('frameId') }
    }
    case 'stack': {
      const threadId = Number(message.threadId)
      return { type: 'stack', threadId: Number.isInteger(threadId) && threadId > 0 ? threadId : 1 }
    }
    case 'adapters': return { type: 'adapters' }
    case 'stop': return { type: 'stop' }
    case 'resume': return { type: 'resume' }
    case 'pause': return { type: 'pause' }
    default: return undefined
  }
}

/**
 * Map the paths a panel sends onto the session workspace before an adapter sees them. Adapters
 * take absolute paths; the editor speaks workspace-relative ones, and a breakpoint outside the
 * workspace must never reach the runtime. Returns undefined when a path escapes the workspace.
 */
export async function resolveDebugPaths(
  message: DebugIncoming,
  resolve: (path: string) => Promise<string>,
): Promise<DebugIncoming | undefined> {
  try {
    switch (message.type) {
      case 'start': {
        // The program is the target of this launch: if it escapes the workspace the launch fails.
        const program = await resolve(message.program)
        const breakpoints: Record<string, DebugBreakpoint[]> = {}
        for (const [path, list] of Object.entries(message.breakpoints ?? {})) {
          if (list.length === 0) continue
          // A breakpoint left on a deleted (or no longer resolvable) file must not block a launch
          // of a file that is perfectly valid: skip it instead of failing the whole start.
          try { breakpoints[await resolve(path)] = list } catch { /* stale breakpoint */ }
        }
        return { ...message, program, breakpoints }
      }
      case 'run':
        return { ...message, program: await resolve(message.program) }
      case 'setBreakpoints':
        return { ...message, path: await resolve(message.path) }
      default:
        return message
    }
  } catch { return undefined }
}

/** Absolute path to a file URL, tolerating both separators on Windows. */
export function toFileUrl(path: string): string {
  const normalised = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalised)) return `file:///${normalised}`
  if (normalised.startsWith('//')) return `file:${normalised}`
  return pathToFileURL(normalised).href
}

/** Regex matching the URL Node reports for `path`, whichever case the drive letter uses. */
export function fileUrlRegex(path: string): string {
  const escaped = escapeRegex(toFileUrl(path))
  const match = /^file:\/\/\/([A-Za-z]):(.*)$/.exec(escaped)
  if (match === null) return `^${escaped}$`
  const letter = match[1]!
  return `^file:///[${letter.toLowerCase()}${letter.toUpperCase()}]:${match[2]!}$`
}

/** Node's file URLs and Windows paths differ per drive case, so compare on a normalised key. */
export function sameFile(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false
  const clean = (value: string) => value.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  return clean(left) === clean(right)
}

/** Kill a spawned debuggee together with its children; a plain kill leaves the runtime holding the port. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.killed) return
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }) } catch { child.kill() }
    return
  }
  child.kill()
}

interface CdpMessage { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string } }
interface CdpScope { type: string; object: { objectId?: string } }
interface CdpFrame { callFrameId: string; functionName?: string; url?: string; location: { scriptId?: string; lineNumber: number; columnNumber: number }; scopeChain?: CdpScope[] }
interface CdpRemote { type?: string; subtype?: string; value?: unknown; description?: string; objectId?: string }

/** Wire-level trace for the debug adapters; diagnosis only, safe to remove. */
function dapLog(text: string): void {
  try { appendFileSync(joinPath(tmpdir(), 'dvw-dap.log'), `${new Date().toISOString()} ${text}\n`) } catch { /* never break debugging */ }
}

/** The desktop host runs on Electron, so `process.execPath` is not a Node runtime. */
export function resolveNodeExecutable(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const override = env.DSH_NODE_EXECUTABLE
  if (override !== undefined && override !== '' && existsSync(override)) return override
  if (process.versions.electron === undefined) return process.execPath
  const names = platform === 'win32' ? ['node.exe'] : ['node']
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    for (const name of names) {
      const candidate = joinPath(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}
/** Debugging a Node program over the Chrome DevTools Protocol. */
class NodeDebugSession {
  private socket: WebSocket | undefined
  private child: ChildProcess | undefined
  private nextId = 1
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private readonly breakpoints = new Map<string, DebugBreakpoint[]>()
  private frames: DebugFrame[] = []
  private stopped = false
  /** The entry pause of `--inspect-brk` must be skipped unless the user asked to stop there. */
  private skipEntryPause = false
  /** Set once the debuggee finished; stops the socket close from finishing the session again. */
  private finished = false
  /** Set after the single `ended` frame leaves, so a later exit cannot repeat it. */
  private endedSent = false
  /** True for attach mode, where no child process will ever report an exit code. */
  private attached = false
  /** scope reference → CDP objectId, for both scope entries and expanded child objects. */
  private readonly objects = new Map<string, string>()
  private readonly scopeChains = new Map<string, CdpScope[]>()
  /** scriptId → file path; Node omits `url` on call frames, so this is the only source of paths. */
  private readonly scripts = new Map<string, string>()
  /** Breakpoints currently bound at the runtime, so a line removed while paused can be unbound. */
  private readonly bound = new Map<string, Map<number, { id: string; condition?: string }>>()

  constructor(private readonly send: (message: DebugOutgoing) => void) {}

  /** Launch a program with `--inspect-brk` and attach as soon as the runtime prints its URL. */
  async launch(options: { program: string; args: string[]; cwd: string; stopOnEntry: boolean }): Promise<void> {
    this.send({ type: 'state', state: 'starting' })
    const runtime = resolveNodeExecutable()
    if (runtime === undefined) throw new Error('找不到 node 可执行文件，请设置 DSH_NODE_EXECUTABLE')
    const child = this.child = spawn(runtime, ['--inspect-brk=127.0.0.1:0', options.program, ...options.args], {
      cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' },
    })
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Node 没有在 15 秒内打开调试端口')), 15000)
      let opened = false
      // Keep forwarding stderr after the inspector URL appears: it is the only place a failing
      // script explains itself, and removing the listener here used to swallow it entirely.
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        this.send({ type: 'output', category: 'stderr', text })
        if (opened) return
        const match = /ws:\/\/[^\s]+/.exec(text)
        if (match !== null) { opened = true; clearTimeout(timer); resolve(match[0]) }
      })
      child.stdout?.on('data', chunk => this.send({ type: 'output', category: 'stdout', text: String(chunk) }))
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`进程退出（${code ?? 0}）`)) })
    })
    await this.connect(url)
    this.child?.removeAllListeners('exit')
    this.child?.on('exit', code => { this.finish(code ?? 0); this.cleanup() })
    this.skipEntryPause = !options.stopOnEntry
    await this.ready()
  }

  /** Attach to a runtime that is already listening on an inspector port. */
  async attach(port: number): Promise<void> {
    this.attached = true
    this.send({ type: 'state', state: 'starting' })
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    const targets = await response.json() as Array<{ webSocketDebuggerUrl?: string }>
    const url = targets.find(target => typeof target.webSocketDebuggerUrl === 'string')?.webSocketDebuggerUrl
    if (url === undefined) throw new Error(`端口 ${port} 上没有可附加的调试目标`)
    await this.connect(url)
    await this.ready()
  }

  private async connect(url: string): Promise<void> {
    const socket = this.socket = new WebSocket(url)
    socket.on('message', data => this.receive(JSON.parse(String(data)) as CdpMessage))
    socket.on('close', () => {
      // A spawned runtime reports through its own exit event (the real code); only an attached
      // target has nothing left to report once the inspector socket closes.
      if (this.attached && !this.finished) this.finish(0)
      this.cleanup()
    })
    socket.on('error', error => this.send({ type: 'error', message: String(error).slice(0, 300) }))
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
  }

  private async ready(): Promise<void> {
    await this.request('Runtime.enable')
    await this.request('Debugger.enable')
    for (const [path, list] of this.breakpoints) await this.applyBreakpoints(path, list)
    // A runtime started with --inspect-brk stays parked until this call, and only then parses
    // scripts, so pending breakpoints bind after it rather than before.
    try { await this.request('Runtime.runIfWaitingForDebugger') } catch { /* attach: already running */ }
    this.send({ type: 'state', state: 'running' })
  }

  private receive(message: CdpMessage): void {
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? '调试器返回错误'))
      else waiter.resolve(message.result)
      return
    }
    if (message.method === 'Debugger.scriptParsed') {
      const params = message.params as { scriptId?: string; url?: string } | undefined
      if (params?.scriptId !== undefined && params.url !== undefined && params.url !== '') {
        const path = this.urlToPath(params.url)
        if (path !== undefined) this.scripts.set(params.scriptId, path)
      }
      return
    }
    if (message.method === 'Debugger.paused') {
      const params = message.params as { reason?: string; callFrames?: CdpFrame[] } | undefined
      if (this.skipEntryPause) {
        this.skipEntryPause = false
        // `--inspect-brk` pauses before the first line, which is not a breakpoint hit. Keeping that
        // pause would swallow a breakpoint on the first statement — but only when it really applies:
        // a `false` condition must resume exactly like V8 would.
        const match = this.breakpointAtPause(params)
        if (match === undefined) {
          void this.request('Debugger.resume').catch(() => undefined)
          return
        }
        const condition = match.condition
        if (condition !== undefined && condition !== '') {
          void this.conditionHolds(params, condition).then(holds => {
            if (holds) this.handlePause(params)
            else void this.request('Debugger.resume').catch(() => undefined)
          })
          return
        }
      }
      this.handlePause(params)
      return
    }
    if (message.method === 'Runtime.executionContextDestroyed') {
      if (this.finished) return
      this.finished = true
      if (this.child === undefined) {
        // Attached target: nothing will report an exit code, so close the session here.
        this.finish(0)
        this.cleanup()
        return
      }
      // The debuggee finished. Node keeps the process alive ("Waiting for the debugger to
      // disconnect…") until the inspector socket closes; close it without killing the child so
      // the process exits on its own and its exit event reports the real code exactly once.
      this.cleanup({ keepChild: true })
      return
    }
    if (message.method === 'Debugger.resumed') { this.stopped = false; this.send({ type: 'state', state: 'running' }); return }
    if (message.method === 'Runtime.consoleAPICalled') {
      const params = message.params as { args?: CdpRemote[] } | undefined
      const text = (params?.args ?? []).map(arg => this.remoteText(arg)).join(' ')
      this.send({ type: 'output', category: 'console', text })
      return
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const params = message.params as { exceptionDetails?: { text?: string; exception?: CdpRemote } } | undefined
      this.send({ type: 'output', category: 'stderr', text: params?.exceptionDetails?.exception?.description ?? params?.exceptionDetails?.text ?? '未捕获异常' })
    }
  }

  /** Record the paused frames and report the stop; shared by real hits and a kept entry pause. */
  private handlePause(params: { reason?: string; callFrames?: CdpFrame[] } | undefined): void {
    this.stopped = true
    this.objects.clear()
    this.scopeChains.clear()
    this.frames = (params?.callFrames ?? []).map(frame => {
      this.scopeChains.set(frame.callFrameId, frame.scopeChain ?? [])
      const direct = frame.url === undefined || frame.url === '' ? undefined : this.urlToPath(frame.url)
      const scriptId = frame.location.scriptId
      return {
        id: frame.callFrameId,
        name: frame.functionName || '(anonymous)',
        // Node reports the path on `Debugger.scriptParsed`, not on the call frame itself.
        path: direct ?? (scriptId === undefined ? undefined : this.scripts.get(scriptId)),
        line: frame.location.lineNumber + 1,
        column: frame.location.columnNumber + 1,
      }
    })
    this.send({ type: 'state', state: 'stopped', reason: params?.reason ?? 'paused' })
    this.send({ type: 'stack', frames: this.frames })
  }

  private urlToPath(url: string): string | undefined {
    try { return url.startsWith('file:') ? fileURLToPath(url) : url } catch { return url }
  }

  /** The user breakpoint that sits exactly on the paused location, if any. */
  private breakpointAtPause(params: { callFrames?: CdpFrame[] } | undefined): DebugBreakpoint | undefined {
    const frame = params?.callFrames?.[0]
    if (frame === undefined) return undefined
    const scriptId = frame.location.scriptId
    const path = frame.url !== undefined && frame.url !== '' ? this.urlToPath(frame.url) : (scriptId === undefined ? undefined : this.scripts.get(scriptId))
    if (path === undefined) return undefined
    const line = frame.location.lineNumber + 1
    for (const [key, list] of this.breakpoints) {
      if (!sameFile(key, path)) continue
      const row = list.find(item => item.line === line)
      if (row !== undefined) return row
    }
    return undefined
  }

  /** Evaluate a breakpoint condition in the paused frame; a failing condition keeps the stop. */
  private async conditionHolds(params: { callFrames?: CdpFrame[] } | undefined, condition: string): Promise<boolean> {
    const callFrameId = params?.callFrames?.[0]?.callFrameId
    if (callFrameId === undefined) return true
    try {
      const result = await this.request('Debugger.evaluateOnCallFrame', { callFrameId, expression: condition, returnByValue: true }) as { result?: { value?: unknown } }
      return Boolean(result?.result?.value)
    } catch { return true }
  }

  /** Send the end of the session once; a process exit must not follow an earlier one. */
  private finish(code: number): void {
    if (this.endedSent) return
    this.endedSent = true
    this.send({ type: 'state', state: 'ended' })
    this.send({ type: 'ended', code })
  }

  private remoteText(value: CdpRemote): string {
    if (value.value !== undefined) return typeof value.value === 'string' ? value.value : JSON.stringify(value.value)
    return value.description ?? value.type ?? ''
  }

  private request(method: string, params?: Record<string, unknown>, timeoutMs = CDP_REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = this.socket
      if (socket === undefined || socket.readyState !== WebSocket.OPEN) { reject(new Error('调试会话尚未连接')); return }
      const id = this.nextId++
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} 超过 ${Math.round(timeoutMs / 1000)} 秒没有响应`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
      socket.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
  }

  async setBreakpoints(path: string, breakpoints: DebugBreakpoint[]): Promise<void> {
    this.breakpoints.set(path, breakpoints)
    await this.applyBreakpoints(path, breakpoints)
  }

  /** Breakpoints chosen before the session existed are applied as soon as the runtime is ready. */
  seedBreakpoints(all: Record<string, DebugBreakpoint[]>): void {
    for (const [path, list] of Object.entries(all)) this.breakpoints.set(path, list)
  }

  private async applyBreakpoints(path: string, breakpoints: DebugBreakpoint[]): Promise<void> {
    if (this.socket === undefined) return
    const urlRegex = fileUrlRegex(path)
    const previous = this.bound.get(path) ?? new Map<number, { id: string; condition?: string }>()
    const next = new Map<number, { id: string; condition?: string }>()
    const verified: boolean[] = []
    for (const breakpoint of breakpoints) {
      const condition = breakpoint.condition === undefined || breakpoint.condition === '' ? undefined : breakpoint.condition
      const existing = previous.get(breakpoint.line)
      if (existing !== undefined && existing.condition === condition) { next.set(breakpoint.line, existing); verified.push(true); continue }
      if (existing !== undefined) await this.request('Debugger.removeBreakpoint', { breakpointId: existing.id }).catch(() => undefined)
      try {
        const result = await this.request('Debugger.setBreakpointByUrl', {
          lineNumber: breakpoint.line - 1, urlRegex,
          ...(condition === undefined ? {} : { condition }),
        }) as { breakpointId?: string; locations?: unknown[] }
        if (result?.breakpointId !== undefined) next.set(breakpoint.line, { id: result.breakpointId, condition })
        verified.push(Array.isArray(result?.locations) && result.locations.length > 0)
      } catch { verified.push(false) }
    }
    // A line removed while paused must be unbound at the runtime, or continuing stops there again.
    for (const [line, stale] of previous) {
      if (!next.has(line)) await this.request('Debugger.removeBreakpoint', { breakpointId: stale.id }).catch(() => undefined)
    }
    this.bound.set(path, next)
    this.send({ type: 'breakpoints', path, verified })
  }

  async setExceptionBreakpoints(mode: 'none' | 'uncaught' | 'all'): Promise<void> {
    await this.request('Debugger.setPauseOnExceptions', { state: mode === 'none' ? 'none' : mode === 'all' ? 'all' : 'uncaught' })
  }

  async resume(): Promise<void> { await this.request('Debugger.resume') }
  async pause(): Promise<void> { await this.request('Debugger.pause') }
  async step(kind: 'next' | 'in' | 'out'): Promise<void> {
    await this.request(kind === 'next' ? 'Debugger.stepOver' : kind === 'in' ? 'Debugger.stepInto' : 'Debugger.stepOut')
  }

  async stack(): Promise<void> { this.send({ type: 'stack', frames: this.frames }) }

  /** Scope entries carry the CDP objectId of that scope, so variables read the real runtime state. */
  async scopes(frameId: string): Promise<void> {
    const chain = this.scopeChains.get(frameId) ?? []
    const scopes: DebugScope[] = []
    chain.forEach((scope, index) => {
      const objectId = scope.object?.objectId
      if (objectId === undefined) return
      const reference = `scope:${frameId}:${index}`
      this.objects.set(reference, objectId)
      scopes.push({ name: scopeLabel(scope.type), reference })
    })
    this.send({ type: 'scopes', frameId, scopes })
  }

  async variables(reference: string): Promise<void> {
    const objectId = this.objects.get(reference)
    this.send({ type: 'variables', reference, variables: await this.properties(objectId) })
  }

  private async properties(objectId: string | undefined): Promise<DebugVariable[]> {
    if (objectId === undefined) return []
    const result = await this.request('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true }) as {
      result?: Array<{ name: string; value?: CdpRemote }>
    }
    return (result.result ?? []).filter(row => row.value !== undefined).slice(0, 500).map(row => {
      const value = row.value!
      const child = value.objectId
      const reference = child === undefined ? undefined : `object:${child}`
      if (child !== undefined && reference !== undefined) this.objects.set(reference, child)
      const text = this.remoteText(value)
      return { name: row.name, value: text.length > 200 ? `${text.slice(0, 200)}…` : text, type: value.subtype ?? value.type ?? 'unknown', reference }
    })
  }

  async evaluate(expression: string, frameId?: string): Promise<void> {
    try {
      const result = frameId !== undefined
        ? await this.request('Debugger.evaluateOnCallFrame', { callFrameId: frameId, expression, returnByValue: false, generatePreview: true })
        : await this.request('Runtime.evaluate', { expression, returnByValue: false, generatePreview: true })
      const value = (result as { result?: CdpRemote }).result
      this.send({ type: 'evaluated', result: value === undefined ? '' : this.remoteText(value), reference: value?.objectId })
    } catch (error) {
      this.send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  cleanup(options: { keepChild?: boolean } = {}): void {
    this.stopped = false
    // Waiting requests must settle, or the serial command queue never reaches the next message.
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const waiter of waiting) waiter.reject(new Error('调试会话已结束'))
    this.objects.clear()
    this.scopeChains.clear()
    this.scripts.clear()
    this.bound.clear()
    try { this.socket?.close() } catch { /* already closed */ }
    this.socket = undefined
    // `keepChild` is used when the debuggee finished on its own: killing it would destroy the
    // exit code the process is about to report.
    if (this.child !== undefined) {
      if (options.keepChild !== true) killTree(this.child)
      this.child = undefined
    }
  }
}

/** Label a CDP scope type the way the workbench UI shows it. */
export function scopeLabel(type: string): string {
  switch (type) {
    case 'local': return '局部'
    case 'closure': return '闭包'
    case 'block': return '块'
    case 'script': return '脚本'
    case 'global': return '全局'
    case 'with': return 'with'
    case 'catch': return 'catch'
    case 'module': return '模块'
    default: return type
  }
}

/** One language's debugger, resolved on demand rather than compiled in. */
export interface AdapterPreset {
  id: string
  label: string
  /** File extensions this adapter claims, used to pick one for the active file. */
  languages: string[]
  /** Extra arguments placed before the program for launch-style adapters. */
  command?(context: AdapterContext): { command: string; args: string[] } | undefined
  /** How the adapter is obtained when it is missing. */
  install?: string
}

export interface AdapterContext { adaptersRoot: string; program: string }

const pathDirectories = (env: NodeJS.ProcessEnv = process.env): string[] => (env.PATH ?? '').split(delimiter).filter(Boolean)

function onPath(name: string, env?: NodeJS.ProcessEnv): string | undefined {
  for (const directory of pathDirectories(env)) {
    const candidate = joinPath(directory, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Adapters we can resolve without asking the user anything beyond installing the tool. */
export const ADAPTER_PRESETS: AdapterPreset[] = [
  { id: 'node', label: 'Node.js（内置 inspector）', languages: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'] },
  {
    id: 'python', label: 'Python（debugpy）', languages: ['py'],
    command: ({ adaptersRoot }) => {
      const python = debugpyAdapter(adaptersRoot)
      return python === undefined ? undefined : { command: python, args: ['-m', 'debugpy.adapter'] }
    },
    install: '已在 adapters\\python 安装；或在 PATH 中提供 python 并 pip install debugpy',
  },
  {
    id: 'cpp', label: 'C/C++（GDB DAP）', languages: ['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'],
    command: () => {
      const gdb = onPath(process.platform === 'win32' ? 'gdb.exe' : 'gdb')
      return gdb === undefined ? undefined : { command: gdb, args: ['--quiet', '--nx', '-ex', 'set breakpoint pending on', '--interpreter=dap'] }
    },
    install: '安装 MinGW-w64（自带 gdb 13+）并加入 PATH',
  },
  {
    id: 'dotnet', label: '.NET（netcoredbg）', languages: ['cs', 'fs', 'vb'],
    command: () => {
      const binary = onPath(process.platform === 'win32' ? 'netcoredbg.exe' : 'netcoredbg')
      return binary === undefined ? undefined : { command: binary, args: ['--interpreter=vscode'] }
    },
    install: '安装 netcoredbg 并加入 PATH',
  },
  {
    id: 'custom', label: '自定义 DAP 适配器（stdio）', languages: [],
    command: () => {
      const command = process.env.DSH_DEBUG_ADAPTER_COMMAND
      if (command === undefined || command === '') return undefined
      const args = (process.env.DSH_DEBUG_ADAPTER_ARGS ?? '').split(' ').filter(Boolean)
      return { command, args }
    },
    install: '设置环境变量 DSH_DEBUG_ADAPTER_COMMAND（及可选的 DSH_DEBUG_ADAPTER_ARGS）指向任意以 stdio 通信的 DAP 适配器',
  },
]

/** Pick the adapter that claims a file extension, falling back to Node for scripts. */
export function adapterForPath(path: string, presets: readonly AdapterPreset[] = ADAPTER_PRESETS): AdapterPreset | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension === undefined) return presets.find(preset => preset.id === 'node')
  return presets.find(preset => preset.languages.includes(extension)) ?? (extension === 'js' ? presets.find(preset => preset.id === 'node') : undefined)
}

/** Resolve one preset to a runnable stdio command. */
export function resolveAdapter(id: string, context: AdapterContext, presets: readonly AdapterPreset[] = ADAPTER_PRESETS): { command: string; args: string[] } | undefined {
  const preset = presets.find(row => row.id === id)
  if (preset?.command === undefined) return undefined
  return preset.command(context)
}

interface DapResponse { type: 'response'; request_seq: number; success: boolean; message?: string; body?: Record<string, unknown>; command: string }
interface DapEvent { type: 'event'; event: string; body?: Record<string, unknown> }
interface DapRequest { type: 'request'; seq: number; command: string; arguments?: Record<string, unknown> }

/** Any language whose debugger speaks DAP over stdio. */
class DapBackend {
  private child: ChildProcess | undefined
  private seq = 1
  private readonly pending = new Map<number, { resolve(value: DapResponse): void; reject(error: Error): void }>()
  private readonly breakpoints = new Map<string, DebugBreakpoint[]>()
  private frames: DebugFrame[] = []
  private threadId = 1
  private stopped = false

  constructor(private readonly send: (message: DebugOutgoing) => void, private readonly command: { command: string; args: string[] }, private readonly cwd: string, private readonly forceEntryStop = false, private readonly breakpointsFirst = false, private readonly extraEnv: Record<string, string> = {}, private readonly launchExtra: Record<string, unknown> = {}) {}

  async launch(options: { program: string; args: string[]; stopOnEntry: boolean }): Promise<void> {
    this.send({ type: 'state', state: 'starting' })
    const child = this.child = spawn(this.command.command, this.command.args, {
      cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...this.extraEnv },
    })
    // A pipe that closes while we are writing raises 'error' on the stream; without a listener
    // that is an uncaught exception and takes the whole host down with it.
    child.stdin?.on('error', () => undefined)
    child.stdout?.on('error', () => undefined)
    child.stderr?.on('error', () => undefined)
    const parse = lspFrameParser(message => { dapLog(`<- ${JSON.stringify(message).slice(0, 600)}`); this.receive(message as DapResponse | DapEvent) })
    child.stdout?.on('data', chunk => parse(chunk as Buffer))
    child.stderr?.on('data', chunk => this.send({ type: 'output', category: 'stderr', text: String(chunk) }))
    child.on('exit', code => { this.send({ type: 'state', state: 'ended' }); this.send({ type: 'ended', code: code ?? 0 }); this.cleanup() })
    // A missing adapter binary never reaches 'exit'; without this the launch promise hangs.
    child.on('error', error => {
      this.send({ type: 'error', message: `调试适配器启动失败：${error.message}` })
      this.send({ type: 'state', state: 'ended' })
      this.cleanup()
    })

    const initialized = new Promise<void>(resolve => { this.onInitialized = resolve })
    await this.request('initialize', {
      clientID: 'dsh-vscode-workbench', clientName: 'DSH Workbench', adapterID: 'dsh-workbench',
      linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsRunInTerminalRequest: false,
    })
    await Promise.race([initialized, new Promise(resolve => setTimeout(resolve, 4000))])
    const launchArgs = {
      program: options.program, args: options.args, cwd: this.cwd, console: 'internalConsole', justMyCode: false,
      stopOnEntry: this.forceEntryStop ? true : options.stopOnEntry,
      ...this.launchExtra,
    }

    if (this.breakpointsFirst) {
      // Verified against GDB 15: pending breakpoints -> launch -> configurationDone stops on the
      // breakpoint; an automatic continue here runs the program straight past it.
      for (const [path, list] of this.breakpoints) await this.applyBreakpoints(path, list)
      await this.request('launch', launchArgs, DAP_LAUNCH_TIMEOUT_MS).catch(() => undefined)
      const entryStop = new Promise<void>(resolve => { this.onStop = resolve })
      await this.request('configurationDone', {}, DAP_LAUNCH_TIMEOUT_MS).catch(() => undefined)
      await Promise.race([entryStop, new Promise(resolve => setTimeout(resolve, 4000))])
      return
    }

    // Verified against debugpy: it needs launch first (breakpoints go to a server that does not
    // exist yet otherwise), and it answers launch only after configurationDone.
    const launching = this.request('launch', launchArgs, DAP_LAUNCH_TIMEOUT_MS)
    for (const [path, list] of this.breakpoints) await this.applyBreakpoints(path, list)
    void launching.catch(() => undefined)
    await this.request('configurationDone', {}, DAP_LAUNCH_TIMEOUT_MS).catch(() => undefined)
    this.send({ type: 'state', state: 'running' })
  }

  async attach(): Promise<void> { throw new Error('该适配器暂不支持附加模式') }

  private onInitialized: (() => void) | undefined
  private onStop: (() => void) | undefined

  private receive(message: DapResponse | DapEvent): void {
    // Adapters ask the client to open a terminal; ignoring the request stalls the session.
    if ((message as unknown as DapRequest).type === 'request') { void this.onRequest(message as unknown as DapRequest); return }
    if (message.type === 'response') {
      const response = message as DapResponse
      const waiter = this.pending.get(message.request_seq)
      if (waiter === undefined) return
      this.pending.delete(message.request_seq)
      if (message.success) waiter.resolve(message)
      else waiter.reject(new Error(message.message ?? `${message.command} 失败`))
      return
    }
    if (message.type !== 'event') return
    if (message.event === 'initialized') { this.onInitialized?.(); return }
    if (message.event === 'output') {
      const body = message.body as { category?: string; output?: string } | undefined
      if (body?.category === 'telemetry') return
      this.send({ type: 'output', category: body?.category === 'stderr' ? 'stderr' : 'console', text: body?.output ?? '' })
      return
    }
    if (message.event === 'stopped') {
      const body = message.body as { threadId?: number; reason?: string } | undefined
      this.threadId = body?.threadId ?? 1
      this.stopped = true
      this.onStop?.(); this.onStop = undefined
      this.send({ type: 'state', state: 'stopped', reason: body?.reason ?? 'paused' })
      void this.stack()
      return
    }
    if (message.event === 'continued') { this.stopped = false; this.send({ type: 'state', state: 'running' }); return }
    if (message.event === 'thread' && (message.body as { reason?: string })?.reason === 'exited') {
      this.stopped = false; this.send({ type: 'state', state: 'ended' })
    }
  }

  /** Never write into a pipe that is gone: the adapter may have exited mid-session. */
  private writeFrame(payload: string): void {
    const stdin = this.child?.stdin
    if (stdin === undefined || stdin === null || stdin.destroyed || !stdin.writable) return
    try { stdin.write(payload) } catch { /* the stream error handler deals with the rest */ }
  }

  /** Open a real console window so the debuggee can read stdin, like VS Code's external terminal. */
  private async onRequest(request: DapRequest): Promise<void> {
    const args = (request.arguments ?? {}) as { args?: string[]; cwd?: string }
    let success = true
    let message = ''
    if (request.command === 'runInTerminal') {
      const line = (args.args ?? []).map(part => (/\s/.test(part) ? `"${part}"` : part)).join(' ')
      try {
        spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', line], {
          cwd: args.cwd ?? this.cwd, detached: true, stdio: 'ignore', windowsHide: false,
        }).unref()
      } catch (error) { success = false; message = error instanceof Error ? error.message : String(error) }
    } else {
      success = false
      message = `unsupported request: ${request.command}`
    }
    this.writeFrame(frameLsp({ type: 'response', request_seq: request.seq, success, command: request.command, ...(message === '' ? {} : { message }) }))
  }

  private request(command: string, args: Record<string, unknown> = {}, timeoutMs = DAP_REQUEST_TIMEOUT_MS): Promise<DapResponse> {
    return new Promise((resolve, reject) => {
      const child = this.child
      if (child?.stdin === undefined || child.stdin === null) { reject(new Error('调试适配器未就绪')); return }
      const seq = this.seq++
      const timer = setTimeout(() => {
        if (this.pending.delete(seq)) reject(new Error(`${command} 超过 ${Math.round(timeoutMs / 1000)} 秒没有响应`))
      }, timeoutMs)
      this.pending.set(seq, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
      dapLog(`-> ${seq} ${command} ${JSON.stringify(args).slice(0, 400)}`)
      this.writeFrame(frameLsp({ seq, type: 'request', command, arguments: args }))
    })
  }

  async setBreakpoints(path: string, breakpoints: DebugBreakpoint[]): Promise<void> {
    this.breakpoints.set(path, breakpoints)
    await this.applyBreakpoints(path, breakpoints)
  }

  /** Breakpoints chosen before the session existed are applied as soon as the runtime is ready. */
  seedBreakpoints(all: Record<string, DebugBreakpoint[]>): void {
    for (const [path, list] of Object.entries(all)) this.breakpoints.set(path, list)
  }

  private async applyBreakpoints(path: string, breakpoints: DebugBreakpoint[]): Promise<void> {
    if (this.child === undefined) return
    try {
      const response = await this.request('setBreakpoints', {
        source: { path: path.replace(/\\/g, '/') },
        breakpoints: breakpoints.map(row => ({ line: row.line, ...(row.condition === undefined ? {} : { condition: row.condition }) })),
      })
      const verified = ((response.body as { breakpoints?: Array<{ verified?: boolean }> })?.breakpoints ?? []).map(row => row.verified === true)
      this.send({ type: 'breakpoints', path, verified })
    } catch { this.send({ type: 'breakpoints', path, verified: breakpoints.map(() => false) }) }
  }

  async setExceptionBreakpoints(mode: 'none' | 'uncaught' | 'all'): Promise<void> {
    const filters = mode === 'none' ? [] : mode === 'all' ? ['raised', 'uncaught'] : ['uncaught']
    await this.request('setExceptionBreakpoints', { filters }).catch(() => undefined)
  }

  async resume(): Promise<void> { await this.request('continue', { threadId: this.threadId }) }
  async pause(): Promise<void> { await this.request('pause', { threadId: this.threadId }) }
  async step(kind: 'next' | 'in' | 'out'): Promise<void> {
    await this.request(kind === 'next' ? 'next' : kind === 'in' ? 'stepIn' : 'stepOut', { threadId: this.threadId })
  }

  async stack(): Promise<void> {
    try {
      const response = await this.request('stackTrace', { threadId: this.threadId, startFrame: 0, levels: 50 })
      const body = response.body as { stackFrames?: Array<{ id: number; name: string; line?: number; column?: number; source?: { path?: string } }> } | undefined
      this.frames = (body?.stackFrames ?? []).map(frame => ({ id: String(frame.id), name: frame.name, path: frame.source?.path, line: frame.line, column: frame.column }))
      this.send({ type: 'stack', frames: this.frames })
    } catch { this.send({ type: 'stack', frames: [] }) }
  }

  async scopes(frameId: string): Promise<void> {
    try {
      const response = await this.request('scopes', { frameId: Number(frameId) })
      const body = response.body as { scopes?: Array<{ name: string; variablesReference: number; expensive?: boolean }> } | undefined
      this.send({ type: 'scopes', frameId, scopes: (body?.scopes ?? []).filter(row => row.variablesReference > 0).map(row => ({ name: row.name, reference: String(row.variablesReference) })) })
    } catch { this.send({ type: 'scopes', frameId, scopes: [] }) }
  }

  async variables(reference: string): Promise<void> {
    try {
      const response = await this.request('variables', { variablesReference: Number(reference) })
      const body = response.body as { variables?: Array<{ name: string; value: string; type?: string; variablesReference?: number }> } | undefined
      const variables: DebugVariable[] = (body?.variables ?? []).slice(0, 500).map(row => ({
        name: row.name, value: String(row.value ?? '').slice(0, 200), type: row.type ?? 'unknown',
        reference: row.variablesReference !== undefined && row.variablesReference > 0 ? String(row.variablesReference) : undefined,
      }))
      this.send({ type: 'variables', reference, variables })
    } catch { this.send({ type: 'variables', reference, variables: [] }) }
  }

  async evaluate(expression: string, frameId?: string): Promise<void> {
    try {
      const response = await this.request('evaluate', { expression, frameId: frameId === undefined ? undefined : Number(frameId), context: 'repl' })
      const body = response.body as { result?: string; variablesReference?: number } | undefined
      this.send({ type: 'evaluated', result: String(body?.result ?? ''), reference: body?.variablesReference !== undefined && body.variablesReference > 0 ? String(body.variablesReference) : undefined })
    } catch (error) {
      this.send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  cleanup(): void {
    this.stopped = false
    // Waiting requests must settle, or the serial command queue never reaches the next message.
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const waiter of waiting) waiter.reject(new Error('调试会话已结束'))
    if (this.child !== undefined) { killTree(this.child); this.child = undefined }
  }
}

/** Prefer the project's own virtualenv so the debuggee sees its dependencies. */
export function projectPython(start: string, exists: (path: string) => boolean = existsSync): string | undefined {
  const candidates = (base: string) => [
    joinPath(base, '.venv', 'Scripts', 'python.exe'), joinPath(base, '.venv', 'bin', 'python'),
    joinPath(base, 'venv', 'Scripts', 'python.exe'), joinPath(base, 'venv', 'bin', 'python'),
    joinPath(base, '.env', 'Scripts', 'python.exe'), joinPath(base, '.env', 'bin', 'python'),
  ]
  let directory = start
  for (let depth = 0; depth < 6; depth++) {
    for (const candidate of candidates(directory)) if (exists(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

/** Directory that must be on PYTHONPATH for `from pkg import ...` to resolve. */
export function pythonImportRoot(program: string, exists: (path: string) => boolean = existsSync): string | undefined {
  let directory = dirname(program)
  let root: string | undefined
  for (let depth = 0; depth < 8; depth++) {
    if (!exists(joinPath(directory, '__init__.py'))) break
    root = dirname(directory)
    directory = root
  }
  return root
}

/** Resolve the interpreter that plain "run" should use for a program. */
export function resolveInterpreter(program: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(program)?.[1]?.toLowerCase()
  const name = (base: string) => platform === 'win32' ? `${base}.exe` : base
  if (extension === 'py') {
    const python = onPath(name('python'), env) ?? onPath(name('python3'), env)
    return python === undefined ? undefined : { command: python, args: [] }
  }
  if (extension === 'c' || extension === 'cc' || extension === 'cpp' || extension === 'cxx') {
    const binary = program.replace(/\.(c|cc|cpp|cxx)$/i, process.platform === 'win32' ? '.exe' : '')
    return existsSync(binary) ? { command: binary, args: [] } : undefined
  }
  if (extension === 'js' || extension === 'cjs' || extension === 'mjs') {
    const node = resolveNodeExecutable(env, platform)
    return node === undefined ? undefined : { command: node, args: [] }
  }
  return undefined
}

/** Runs a program with no debugger attached; output streams to the same console. */
class RunSession {
  private child: ChildProcess | undefined

  constructor(private readonly send: (message: DebugOutgoing) => void) {}

  start(options: { program: string; cwd: string; args: string[] }): void {
    const interpreter = resolveInterpreter(options.program)
    if (interpreter === undefined) throw new Error('无法确定该文件的运行方式：Python 需要解释器，C/C++ 需要先编译出同名 .exe，JS 需要 node')
    this.send({ type: 'state', state: 'running' })
    const child = this.child = spawn(interpreter.command, [...interpreter.args, options.program, ...options.args], {
      cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
    child.stdout?.on('data', chunk => this.send({ type: 'output', category: 'stdout', text: String(chunk) }))
    child.stderr?.on('data', chunk => this.send({ type: 'output', category: 'stderr', text: String(chunk) }))
    child.on('error', error => { this.send({ type: 'error', message: String(error).slice(0, 300) }); this.send({ type: 'state', state: 'ended' }) })
    child.on('exit', code => { this.send({ type: 'state', state: 'ended' }); this.send({ type: 'ended', code: code ?? 0 }); this.cleanup() })
  }

  cleanup(): void { if (this.child !== undefined) { killTree(this.child); this.child = undefined } }
}

export interface DebugBridgeOptions {
  /** Session workspace; every path a frame mentions is resolved inside it. */
  workspace: string
  adaptersRoot: string
  /** Resolve a workspace-relative path to an absolute one; must throw when it escapes. */
  resolvePath(path: string): Promise<string>
  send(message: DebugOutgoing): void
}

/**
 * One debug websocket: validate the frame, pin every path to the session workspace, then hand the
 * result to a debug session. Extracted from the host route so a real WebSocket can drive exactly
 * the same pipeline in a regression test.
 */
export function createDebugBridge(options: DebugBridgeOptions): { accept(raw: string | Buffer): Promise<void>; dispose(): void } {
  // Resolved absolute path → the path the panel sent, so breakpoint results echo the relative form.
  const displayPaths = new Map<string, string>()
  const session = createDebugSession(message => {
    if (message.type !== 'breakpoints') { options.send(message); return }
    const original = displayPaths.get(message.path)
    options.send(original === undefined ? message : { ...message, path: original })
  }, { adaptersRoot: options.adaptersRoot })
  let disposed = false
  const reject = (message: string, launch = false) => {
    options.send({ type: 'error', message })
    // Only a failed launch has no session to fall back to. A rejected breakpoint update must not
    // mark a session that is still running as ended.
    if (launch) options.send({ type: 'state', state: 'ended' })
  }
  let chain: Promise<void> = Promise.resolve()
  return {
    accept(raw) {
      chain = chain.then(async () => {
        if (disposed) return
        const message = parseDebugMessage(raw)
        if (message === undefined) { reject('调试消息格式无效'); return }
        const resolved = await resolveDebugPaths(message, async path => {
          const absolute = await options.resolvePath(path)
          displayPaths.set(absolute, path)
          return absolute
        })
        if (resolved === undefined) { reject('调试路径不在工作区内', message.type === 'start' || message.type === 'run' || message.type === 'attach'); return }
        // The panel never knows the workspace directory; every launch runs in the session's.
        session.handle(resolved.type === 'start' || resolved.type === 'attach' || resolved.type === 'run' ? { ...resolved, cwd: options.workspace } : resolved)
      }).catch(() => undefined)
      return chain
    },
    dispose() {
      disposed = true
      session.dispose()
    },
  }
}

/** Create the handler for one workbench debug websocket. */
export function createDebugSession(send: (message: DebugOutgoing) => void, options: { adaptersRoot?: string } = {}): { handle(message: DebugIncoming): void; dispose(): void } {
  const adaptersRoot = options.adaptersRoot ?? ''
  let backend: NodeDebugSession | DapBackend | undefined
  let runner: RunSession | undefined
  let disposed = false
  const fail = (error: unknown) => {
    // A failed adapter must not keep a half-started process around, or the next start inherits it.
    backend?.cleanup(); backend = undefined
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    send({ type: 'state', state: 'ended' })
  }
  let queue: Promise<void> = Promise.resolve()
  return {
    handle(message) {
      if (disposed) return
      // Session setup is asynchronous; chaining keeps a later setBreakpoints from racing it.
      queue = queue.then(async () => {
        // A queued command must never run after the socket closed: it could spawn a new process.
        if (disposed) return
        try {
          switch (message.type) {
            case 'adapters': {
              send({
                type: 'adapters',
                adapters: ADAPTER_PRESETS.map(preset => ({
                  id: preset.id, label: preset.label, languages: preset.languages,
                  available: preset.id === 'node' ? true : resolveAdapter(preset.id, { adaptersRoot, program: '' }) !== undefined,
                  hint: preset.install,
                })),
              })
              return
            }
            case 'start': {
              const adapterId = message.adapterId ?? message.target ?? 'node'
              backend?.cleanup()
              if (adapterId === 'node') {
                const node = new NodeDebugSession(send)
                backend = node
                node.seedBreakpoints(message.breakpoints ?? {})
                await node.launch({ program: message.program, args: message.args ?? [], cwd: message.cwd, stopOnEntry: message.stopOnEntry === true })
                return
              }
              const command = resolveAdapter(adapterId, { adaptersRoot, program: message.program })
              if (command === undefined) {
                const preset = ADAPTER_PRESETS.find(row => row.id === adapterId)
                throw new Error(`找不到 ${preset?.label ?? adapterId} 的调试适配器。${preset?.install ?? ''}`)
              }
              // A C/C++ adapter debugs the compiled binary, never the source file.
              let program = message.program
              if (adapterId === 'cpp') {
                program = program.replace(/\.(c|cc|cpp|cxx)$/i, '.exe')
                // GDB matches breakpoints by the exact file string it recorded; backslashes never
                // match, so the binary path must use forward slashes.
                program = program.replace(/\\/g, '/')
                if (!existsSync(program)) throw new Error(`未找到 ${program}，请先编译（g++ -g -O0）再调试`)
              }
              dapLog(`start adapter=${adapterId} program=${message.program} cwd=${message.cwd} bps=${JSON.stringify(Object.keys(message.breakpoints ?? {}))} stopOnEntry=${message.stopOnEntry === true}`)
              // A script inside a package needs its import root on PYTHONPATH, exactly like VS Code,
              // and it must run on the project's interpreter rather than the adapter's own venv.
              const extraEnv: Record<string, string> = {}
              const launchExtra: Record<string, unknown> = {}
              if (adapterId === 'python') {
                const root = pythonImportRoot(program)
                if (root !== undefined) extraEnv.PYTHONPATH = [root, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
                const interpreter = projectPython(dirname(program)) ?? onPath(process.platform === 'win32' ? 'python.exe' : 'python')
                if (interpreter !== undefined) launchExtra.python = interpreter
                // A real console window keeps stdin interactive, which internalConsole cannot do.
              }
              // One language's breakpoints must never leak into another adapter's session.
              const languages = ADAPTER_PRESETS.find(preset => preset.id === adapterId)?.languages ?? []
              const extensionOf = (path: string) => (/\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? '').toLowerCase()
              const seeded = Object.fromEntries(Object.entries(message.breakpoints ?? {}).filter(([path]) => languages.length === 0 || languages.includes(extensionOf(path))))
              message.breakpoints = seeded
              const session = new DapBackend(send, command, message.cwd, adapterId === 'cpp', adapterId === 'cpp', extraEnv, launchExtra)
              backend = session
              session.seedBreakpoints(message.breakpoints ?? {})
              await session.launch({ program, args: message.args ?? [], stopOnEntry: message.stopOnEntry === true })
              return
            }
            case 'attach':
              backend?.cleanup()
              backend = new NodeDebugSession(send)
              await (backend as NodeDebugSession).attach(message.port)
              return
            case 'run':
              runner?.cleanup(); runner = new RunSession(send)
              runner.start({ program: message.program, cwd: message.cwd, args: message.args ?? [] })
              return
            case 'stop':
              runner?.cleanup(); runner = undefined
              backend?.cleanup(); backend = undefined; send({ type: 'state', state: 'ended' }); return
            case 'setBreakpoints': await backend?.setBreakpoints(message.path, message.breakpoints); return
            case 'setExceptionBreakpoints': await backend?.setExceptionBreakpoints(message.mode); return
            case 'resume': await backend?.resume(); return
            case 'pause': await backend?.pause(); return
            case 'step': await backend?.step(message.kind); return
            case 'stack': await backend?.stack(); return
            case 'scopes': await backend?.scopes(message.frameId); return
            case 'variables': await backend?.variables(message.reference); return
            case 'evaluate': await backend?.evaluate(message.expression, message.frameId); return
          }
        } catch (error) { fail(error) }
      })
    },
    dispose() {
      disposed = true
      // Closing the socket has to take every process with it, including a plain "run".
      runner?.cleanup(); runner = undefined
      backend?.cleanup(); backend = undefined
      queue = Promise.resolve()
    },
  }
}

/** Resolve the debugpy adapter shipped in the workspace adapters directory, when present. */
export function debugpyAdapter(adaptersRoot: string): string | undefined {
  const candidate = join(adaptersRoot, 'python', 'Scripts', 'python.exe')
  if (existsSync(candidate)) return candidate
  const posix = join(adaptersRoot, 'python', 'bin', 'python')
  return existsSync(posix) ? posix : undefined
}
