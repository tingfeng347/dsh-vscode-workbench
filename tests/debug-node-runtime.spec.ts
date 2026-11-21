import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createDebugSession, type DebugIncoming, type DebugOutgoing } from '../src/debug.ts'

// These drive a real Node runtime through the built-in inspector backend. They are fast and need
// no external adapter, so they run on CI instead of being gated behind DSH_DEBUG_TESTS.

function program(source: string): { directory: string; path: string } {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dvw-node-')))
  const path = join(directory, 'target.js')
  writeFileSync(path, source, 'utf8')
  return { directory, path }
}

const run = (session: ReturnType<typeof createDebugSession>, message: DebugIncoming) => session.handle(message)

async function waitFor<T>(check: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = check()
    // Boolean predicates return `false` until they hold; `!== undefined` would return instantly.
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('condition was not met in time')
}

const stopped = (events: DebugOutgoing[]) => events.find(event => event.type === 'state' && event.state === 'stopped')
const ended = (events: DebugOutgoing[]) => events.filter(event => event.type === 'ended')
const frames = (events: DebugOutgoing[]) => {
  const stack = [...events].reverse().find(event => event.type === 'stack')
  return stack?.type === 'stack' ? stack.frames : []
}

it('does not stop on a first-line breakpoint whose condition is false', async () => {
  const { directory, path } = program('const value = 1\nconsole.log(value)\n')
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  run(session, { type: 'start', adapterId: 'node', program: path, cwd: directory, breakpoints: { [path]: [{ line: 1, condition: 'false' }] } })
  try {
    await waitFor(() => ended(events).length > 0)
    // The inspector's "Break on start" pause is not a conditional hit: it must be resumed.
    expect(stopped(events)).toBeUndefined()
  } finally {
    session.dispose()
  }
}, 40_000)

it('reports the real exit code exactly once when the script ends by itself', async () => {
  const { directory, path } = program('process.exitCode = 7\n')
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  run(session, { type: 'start', adapterId: 'node', program: path, cwd: directory })
  try {
    await waitFor(() => ended(events).length > 0)
    // Two "ended" frames (one from the inspector, one from the process) confused the panel, and
    // both claimed code 0 while the script asked for 7.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(ended(events)).toHaveLength(1)
    expect(ended(events)[0]).toMatchObject({ type: 'ended', code: 7 })
  } finally {
    session.dispose()
  }
}, 40_000)

it('stops on a breakpoint set on the first executable statement', async () => {
  const { directory, path } = program('const value = 1\nconsole.log(value)\n')
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  run(session, { type: 'start', adapterId: 'node', program: path, cwd: directory, breakpoints: { [path]: [{ line: 1 }] } })
  try {
    await waitFor(() => stopped(events))
    // The entry pause of --inspect-brk sits on line 1; it must not be resumed past the breakpoint.
    expect(frames(events)[0]?.line).toBe(1)
  } finally {
    session.dispose()
  }
}, 40_000)

it('does not stop on a breakpoint that was removed while paused elsewhere', async () => {
  const { directory, path } = program('let a = 1\na += 1\na += 1\nconsole.log(a)\n')
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  // Line 3 is still ahead of the pause at line 2, so a binding the host failed to remove fires.
  run(session, { type: 'start', adapterId: 'node', program: path, cwd: directory, breakpoints: { [path]: [{ line: 2 }, { line: 3 }] } })
  try {
    await waitFor(() => stopped(events))
    expect(frames(events)[0]?.line).toBe(2)
    const stopCount = events.filter(event => event.type === 'state' && event.state === 'stopped').length
    run(session, { type: 'setBreakpoints', path, breakpoints: [{ line: 2 }] })
    run(session, { type: 'resume' })
    await waitFor(() => events.some(event => event.type === 'state' && event.state === 'ended'))
    expect(events.filter(event => event.type === 'state' && event.state === 'stopped').length).toBe(stopCount)
  } finally {
    session.dispose()
  }
}, 40_000)

it('forwards the debuggee stderr to the console', async () => {
  // Process-level stderr, written after a delay so it cannot arrive in the same chunk as the
  // inspector banner (where the old code removed the listener and swallowed everything after it).
  const { directory, path } = program('setTimeout(() => process.stderr.write("boom-from-stderr\\n"), 300)\n')
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  run(session, { type: 'start', adapterId: 'node', program: path, cwd: directory })
  try {
    await waitFor(() => events.some(event => event.type === 'output' && event.category === 'stderr' && event.text.includes('boom-from-stderr')))
  } finally {
    session.dispose()
  }
}, 40_000)

it('reports the end of a script that exits by itself', async () => {
  const { directory, path } = program('console.log("done")\n')
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  const started = Date.now()
  run(session, { type: 'start', adapterId: 'node', program: path, cwd: directory })
  try {
    await waitFor(() => events.some(event => event.type === 'ended'), 10_000)
    // The author measured "no end event within 4 seconds"; keep that bound here.
    expect(Date.now() - started).toBeLessThan(4_000)
  } finally {
    session.dispose()
  }
}, 40_000)