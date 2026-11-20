import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { delimiter } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createDebugSession, debugpyAdapter, type DebugIncoming, type DebugOutgoing } from '../src/debug.ts'

const adaptersRoot = process.env.DSH_WORKBENCH_ADAPTERS ?? join(homedir(), '.dsh', 'workbench-adapters')

it('runs a Python program through the generic DAP bridge and stops on a breakpoint', async () => {
  if (debugpyAdapter(adaptersRoot) === undefined) {
    // The adapter is optional: a machine without it must not fail the suite.
    return
  }
  const directory = mkdtempSync(join(tmpdir(), 'dvw-dap-'))
  const program = join(directory, 'target.py')
  writeFileSync(program, 'def add(a, b):\n    total = a + b\n    return total\n\nprint("sum", add(2, 3))\n', 'utf8')

  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message), { adaptersRoot })
  const send = (message: DebugIncoming) => session.handle(message)
  send({ type: 'start', adapterId: 'python', program, cwd: directory, breakpoints: { [program]: [{ line: 2 }] } })

  const stopped = await new Promise<DebugOutgoing | undefined>(resolve => {
    const timer = setTimeout(() => resolve(undefined), 30000)
    const poll = setInterval(() => {
      const hit = events.find(event => event.type === 'state' && event.state === 'stopped')
      if (hit !== undefined) { clearTimeout(timer); clearInterval(poll); resolve(hit) }
    }, 100)
  })
  session.dispose()
  expect(stopped, `events: ${JSON.stringify(events).slice(0, 800)}`).toBeDefined()
  expect(events.some(event => event.type === 'stack')).toBe(true)
}, 60000)
it('runs a Python file without a debugger and streams its output', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dvw-run-'))
  const program = join(directory, 'plain.py')
  writeFileSync(program, 'print("hello from run")\n', 'utf8')

  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message), { adaptersRoot })
  session.handle({ type: 'run', program, cwd: directory })

  const ended = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 20000)
    const poll = setInterval(() => {
      if (events.some(event => event.type === 'ended')) { clearTimeout(timer); clearInterval(poll); resolve(true) }
    }, 100)
  })
  session.dispose()
  expect(ended).toBe(true)
  expect(events.some(event => event.type === 'output' && event.text.includes('hello from run'))).toBe(true)
}, 30000)
it('debugs a compiled C program through GDB DAP', async () => {
  const gdb = process.platform === 'win32' ? 'gdb.exe' : 'gdb'
  const gxx = process.platform === 'win32' ? 'g++.exe' : 'g++'
  const onPath = (name: string) => (process.env.PATH ?? '').split(delimiter).some(dir => { try { return existsSync(join(dir, name)) } catch { return false } })
  if (!onPath(gdb) || !onPath(gxx)) return

  const directory = mkdtempSync(join(tmpdir(), 'dvw-cpp-'))
  const source = join(directory, 'tiny.c')
  writeFileSync(source, '#include <stdio.h>\nint add(int a,int b){int s=a+b;return s;}\nint main(void){printf("%d\\n", add(2,3));return 0;}\n', 'utf8')
  const compiled = execFileSync(gxx, ['-g', '-O0', '-o', join(directory, 'tiny.exe'), source], { encoding: 'utf8' })
  void compiled

  const events: DebugOutgoing[] = []
  const session = createDebugSession(message => events.push(message), { adaptersRoot })
  session.handle({ type: 'start', adapterId: 'cpp', program: source, cwd: directory, breakpoints: { [source]: [{ line: 2 }] } })

  const stopped = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 40000)
    const poll = setInterval(() => {
      if (events.some(event => event.type === 'state' && event.state === 'stopped')) { clearTimeout(timer); clearInterval(poll); resolve(true) }
    }, 150)
  })
  session.dispose()
  expect(stopped, `events: ${JSON.stringify(events).slice(0, 600)}`).toBe(true)
}, 60000)