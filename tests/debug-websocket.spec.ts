import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { createDebugBridge } from '../src/debug.ts'

// Production entry: the panel talks to `/dsh-vscode/ws/debug`, the route validates every frame and
// pins paths to the session workspace before a debug session sees it. These tests drive that
// pipeline over a real socket instead of calling the session directly.

let server: Server | undefined
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  if (server !== undefined) {
    await new Promise<void>(done => server!.close(() => done()))
    server = undefined
  }
})

function workspaceWith(source: string): { root: string; program: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dvw-ws-')))
  const program = join(root, 'target.js')
  writeFileSync(program, source, 'utf8')
  return { root, program }
}

/** Resolve like the host's workspacePath: absolute, real, and never outside the workspace. */
function resolver(root: string): (path: string) => Promise<string> {
  return async path => {
    const absolute = realpathSync(resolve(root, path))
    if (absolute !== root && !absolute.startsWith(root + sep)) throw new Error('outside workspace')
    return absolute
  }
}

async function connect(root: string): Promise<{ socket: WebSocket; events: Array<Record<string, unknown>>; send(message: unknown): void }> {
  const events: Array<Record<string, unknown>> = []
  const wss = new WebSocketServer({ noServer: true })
  const http = createServer()
  http.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
      const bridge = createDebugBridge({
        workspace: root,
        adaptersRoot: '',
        resolvePath: resolver(root),
        send: message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) },
      })
      ws.on('message', data => { void bridge.accept(data as Buffer) })
      ws.on('close', () => bridge.dispose())
      ws.on('error', () => bridge.dispose())
    })
  })
  await new Promise<void>(done => http.listen(0, '127.0.0.1', () => done()))
  server = http
  const { port } = http.address() as AddressInfo
  const socket = new WebSocket(`ws://127.0.0.1:${port}/dsh-vscode/ws/debug?sessionId=s`)
  sockets.push(socket)
  await new Promise<void>((done, fail) => { socket.once('open', () => done()); socket.once('error', fail) })
  socket.on('message', data => { events.push(JSON.parse(String(data)) as Record<string, unknown>) })
  return { socket, events, send: message => socket.send(JSON.stringify(message)) }
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = check()
    // Boolean predicates return `false` until they hold; `!== undefined` would return instantly.
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('condition was not met in time')
}

const stopped = (events: Array<Record<string, unknown>>) => events.find(event => event.type === 'state' && event.state === 'stopped')
const ended = (events: Array<Record<string, unknown>>) => events.find(event => event.type === 'state' && event.state === 'ended')
const errors = (events: Array<Record<string, unknown>>) => events.filter(event => event.type === 'error')

it('survives set-breakpoint → start → stop → start again on the same file', async () => {
  const { root } = workspaceWith('let a = 1\na += 1\na += 1\nconsole.log(a)\n')
  const { send, events } = await connect(root)

  send({ type: 'setBreakpoints', path: 'target.js', breakpoints: [{ line: 3 }] })
  // The panel re-sends its accumulated table on every start, exactly like DebugController.start.
  send({ type: 'start', program: 'target.js', cwd: '', breakpoints: { 'target.js': [{ line: 3 }] } })
  await waitFor(() => stopped(events))
  // The adapter answers with an absolute path; the panel must still receive the relative one.
  const echo = events.filter(event => event.type === 'breakpoints').at(-1)
  expect(echo?.path).toBe('target.js')

  send({ type: 'stop' })
  await waitFor(() => ended(events))

  // The second launch re-sends the same breakpoint table: before the fix the host rejected it.
  send({ type: 'start', program: 'target.js', cwd: '', breakpoints: { 'target.js': [{ line: 3 }] } })
  await waitFor(() => events.filter(event => event.type === 'state' && event.state === 'stopped').length >= 2)
  expect(errors(events)).toHaveLength(0)
}, 60_000)

it('keeps a running session alive when a breakpoint update is rejected', async () => {
  const { root } = workspaceWith('setInterval(() => console.log("tick"), 100)\n')
  const { send, events } = await connect(root)

  send({ type: 'start', program: 'target.js', cwd: '' })
  await waitFor(() => events.some(event => event.type === 'state' && event.state === 'running'))

  // A breakpoint for a file outside the workspace fails that one update — not the live session.
  send({ type: 'setBreakpoints', path: '../outside.js', breakpoints: [{ line: 1 }] })
  await waitFor(() => errors(events).length > 0)
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(events.filter(event => event.type === 'ended')).toHaveLength(0)
  expect(events.some(event => event.type === 'state' && event.state === 'ended')).toBe(false)

  // The session must still be controllable afterwards.
  send({ type: 'stop' })
  await waitFor(() => events.some(event => event.type === 'ended'))
}, 60_000)

it('reports an invalid target once and stays retryable', async () => {
  const { root } = workspaceWith('console.log("ok")\n')
  const { send, events } = await connect(root)

  send({ type: 'start', program: '../outside.js', cwd: '' })
  await waitFor(() => errors(events))
  await waitFor(() => ended(events))
  expect(errors(events)).toHaveLength(1)
  expect(String(errors(events)[0]?.message)).toContain('工作区')

  // Retrying with a valid target must work immediately after the rejection.
  send({ type: 'start', program: 'target.js', cwd: '' })
  await waitFor(() => events.some(event => event.type === 'state' && event.state === 'running' || event.type === 'ended'))
  expect(errors(events)).toHaveLength(1)
}, 60_000)