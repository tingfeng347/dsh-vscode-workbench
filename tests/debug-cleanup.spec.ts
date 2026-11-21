import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createDebugSession, sameFile, type DebugOutgoing } from '../src/debug.ts'

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch { return false }
}

it('reports a DAP launch rejection and allows retry in the same session', async () => {
  const { directory, program } = idleProgram()
  writeFileSync(join(directory, 'adapter.cjs'), String.raw`
let input = Buffer.alloc(0)
let seq = 0
process.stdin.on('data', chunk => {
  input = Buffer.concat([input, chunk])
  for (;;) {
    const delimiter = input.indexOf('\r\n\r\n')
    if (delimiter < 0) return
    const size = Number(/Content-Length: (\d+)/i.exec(input.subarray(0, delimiter).toString())[1])
    const end = delimiter + 4 + size
    if (input.length < end) return
    const request = JSON.parse(input.subarray(delimiter + 4, end))
    input = input.subarray(end)
    const success = request.command !== 'launch' || request.arguments.args.includes('valid')
    reply({ type: 'response', request_seq: request.seq, command: request.command, success,
      body: request.command === 'initialize' ? { supportsConfigurationDoneRequest: true } : {},
      ...(success ? {} : { message: 'launch rejected by test adapter' }) })
    if (request.command === 'launch' && success) reply({ type: 'event', event: 'initialized' })
  }
})
function reply(message) {
  const body = JSON.stringify({ ...message, seq: ++seq })
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
`)
  vi.stubEnv('DSH_DEBUG_ADAPTER_COMMAND', process.execPath)
  vi.stubEnv('DSH_DEBUG_ADAPTER_ARGS', 'adapter.cjs')
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  try {
    session.handle({ type: 'start', adapterId: 'custom', program, cwd: directory, breakpoints: { [program]: [{ line: 1 }] } })
    await waitFor(() => events.some(event => event.type === 'error' || event.type === 'state' && event.state === 'running'))
    expect(events).toContainEqual({ type: 'error', message: 'launch rejected by test adapter' })
    expect(events).toContainEqual({ type: 'state', state: 'ended' })
    expect(events).not.toContainEqual({ type: 'state', state: 'running' })

    session.handle({ type: 'start', adapterId: 'custom', program, cwd: directory, args: ['valid'] })
    await waitFor(() => events.some(event => event.type === 'state' && event.state === 'running'))
  } finally {
    session.dispose()
    vi.unstubAllEnvs()
    // On Windows the adapter's working directory remains locked until taskkill completes.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 25_000)

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('condition was not met in time')
}

function idleProgram(): { directory: string; program: string; pidFile: string } {
  const directory = mkdtempSync(join(tmpdir(), 'dvw-clean-'))
  const pidFile = join(directory, 'pid.txt')
  const program = join(directory, 'idle.js')
  writeFileSync(program, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetInterval(() => {}, 1000)\n`, 'utf8')
  return { directory, program, pidFile }
}

// Closing the socket has to take the plain "run" process with it; otherwise a background program
// keeps running after the panel is gone, and nothing can stop it any more.
it('kills a plain run when the debug socket closes', async () => {
  const { directory, program, pidFile } = idleProgram()
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  session.handle({ type: 'run', program, cwd: directory, args: [] })
  await waitFor(() => existsSync(pidFile))
  const pid = Number(readFileSync(pidFile, 'utf8'))
  expect(alive(pid)).toBe(true)

  session.dispose()
  await waitFor(() => !alive(pid))
  expect(alive(pid)).toBe(false)
}, 30_000)

it('ignores commands that arrive after the socket closed', async () => {
  const { directory, program, pidFile } = idleProgram()
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  session.dispose()
  session.handle({ type: 'run', program, cwd: directory, args: [] })
  // A closed bridge must never spawn anything, even if a frame was already in flight.
  await new Promise(resolve => setTimeout(resolve, 500))
  expect(existsSync(pidFile)).toBe(false)
}, 30_000)

it('reports a missing interpreter instead of hanging the command queue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dvw-clean-'))
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  session.handle({ type: 'run', program: join(directory, 'script.rb'), cwd: directory, args: [] })
  await waitFor(() => events.some(event => event.type === 'state' && event.state === 'ended'))
  expect(events.some(event => event.type === 'error')).toBe(true)
  // The queue still accepts a later command: a failed start must not wedge the session.
  session.handle({ type: 'run', program: join(directory, 'script.rb'), cwd: directory, args: [] })
  session.dispose()
}, 30_000)

it('recovers after a missing adapter fails to start', async () => {
  const { directory, program } = idleProgram()
  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  session.handle({ type: 'start', adapterId: 'definitely-missing', program, cwd: directory })
  await waitFor(() => events.some(event => event.type === 'error'))
  expect(events.some(event => event.type === 'state' && event.state === 'ended')).toBe(true)

  // A failed start must not poison the session: a real adapter still starts afterwards.
  session.handle({ type: 'start', adapterId: 'node', program, cwd: directory })
  await waitFor(() => events.some(event => event.type === 'state' && event.state === 'running'), 20_000)
  session.dispose()
}, 40_000)

it('stops on a Node breakpoint, reports the frame source, and kills the debuggee on close', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dvw-node-'))
  const pidFile = join(directory, 'pid.txt')
  const program = join(directory, 'target.js')
  writeFileSync(program, [
    `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
    'function add(a, b) {',
    '  const total = a + b',
    '  return total',
    '}',
    'console.log(add(2, 3))',
    '',
  ].join('\n'), 'utf8')

  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message))
  // The host resolves paths through the workspace (realpath) before they reach an adapter; macOS
  // temp directories are symlinks, so the breakpoint has to use the real path or it never binds.
  const target = realpathSync(program)
  session.handle({ type: 'start', adapterId: 'node', program: target, cwd: directory, breakpoints: { [target]: [{ line: 3 }] } })

  // `--inspect-brk` pauses at entry first; the session resumes past it, so wait for the stop that
  // actually landed on the breakpoint line instead of the first stack event.
  await waitFor(() => events.some(event => event.type === 'stack' && event.frames[0]?.line === 3), 20_000)
  const stack = [...events].reverse().find(event => event.type === 'stack' && event.frames[0]?.line === 3)
  const frame = stack?.type === 'stack' ? stack.frames[0] : undefined
  // The call stack jump needs the source path and line, not just a function name.
  expect(frame?.line).toBe(3)
  expect(sameFile(frame?.path, target), `frame=${JSON.stringify(frame)} program=${target}`).toBe(true)

  await waitFor(() => existsSync(pidFile))
  const pid = Number(readFileSync(pidFile, 'utf8'))
  session.dispose()
  await waitFor(() => !alive(pid))
  expect(alive(pid)).toBe(false)
}, 40_000)
