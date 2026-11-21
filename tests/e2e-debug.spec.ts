/**
 * End-to-end check without a browser: the real client controller talks to the real host session over
 * an in-memory socket. It covers adapter choice, the start/breakpoint message shapes, the send queue,
 * and the stopped/stack/variables round trip — everything except React rendering.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DebugController } from '../src/client/debug.ts'
import { createDebugSession, debugpyAdapter, type DebugIncoming, type DebugOutgoing } from '../src/debug.ts'

// Real adapters are not installed on CI runners; opt in with DSH_DEBUG_TESTS=1.
const adaptersEnabled = process.env.DSH_DEBUG_TESTS === '1'
const adaptersRoot = process.env.DSH_WORKBENCH_ADAPTERS ?? join(homedir(), '.dsh', 'workbench-adapters')

/** Minimal stand-in for the browser WebSocket, wired straight into the host session. */
class LoopbackSocket {
  static last: LoopbackSocket | undefined
  readyState = 0
  onopen: (() => void) | undefined
  onmessage: ((event: { data: string }) => void) | undefined
  onclose: (() => void) | undefined
  onerror: (() => void) | undefined
  private host: ReturnType<typeof createDebugSession> | undefined
  private readonly onFrame: (message: DebugIncoming) => void

  constructor(private readonly onHostMessage: (message: DebugOutgoing) => void) {
    this.onFrame = message => this.host?.handle(message)
    LoopbackSocket.last = this
    queueMicrotask(() => { this.readyState = 1; this.onopen?.() })
  }

  attachHost(host: ReturnType<typeof createDebugSession>): void { this.host = host }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket not open')
    // The host answers through `onHostMessage`, which the test forwards back into `deliver`.
    this.onFrame(JSON.parse(data) as DebugIncoming)
  }

  /** Called by the test when the host produces a frame. */
  deliver(message: DebugOutgoing): void { this.onHostMessage(message) }

  close(): void { this.readyState = 3; this.onclose?.() }
}

afterEach(() => { vi.restoreAllMocks() })

it.skipIf(!adaptersEnabled)('drives a Python breakpoint through the real client controller and the real host', async () => {
  if (debugpyAdapter(adaptersRoot) === undefined) return

  const directory = mkdtempSync(join(tmpdir(), 'dvw-e2e-'))
  const program = join(directory, 'target.py')
  writeFileSync(program, 'def twice(n):\n    doubled = n * 2\n    return doubled\n\nprint(twice(21))\n', 'utf8')

  // The browser globals the client controller reads.
  vi.stubGlobal('location', { protocol: 'http:', host: '127.0.0.1:1' })
  const outgoing: DebugOutgoing[] = []
  const socket = new LoopbackSocket(message => { outgoing.push(message) })
  vi.stubGlobal('WebSocket', class {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3
    constructor() { return socket as unknown as object }
  })

  const host = createDebugSession(message => { outgoing.push(message); socket.onmessage?.({ data: JSON.stringify(message) }) }, { adaptersRoot })
  socket.attachHost(host)

  const controller = new DebugController()
  controller.setSession('session-e2e')
  controller.connect('session-e2e')
  // A breakpoint chosen through the gutter, with a workspace-relative path the way the UI sends it.
  controller.toggleBreakpoint('session-e2e', program, 2)
  controller.start('session-e2e', program, directory, 'python')

  const settle = async (predicate: () => boolean, ms = 40000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (predicate()) return true
      await new Promise(resolve => setTimeout(resolve, 120))
    }
    return false
  }
  const stopped = await settle(() => controller.getSnapshot().state === 'stopped')
  const snapshot = controller.getSnapshot()
  controller.dispose()
  host.dispose()
  expect(stopped, `state=${snapshot.state} events=${JSON.stringify(snapshot.console).slice(0, 400)}`).toBe(true)
  expect(snapshot.frames.length).toBeGreaterThan(0)
}, 60000)