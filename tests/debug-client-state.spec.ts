// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DebugController } from '../src/client/debug.ts'

/** Stand-in for the browser socket: records what the controller sends and feeds replies back. */
class FakeSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeSocket[] = []
  readyState = 0
  sent: Array<Record<string, unknown>> = []
  onopen: (() => void) | undefined
  onmessage: ((event: { data: string }) => void) | undefined
  onclose: (() => void) | undefined
  onerror: (() => void) | undefined
  constructor(public url: string) { FakeSocket.instances.push(this) }
  send(data: string): void { this.sent.push(JSON.parse(data) as Record<string, unknown>) }
  close(): void { this.readyState = FakeSocket.CLOSED; this.onclose?.() }
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.() }
  receive(message: unknown): void { this.onmessage?.({ data: JSON.stringify(message) }) }
  ofType(type: string): Array<Record<string, unknown>> { return this.sent.filter(message => message.type === type) }
}

const last = (socket: FakeSocket, type: string) => socket.ofType(type).at(-1)

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => { vi.unstubAllGlobals() })

it('never stores the absolute path the host echoes for a breakpoint', () => {
  const controller = new DebugController()
  controller.connect('s1')
  const socket = FakeSocket.instances.at(-1)!
  socket.open()
  controller.toggleBreakpoint('s1', 'src/a.js', 3)
  // The adapter answers with the resolved absolute path; that must not become a second key.
  socket.receive({ type: 'breakpoints', path: '/ws/src/a.js', verified: [true] })
  expect(Object.keys(controller.getSnapshot().breakpoints)).toEqual(['src/a.js'])

  controller.start('s1', 'src/a.js', '')
  expect(Object.keys(last(socket, 'start')?.breakpoints as Record<string, unknown>)).toEqual(['src/a.js'])
})

it('leaves a rejected start retryable instead of stuck on starting', () => {
  const controller = new DebugController()
  controller.connect('s1')
  const socket = FakeSocket.instances.at(-1)!
  socket.open()
  controller.start('s1', '../evil.js', '')
  expect(controller.getSnapshot().state).toBe('starting')
  socket.receive({ type: 'error', message: '调试路径不在工作区内' })
  expect(controller.getSnapshot().state).toBe('ended')
  expect(controller.getSnapshot().console.at(-1)?.text).toContain('调试路径不在工作区内')
  // Retrying is allowed immediately.
  controller.start('s1', 'src/a.js', '')
  expect(controller.getSnapshot().state).toBe('starting')
})

it('keeps breakpoint records and queued frames inside their own session', () => {
  const controller = new DebugController()
  controller.connect('s1')
  const first = FakeSocket.instances.at(-1)!
  first.open()
  controller.toggleBreakpoint('s1', 'a.js', 2)
  expect(Object.keys(controller.getSnapshot().breakpoints)).toEqual(['a.js'])

  controller.connect('s2')
  const second = FakeSocket.instances.at(-1)!
  expect(controller.getSnapshot().sessionId).toBe('s2')
  // A different session is usually a different workspace: nothing may carry over.
  expect(controller.getSnapshot().breakpoints).toEqual({})
  expect(controller.getSnapshot().state).toBe('idle')
  second.open()
  expect(second.ofType('setBreakpoints')).toHaveLength(0)
})

it('shows the debuggee stderr in the console', () => {
  const controller = new DebugController()
  controller.connect('s1')
  const socket = FakeSocket.instances.at(-1)!
  socket.open()
  socket.receive({ type: 'output', category: 'stderr', text: 'boom from stderr' })
  expect(controller.getSnapshot().console.some(entry => entry.text.includes('boom from stderr'))).toBe(true)
})