import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { WebSocket, WebSocketServer } from 'ws'
import type { HostContext } from './context.ts'
import { cwdFor } from './host.ts'
import { readBody, send, sendError } from './wire.ts'

export interface TerminalInfo { id: string; title: string; cwd: string; running: boolean; exitCode?: number; sequence: number }
export interface TerminalOutput { sequence: number; data: string }

interface TerminalHandle { info: TerminalInfo; process: IPty; replay: string; listeners: Set<(output: TerminalOutput) => void> }
const SENSITIVE = /(api[_-]?key|token|credential|secret|password|passwd|private[_-]?key|^dsh_.*(?:key|token|secret))/i
const MAX_TERMINALS = 8
const REPLAY_BYTES = 2 * 1024 * 1024

/** Remove credentials while retaining ordinary interactive-shell variables. */
export function sanitizedTerminalEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !SENSITIVE.test(key)) as Array<[string, string]>)
}

/** Select the user's interactive shell with platform-specific fallbacks. */
export function defaultTerminalShell(platform = process.platform, env = process.env): { shell: string; args: string[] } {
  if (platform === 'win32') return { shell: env.COMSPEC?.toLowerCase().includes('powershell') ? env.COMSPEC : 'powershell.exe', args: ['-NoLogo'] }
  return { shell: env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: ['-l'] }
}

/** Own interactive terminals by their canonical workspace directory. */
export class TerminalManager {
  private readonly workspaces = new Map<string, Map<string, TerminalHandle>>()

  private workspace(cwd: string): string { return realpathSync(cwd) }

  list(cwd: string): TerminalInfo[] { return [...(this.workspaces.get(this.workspace(cwd))?.values() ?? [])].map(handle => ({ ...handle.info })) }

  create(cwd: string, title?: string): TerminalInfo {
    const key = this.workspace(cwd)
    const terminals = this.workspaces.get(key) ?? new Map<string, TerminalHandle>()
    this.workspaces.set(key, terminals)
    if (terminals.size >= MAX_TERMINALS) throw new Error(`terminal limit reached (${MAX_TERMINALS})`)
    const { shell, args } = defaultTerminalShell()
    const child = pty.spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd: key, env: sanitizedTerminalEnv(process.env) })
    const info: TerminalInfo = { id: randomUUID(), title: title || basename(shell), cwd: key, running: true, sequence: 0 }
    const handle: TerminalHandle = { info, process: child, replay: '', listeners: new Set() }
    terminals.set(info.id, handle)
    child.onData(data => {
      info.sequence++
      handle.replay += data
      if (Buffer.byteLength(handle.replay) > REPLAY_BYTES) handle.replay = handle.replay.slice(-REPLAY_BYTES)
      for (const listener of handle.listeners) listener({ sequence: info.sequence, data })
    })
    child.onExit(({ exitCode }) => {
      info.running = false
      info.exitCode = exitCode
      info.sequence++
      const data = `\r\n[process exited with code ${exitCode}]\r\n`
      for (const listener of handle.listeners) listener({ sequence: info.sequence, data })
    })
    return { ...info }
  }

  get(cwd: string, id: string): TerminalHandle | undefined { return this.workspaces.get(this.workspace(cwd))?.get(id) }

  close(cwd: string, id: string): void {
    const key = this.workspace(cwd)
    const terminals = this.workspaces.get(key)
    const handle = terminals?.get(id)
    if (handle === undefined || terminals === undefined) return
    terminals.delete(id)
    try { handle.process.kill() } catch { /* The shell may already have exited. */ }
    if (terminals.size === 0) this.workspaces.delete(key)
  }

  rename(cwd: string, id: string, title: string): TerminalInfo {
    const handle = this.get(cwd, id)
    if (handle === undefined) throw new Error('terminal not found')
    handle.info.title = title
    return { ...handle.info }
  }

  dispose(): void { for (const [cwd, terminals] of this.workspaces) for (const id of terminals.keys()) this.close(cwd, id) }
}

function terminalRequestAllowed(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (host === undefined || req.headers['sec-fetch-site'] === 'cross-site') return false
  let hostname: string
  try { hostname = new URL(`http://${host}`).hostname } catch { return false }
  if (hostname !== 'localhost' && hostname !== '[::1]' && !hostname.startsWith('127.')) return false
  const origin = req.headers.origin
  try { return origin === undefined || new URL(origin).host === host } catch { return false }
}

/** Register the private local terminal API and WebSocket transport. */
export function installTerminal(ctx: HostContext): void {
  const manager = new TerminalManager()
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-vscode-terminal/api', handler: async (req, res) => {
    if (!terminalRequestAllowed(req)) return send(res, 403, { ok: false, error: { message: 'forbidden' } })
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: { message: 'POST required' } })
    try {
      const body = await readBody(req)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      if (sessionId === '') throw new Error('sessionId required')
      const cwd = cwdFor(ctx, sessionId)
      const method = new URL(req.url ?? '/', 'http://dsh.local').pathname.slice('/dsh-vscode-terminal/api/'.length)
      let value: unknown
      if (method === 'list') value = manager.list(cwd)
      else if (method === 'create') value = manager.create(cwd, typeof body.title === 'string' ? body.title : undefined)
      else if (method === 'close') { manager.close(cwd, typeof body.id === 'string' ? body.id : ''); value = manager.list(cwd) }
      else if (method === 'rename') value = manager.rename(cwd, typeof body.id === 'string' ? body.id : '', typeof body.title === 'string' ? body.title : '')
      else throw new Error('unknown terminal method')
      send(res, 200, { ok: true, value })
    } catch (error) { sendError(res, error) }
  } }), 'dsh-vscode-workbench: terminal API')

  const webSocket = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({ path: '/dsh-vscode-terminal/ws', handler(req, socket, head) {
    if (!terminalRequestAllowed(req as IncomingMessage)) { socket.destroy(); return }
    webSocket.handleUpgrade(req as IncomingMessage, socket as Duplex, head, connection => {
      const url = new URL(req.url ?? '/', 'http://dsh.local')
      const sessionId = url.searchParams.get('sessionId')
      const id = url.searchParams.get('id')
      if (sessionId === null || id === null) { connection.close(1008, 'sessionId and id required'); return }
      const handle = manager.get(cwdFor(ctx, sessionId), id)
      if (handle === undefined) { connection.close(1008, 'terminal not found'); return }
      if (handle.replay !== '') connection.send(JSON.stringify({ type: 'replay', sequence: handle.info.sequence, data: handle.replay }))
      const listener = (output: TerminalOutput) => { if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'output', ...output })) }
      handle.listeners.add(listener)
      connection.on('message', raw => {
        const text = raw.toString()
        try {
          const message: unknown = JSON.parse(text)
          if (message !== null && typeof message === 'object' && 'type' in message && message.type === 'input' && 'data' in message && typeof message.data === 'string') handle.process.write(message.data)
          else if (message !== null && typeof message === 'object' && 'type' in message && message.type === 'resize' && 'cols' in message && 'rows' in message && typeof message.cols === 'number' && typeof message.rows === 'number') handle.process.resize(Math.max(2, Math.floor(message.cols)), Math.max(2, Math.floor(message.rows)))
        } catch { handle.process.write(text) }
      })
      connection.on('close', () => handle.listeners.delete(listener))
    })
  } }), 'dsh-vscode-workbench: terminal WebSocket')
  ctx.effect(() => () => { webSocket.close(); manager.dispose() }, 'dsh-vscode-workbench: terminal teardown')
}
