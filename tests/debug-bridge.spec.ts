import { expect, it } from 'vitest'
import { parseDebugMessage, resolveDebugPaths, type DebugIncoming } from '../src/debug.ts'

// The debug socket is a network boundary: anything the panel can send, another page on the same
// origin can send too, so the frame validator and the workspace path mapper are tested directly.
const encode = (value: unknown) => JSON.stringify(value)

it('accepts the documented frames and normalises their optional fields', () => {
  expect(parseDebugMessage(encode({ type: 'start', program: 'a.js', breakpoints: { 'a.js': [{ line: 3, condition: 'x > 1' }] } })))
    .toEqual({ type: 'start', program: 'a.js', cwd: '', adapterId: undefined, args: undefined, stopOnEntry: false, breakpoints: { 'a.js': [{ line: 3, condition: 'x > 1' }] } })
  expect(parseDebugMessage(encode({ type: 'run', program: 'a.py', cwd: '/w', args: ['--x'] })))
    .toEqual({ type: 'run', program: 'a.py', cwd: '/w', args: ['--x'] })
  expect(parseDebugMessage(encode({ type: 'setBreakpoints', path: 'a.js', breakpoints: [] })))
    .toEqual({ type: 'setBreakpoints', path: 'a.js', breakpoints: [] })
  expect(parseDebugMessage(encode({ type: 'attach', port: 9229 })))
    .toEqual({ type: 'attach', target: 'node', port: 9229, cwd: '' })
  expect(parseDebugMessage(encode({ type: 'step', kind: 'out' }))).toEqual({ type: 'step', kind: 'out' })
  expect(parseDebugMessage(encode({ type: 'stop' }))).toEqual({ type: 'stop' })
})

it('rejects malformed frames instead of trusting the JSON cast', () => {
  for (const frame of [
    'not json',
    'null',
    '[]',
    '{}',
    encode({ type: 'nope' }),
    encode({ type: 'start' }),
    encode({ type: 'start', program: '' }),
    encode({ type: 'start', program: 'a.js', breakpoints: 'nope' }),
    encode({ type: 'start', program: 'a.js', breakpoints: { 'a.js': [{ line: 0 }] } }),
    encode({ type: 'start', program: 'a.js', breakpoints: { 'a.js': [{ line: 1.5 }] } }),
    encode({ type: 'start', program: 'a.js', args: [1] }),
    encode({ type: 'run' }),
    encode({ type: 'attach', port: 0 }),
    encode({ type: 'attach', port: 70000 }),
    encode({ type: 'setBreakpoints', path: 'a.js', breakpoints: [{ line: '3' }] }),
    encode({ type: 'step', kind: 'sideways' }),
    encode({ type: 'evaluate' }),
  ]) {
    expect(parseDebugMessage(frame), frame).toBeUndefined()
  }
})

it('resolves every launch path through the workspace mapper', async () => {
  const seen: string[] = []
  const resolve = async (path: string) => { seen.push(path); return `/ws/${path}` }
  const message: DebugIncoming = { type: 'start', program: 'src/a.js', cwd: '', breakpoints: { 'src/a.js': [{ line: 1 }], 'src/b.js': [{ line: 2 }] } }
  const resolved = await resolveDebugPaths(message, resolve)
  expect(resolved).toMatchObject({
    type: 'start',
    program: '/ws/src/a.js',
    breakpoints: { '/ws/src/a.js': [{ line: 1 }], '/ws/src/b.js': [{ line: 2 }] },
  })
  expect(seen).toEqual(['src/a.js', 'src/a.js', 'src/b.js'])
})

it('refuses a launch that escapes the workspace', async () => {
  const resolve = async (path: string): Promise<string> => { throw new Error(`outside workspace: ${path}`) }
  expect(await resolveDebugPaths({ type: 'run', program: '../evil.js', cwd: '' }, resolve)).toBeUndefined()
  expect(await resolveDebugPaths({ type: 'setBreakpoints', path: '../evil.js', breakpoints: [] }, resolve)).toBeUndefined()
})

it('leaves frames without paths untouched', async () => {
  const resolve = async () => { throw new Error('must not resolve') }
  await expect(resolveDebugPaths({ type: 'attach', target: 'node', port: 9229, cwd: '' }, resolve)).resolves.toEqual({ type: 'attach', target: 'node', port: 9229, cwd: '' })
  await expect(resolveDebugPaths({ type: 'resume' }, resolve)).resolves.toEqual({ type: 'resume' })
})